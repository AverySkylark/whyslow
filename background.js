// WhySlow - service worker
// Captures response headers (compression, cache-control, status) for every tab,
// and collects Performance API data from a page on request.

const headerStore = new Map(); // tabId -> Map(url -> header info)
const persistTimers = {};

async function loadHeaders(tabId) {
  let m = headerStore.get(tabId);
  if (m) return m;
  const key = 'h' + tabId;
  let saved = {};
  try { saved = (await chrome.storage.session.get(key))[key] || {}; } catch (e) { /* ignore */ }
  m = new Map(Object.entries(saved));
  headerStore.set(tabId, m);
  return m;
}

function persist(tabId) {
  clearTimeout(persistTimers[tabId]);
  persistTimers[tabId] = setTimeout(() => {
    const m = headerStore.get(tabId);
    if (!m) return;
    chrome.storage.session.set({ ['h' + tabId]: Object.fromEntries(m) }).catch(() => {});
  }, 300);
}

// A new top-level navigation starts a fresh record for that tab.
chrome.webRequest.onBeforeRequest.addListener(
  (d) => {
    if (d.tabId < 0) return;
    headerStore.set(d.tabId, new Map());
    persist(d.tabId);
  },
  { urls: ['<all_urls>'], types: ['main_frame'] }
);

chrome.webRequest.onHeadersReceived.addListener(
  async (d) => {
    if (d.tabId < 0) return;
    const m = await loadHeaders(d.tabId);
    const get = (name) => {
      const h = (d.responseHeaders || []).find((x) => x.name.toLowerCase() === name);
      return h ? h.value || '' : '';
    };
    m.set(d.url, {
      status: d.statusCode,
      enc: get('content-encoding'),
      cache: get('cache-control'),
      len: Number(get('content-length')) || 0,
      server: get('server'),
      fromCache: !!d.fromCache
    });
    persist(d.tabId);
  },
  { urls: ['<all_urls>'] },
  ['responseHeaders']
);

chrome.tabs.onRemoved.addListener((tabId) => {
  headerStore.delete(tabId);
  chrome.storage.session.remove(['h' + tabId, 'r' + tabId]).catch(() => {}); // headers, and the popup's last result
});

// Runs inside the page. Must be fully self-contained.
function collect() {
  const map = (e) => ({
    name: e.name,
    init: e.initiatorType || '',
    start: e.startTime,
    dur: e.duration,
    reqStart: e.requestStart,
    respStart: e.responseStart,
    respEnd: e.responseEnd,
    transfer: e.transferSize,
    enc: e.encodedBodySize,
    dec: e.decodedBodySize,
    dns0: e.domainLookupStart,
    dns1: e.domainLookupEnd,
    c0: e.connectStart,
    c1: e.connectEnd,
    s0: e.secureConnectionStart,
    proto: e.nextHopProtocol || '',
    status: e.responseStatus || 0,
    rb: e.renderBlockingStatus || ''
  });

  const nav = performance.getEntriesByType('navigation')[0];
  const doc = nav ? map(nav) : null;
  const resources = performance.getEntriesByType('resource').map(map);
  const fcpEntry = performance.getEntriesByName('first-contentful-paint')[0];
  const conn = navigator.connection || {};

  return new Promise((resolve) => {
    let lcp = null;
    let cls = 0;
    let longTasks = 0;
    let blockingMs = 0;
    const watch = (type, fn) => {
      try { new PerformanceObserver((list) => list.getEntries().forEach(fn)).observe({ type, buffered: true }); } catch (e) { /* not supported */ }
    };
    watch('largest-contentful-paint', (e) => { lcp = e.startTime; });
    watch('layout-shift', (e) => { if (!e.hadRecentInput) cls += e.value; });
    watch('longtask', (e) => { longTasks++; blockingMs += Math.max(0, e.duration - 50); });

    setTimeout(() => {
      resolve({
        url: location.href,
        title: document.title,
        doc,
        resources,
        vitals: {
          fcp: fcpEntry ? fcpEntry.startTime : null,
          lcp,
          cls,
          dcl: nav ? nav.domContentLoadedEventEnd : null,
          load: nav && nav.loadEventEnd > 0 ? nav.loadEventEnd : null
        },
        env: {
          userAgent: navigator.userAgent,
          connection: conn.effectiveType || '',
          downlink: conn.downlink || null,
          rtt: conn.rtt || null,
          domNodes: document.getElementsByTagName('*').length,
          longTasks,
          blockingMs,
          redirects: nav ? nav.redirectCount : 0,
          redirectMs: nav && nav.redirectEnd > 0 ? nav.redirectEnd - nav.redirectStart : 0
        }
      });
    }, 200);
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function waitComplete(tabId, timeout = 45000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Timed out waiting for the page to finish loading.'));
    }, timeout);
    function listener(id, info) {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function analyze(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (!/^https?:/i.test(tab.url || '')) {
    throw new Error('Open a normal http(s) page first. Chrome blocks extensions on chrome:// pages and the Web Store.');
  }
  const [injected] = await chrome.scripting.executeScript({ target: { tabId }, func: collect });
  const headers = Object.fromEntries(await loadHeaders(tabId));
  return { ...injected.result, headers };
}

async function reloadAndAnalyze(tabId, settleMs) {
  const done = waitComplete(tabId);
  await chrome.tabs.reload(tabId, { bypassCache: true });
  await done;
  await sleep(settleMs);
  return analyze(tabId);
}

async function testUrl(url, settleMs) {
  const tab = await chrome.tabs.create({ url, active: false });
  try {
    await waitComplete(tab.id);
    // Reload bypassing the cache so the numbers reflect a cold load
    return await reloadAndAnalyze(tab.id, settleMs);
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function handle(msg) {
  const settle = msg.settleMs ?? 1500;
  if (msg.type === 'analyzeTab') {
    const r = msg.reload ? await reloadAndAnalyze(msg.tabId, settle) : await analyze(msg.tabId);
    return { ...r, mode: msg.reload ? 'reload' : 'tab' };
  }
  if (msg.type === 'testUrl') return { ...(await testUrl(msg.url, settle)), mode: 'url' };
  throw new Error('Unknown request');
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handle(msg).then(sendResponse).catch((e) => sendResponse({ error: e.message || String(e) }));
  return true; // async response
});
