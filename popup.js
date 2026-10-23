// WhySlow - popup UI, analysis and AI diagnosis report
const $ = (s) => document.querySelector(s);
try { $('#ver').textContent = 'WhySlow v' + chrome.runtime.getManifest().version; } catch (e) { /* version label is optional */ }
// The design system's one icon: a right arrow after the label of minor actions
const ARROW = '<svg width="18" height="16" viewBox="0 0 18 16" fill="none" aria-hidden="true"><path d="M2 8H16M10 2L16 8L10 14" stroke="currentColor" stroke-width="1.62" stroke-linecap="round" stroke-linejoin="round"/></svg>';
// Light/dark switch. mode.js applies a saved choice before first paint; with none, the system decides.
const SYS_DARK = matchMedia('(prefers-color-scheme: dark)');
const MODE_ICON = {
  sun: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/></svg>'
};
const modeNow = () => document.documentElement.dataset.mode || (SYS_DARK.matches ? 'dark' : 'light');
function paintModeBtn() {
  const dark = modeNow() === 'dark';
  const label = dark ? 'Switch to light mode' : 'Switch to dark mode';
  const b = $('#btnMode');
  b.innerHTML = dark ? MODE_ICON.sun : MODE_ICON.moon;
  b.setAttribute('aria-label', label);
  b.title = label;
}
$('#btnMode').onclick = () => {
  const next = modeNow() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.mode = next;
  try { localStorage.setItem('wsMode', next); } catch (e) { /* storage is optional */ }
  paintModeBtn();
};
SYS_DARK.addEventListener('change', paintModeBtn);
paintModeBtn();
// Chrome focuses the first control when a popup opens and draws a focus ring on it; drop that so only real keyboard use shows one
setTimeout(() => { if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); }, 30);
let current = null;
let sortKey = 'total';
let sortDir = -1;
const typeFilter = new Set(); // empty = show all

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ok = (n) => typeof n === 'number' && isFinite(n);
const fmtMs = (n) => (ok(n) ? Math.round(n) + ' ms' : '–');
const fmtKb = (n) => (ok(n) ? (n >= 1024 ? (n / 1024).toFixed(2) + ' MB' : n.toFixed(1) + ' KB') : '–');
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);

// Google's published thresholds: [good up to, poor above]
const RATE = { ttfb: [800, 1800], fcp: [1800, 3000], lcp: [2500, 4000], cls: [0.1, 0.25], tbt: [200, 600] };
const rate = (v, k) => (!ok(v) ? '' : v <= RATE[k][0] ? 'good' : v > RATE[k][1] ? 'bad' : 'warn');
const RATE_WORD = { good: 'Good', warn: 'Needs improvement', bad: 'Poor', '': 'n/a' };

const MODE_WORD = {
  tab: 'Page as already loaded (browser cache may have been warm, so timings can look better than a first visit)',
  reload: 'Cold reload of the open tab (cache bypassed)',
  url: 'Cold load in a background tab (cache bypassed)'
};

// ---------- Analysis ----------

function baseDomain(host) {
  const p = String(host || '').split('.');
  if (p.length <= 2) return host;
  const tld = p[p.length - 1], sld = p[p.length - 2];
  if (tld.length === 2 && sld.length <= 3) return p.slice(-3).join('.'); // e.g. example.com.au
  return p.slice(-2).join('.');
}

function classify(e) {
  let ext = '';
  try { ext = (new URL(e.name).pathname.toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || ''; } catch (x) { /* ignore */ }
  if (ext === 'css') return 'CSS';
  if (ext === 'js' || ext === 'mjs') return 'JS';
  if (['woff', 'woff2', 'ttf', 'otf', 'eot'].includes(ext)) return 'Font';
  if (e.init === 'img' || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'ico', 'bmp'].includes(ext)) return 'IMG';
  if (['mp4', 'webm', 'mp3', 'ogg', 'm4a', 'wav'].includes(ext) || e.init === 'video' || e.init === 'audio') return 'Media';
  if (e.init === 'fetch' || e.init === 'xmlhttprequest') return 'XHR';
  if (e.init === 'script') return 'JS';
  if (e.init === 'css') return 'CSS';
  return 'Other';
}

function toRow(e, type, H) {
  let host = '';
  try { host = new URL(e.name).host; } catch (x) { host = ''; }
  const h = H[e.name] || {};
  const dec = e.dec > 0 ? e.dec : 0;
  const sizeBytes = dec || h.len || (e.enc > 0 ? e.enc : 0);
  const compressed = !!h.enc || (e.enc > 0 && e.dec > 0 && e.enc < e.dec);
  const cached = e.transfer === 0 && (e.dec > 0 || e.enc > 0);
  return {
    type,
    url: e.name,
    host,
    status: e.status || h.status || '',
    start: e.start,
    total: type === 'HTML' ? e.respEnd : e.dur,
    ttfb: type === 'HTML'
      ? (e.respStart > 0 ? e.respStart : null)
      : (e.respStart > 0 && e.reqStart > 0 ? e.respStart - e.reqStart : null),
    kb: sizeBytes ? sizeBytes / 1024 : null,
    transferKb: e.transfer > 0 ? e.transfer / 1024 : 0,
    encoding: h.enc || (compressed ? 'yes' : ''),
    compressed,
    cache: h.cache || '',
    hasHeaders: !!H[e.name],
    proto: e.proto,
    cached,
    blocking: e.rb === 'blocking',
    third: false,
    raw: e
  };
}

function shortUrl(u, n = 140) { return u.length > n ? u.slice(0, n - 1) + '…' : u; }

function build(data) {
  const H = data.headers || {};
  const env = data.env || {};
  const v = data.vitals || {};
  let pageHost = '';
  try { pageHost = new URL(data.url).host; } catch (e) { /* ignore */ }
  const firstBase = baseDomain(pageHost);

  const docRow = data.doc ? toRow({ ...data.doc, name: data.doc.name || data.url }, 'HTML', H) : null;
  const rows = data.resources.map((e) => toRow(e, classify(e), H));
  const all = docRow ? [docRow, ...rows] : rows;
  all.forEach((r) => { r.third = !!r.host && baseDomain(r.host) !== firstBase; });

  // Per-domain connection setup + totals
  const hostMap = new Map();
  for (const r of all) {
    if (!r.host) continue;
    if (!hostMap.has(r.host)) hostMap.set(r.host, { host: r.host, third: r.third, dns: null, tcp: null, tls: null, proto: '', files: 0, ms: 0, kb: 0, measured: false });
    const d = hostMap.get(r.host);
    d.files++;
    d.ms += ok(r.total) ? r.total : 0;
    d.kb += r.kb || 0;
    if (!d.proto && r.proto) d.proto = r.proto;
    const e = r.raw;
    if (!d.measured && e.c1 > 0) {
      const dns = Math.max(0, e.dns1 - e.dns0);
      const tcpEnd = e.s0 > 0 ? e.s0 : e.c1;
      const tcp = Math.max(0, tcpEnd - e.c0);
      const tls = e.s0 > 0 ? Math.max(0, e.c1 - e.s0) : 0;
      if (tcp > 0 || dns > 0) { d.dns = dns; d.tcp = tcp; d.tls = tls; d.measured = true; }
    }
  }
  const domains = [...hostMap.values()].sort((a, b) => b.ms - a.ms);

  const typeMap = new Map();
  for (const r of all) {
    if (!typeMap.has(r.type)) typeMap.set(r.type, { type: r.type, files: 0, ms: 0, kb: 0 });
    const t = typeMap.get(r.type);
    t.files++;
    t.ms += ok(r.total) ? r.total : 0;
    t.kb += r.kb || 0;
  }
  const types = [...typeMap.values()].sort((a, b) => b.ms - a.ms);

  const sum = (list, f) => list.reduce((s, r) => s + (f(r) || 0), 0);
  const first = all.filter((r) => !r.third);
  const third = all.filter((r) => r.third);
  const origin = {
    firstFiles: first.length, firstKb: sum(first, (r) => r.kb), firstMs: sum(first, (r) => (ok(r.total) ? r.total : 0)),
    thirdFiles: third.length, thirdKb: sum(third, (r) => r.kb), thirdMs: sum(third, (r) => (ok(r.total) ? r.total : 0)),
    thirdHosts: domains.filter((d) => d.third)
  };

  const blockers = rows.filter((r) => r.blocking && (r.type === 'JS' || r.type === 'CSS'));
  const totalKb = sum(all, (r) => r.kb);
  const headersCaptured = Object.keys(H).length > 0;

  // ----- Findings -----
  const findings = [];
  const add = (sev, title, detail, items = []) => findings.push({ sev, title, detail, items });
  const ttfb = docRow && ok(docRow.ttfb) ? docRow.ttfb : null;

  if (ttfb != null && ttfb > RATE.ttfb[0]) {
    add(ttfb > RATE.ttfb[1] ? 'high' : 'med', 'Slow server response (TTFB)',
      `The HTML took ${Math.round(ttfb)} ms to start arriving (good is up to ${RATE.ttfb[0]} ms). Nothing can render until this finishes, so look at hosting, uncached page generation (CMS, PHP, database queries), redirects, or distance to the server.`);
  }
  if (env.redirects > 0) {
    add(env.redirects > 1 || env.redirectMs > 300 ? 'med' : 'low', 'Redirects before the page loads',
      `${env.redirects} redirect(s) took about ${Math.round(env.redirectMs)} ms before the final HTML was requested (for example http→https, non-www→www, trailing slash).`);
  }
  if (ok(v.lcp) && v.lcp > RATE.lcp[0]) {
    add(v.lcp > RATE.lcp[1] ? 'high' : 'med', 'Slow largest contentful paint (LCP)',
      `The main visible content appeared at ${Math.round(v.lcp)} ms (good is up to ${RATE.lcp[0]} ms). Usually a slow server, render-blocking files, or a large hero image/font.`);
  }
  if (ok(v.fcp) && v.fcp > RATE.fcp[0]) {
    add(v.fcp > RATE.fcp[1] ? 'high' : 'med', 'Slow first contentful paint (FCP)',
      `Nothing was painted until ${Math.round(v.fcp)} ms (good is up to ${RATE.fcp[0]} ms). Check TTFB and render-blocking CSS/JS.`);
  }
  if (blockers.length) {
    const ms = Math.round(Math.max(...blockers.map((r) => (ok(r.raw.respEnd) ? r.raw.respEnd : 0))));
    add(blockers.length > 3 ? 'med' : 'low', 'Render-blocking CSS/JS',
      `${blockers.length} file(s) block the first paint; the last one finished downloading at about ${ms} ms. Defer or async non-critical scripts, inline critical CSS, and remove unused files.`,
      blockers.slice().sort((a, b) => (b.total || 0) - (a.total || 0)).slice(0, 5).map((r) => `${shortUrl(r.url)} (${fmtMs(r.total)}, ${fmtKb(r.kb)})`));
  }
  if (ok(env.blockingMs) && env.blockingMs > RATE.tbt[0]) {
    add(env.blockingMs > RATE.tbt[1] ? 'high' : 'med', 'Main thread blocked by long JavaScript tasks',
      `${env.longTasks} long task(s) kept the browser busy for about ${Math.round(env.blockingMs)} ms beyond the 50 ms allowance (approximate total blocking time). The page can look loaded but feel unresponsive. Suspect heavy scripts, tag managers, sliders, or page builders.`);
  }
  if (ok(v.cls) && v.cls > RATE.cls[0]) {
    add(v.cls > RATE.cls[1] ? 'high' : 'med', 'Layout shifting while loading (CLS)',
      `Cumulative layout shift is ${v.cls.toFixed(3)} (good is up to ${RATE.cls[0]}). Usually images without width/height, late-loading fonts or ads, or injected banners.`);
  }
  if (third.length && (pct(origin.thirdMs, origin.thirdMs + origin.firstMs) >= 40 || third.length >= 15)) {
    add('med', 'Heavy third-party load',
      `${third.length} of ${all.length} requests (${pct(origin.thirdFiles, all.length)}%) come from other domains, about ${fmtKb(origin.thirdKb)} and ${pct(origin.thirdMs, origin.thirdMs + origin.firstMs)}% of summed file time. Review analytics, tag managers, chat widgets, fonts, embeds and ads.`,
      origin.thirdHosts.slice(0, 5).map((d) => `${d.host}: ${d.files} file(s), ${fmtMs(d.ms)}, ${fmtKb(d.kb)}`));
  }
  if (headersCaptured) {
    const unc = all.filter((r) => ['HTML', 'JS', 'CSS'].includes(r.type) && r.hasHeaders && !r.compressed && r.kb > 5);
    if (unc.length) {
      const wasted = sum(unc, (r) => r.kb);
      add(wasted > 100 ? 'high' : 'med', 'Text files sent without compression',
        `${unc.length} HTML/JS/CSS file(s) (${fmtKb(wasted)} total) had no gzip/brotli. Enabling compression on the server typically cuts these by 60–80%.`,
        unc.sort((a, b) => b.kb - a.kb).slice(0, 5).map((r) => `${shortUrl(r.url)} (${fmtKb(r.kb)})`));
    }
  } else {
    add('info', 'Response headers not captured',
      'Compression and caching checks were skipped because the extension saw none of this page\'s response headers (it was probably loaded after the page). Use "Reload & analyze" for those checks.');
  }
  const bigImgs = all.filter((r) => r.type === 'IMG' && r.kb > 200 && !/\.(webp|avif|svg)(\?|#|$)/i.test(r.url));
  if (bigImgs.length) {
    add(sum(bigImgs, (r) => r.kb) > 1024 ? 'med' : 'low', 'Large images in older formats',
      `${bigImgs.length} image(s) over 200 KB (${fmtKb(sum(bigImgs, (r) => r.kb))} total) are not WebP/AVIF. Resizing to display size and converting formats usually saves the most bytes.`,
      bigImgs.sort((a, b) => b.kb - a.kb).slice(0, 5).map((r) => `${shortUrl(r.url)} (${fmtKb(r.kb)})`));
  }
  const bigOther = all.filter((r) => r.kb > 300 && r.type !== 'IMG');
  if (bigOther.length) {
    add('med', 'Large files',
      `${bigOther.length} non-image file(s) over 300 KB.`,
      bigOther.sort((a, b) => b.kb - a.kb).slice(0, 5).map((r) => `${r.type} ${shortUrl(r.url)} (${fmtKb(r.kb)})`));
  }
  const slow = all.filter((r) => ok(r.total) && r.total > 1000 && !r.cached);
  if (slow.length) {
    add('med', 'Individual files taking over 1 second',
      `${slow.length} file(s) took more than a second to download. The slowest are listed; check whether they are large, from a slow host, or waiting on the server.`,
      slow.sort((a, b) => b.total - a.total).slice(0, 5).map((r) => `${r.type} ${shortUrl(r.url)} (${fmtMs(r.total)}, TTFB ${fmtMs(r.ttfb)}, ${fmtKb(r.kb)})`));
  }
  if (totalKb > 3072) add(totalKb > 5120 ? 'high' : 'med', 'Heavy page weight', `The page loads about ${fmtKb(totalKb)} in total (cross-origin files without timing headers may be undercounted).`);
  if (all.length > 100) add('med', 'Very many requests', `${all.length} requests were made. Combine, remove or lazy-load files that aren't needed up front.`);
  if (ok(env.domNodes) && env.domNodes > 1500) add(env.domNodes > 3000 ? 'high' : 'med', 'Large DOM', `The page has ${env.domNodes} elements. Big DOMs slow style calculation, layout and scripting.`);
  if (headersCaptured) {
    const noCache = rows.filter((r) => r.hasHeaders && !r.cache && r.status && r.status < 400 && !r.third);
    if (noCache.length) {
      add('low', 'Own files without Cache-Control',
        `${noCache.length} file(s) from this site have no Cache-Control header, so repeat visits may re-download or revalidate them.`,
        noCache.slice(0, 5).map((r) => shortUrl(r.url)));
    }
  }
  const slowConn = domains.filter((d) => d.measured && d.dns + d.tcp + d.tls > 400);
  if (slowConn.length) {
    add('low', 'Slow connection setup',
      'These domains took over 400 ms for DNS + TCP + TLS before any data could flow.',
      slowConn.slice(0, 5).map((d) => `${d.host}: DNS ${Math.round(d.dns)} + TCP ${Math.round(d.tcp)} + TLS ${Math.round(d.tls)} ms`));
  }
  if (domains.length > 6) add('low', 'Many separate domains', `${domains.length} domains each need their own DNS/TCP/TLS handshake.`);
  const http1 = all.filter((r) => r.proto === 'http/1.1').length;
  if (http1 > 5) add('low', 'HTTP/1.1 in use', `${http1} files were served over HTTP/1.1. HTTP/2 or HTTP/3 loads files in parallel over one connection.`);
  if (data.resources.length >= 250) add('info', 'Request list may be incomplete', 'Chrome\'s resource timing buffer holds about 250 entries by default, so later requests on very busy pages may be missing.');

  const order = { high: 0, med: 1, low: 2, info: 3 };
  findings.sort((a, b) => order[a.sev] - order[b.sev]);

  return {
    url: data.url,
    title: data.title,
    mode: data.mode || 'tab',
    when: new Date(),
    docRow, rows, all, domains, types, findings, origin, blockers, env,
    headersCaptured,
    vitals: v,
    totals: {
      files: rows.length,
      requests: all.length,
      kb: totalKb,
      transferKb: sum(all, (r) => r.transferKb),
      cached: all.filter((r) => r.cached).length,
      unknownSize: all.filter((r) => r.kb == null).length
    }
  };
}

// ---------- Rendering ----------

const SEV_WORD = { high: 'High', med: 'Medium', low: 'Low', info: 'Note' };
const SEV_SHORT = { high: 'High', med: 'Med', low: 'Low', info: 'Note' };

// Which part of the Overview load bar a finding belongs to: server (up to the first byte),
// blocking (first byte to first paint) or render (first paint to main content). 'oth' = neither.
function segOf(f) {
  const t = f.title;
  if (f.sev === 'info' || /Cache-Control/.test(t)) return 'oth';
  if (/TTFB|Redirect|connection setup/i.test(t)) return 'srv';
  if (/Render-blocking|FCP/.test(t)) return 'blk';
  return 'rnd';
}
const SEG_WORD = { srv: 'Server', blk: 'Blocking', rnd: 'Render', oth: '' };

// Plain-English headline for the top finding on Overview (falls back to the finding title)
const HEADLINE = {
  'Slow server response (TTFB)': 'Server is the bottleneck',
  'Redirects before the page loads': 'Redirects delay the page',
  'Render-blocking CSS/JS': 'Render-blocking files hold up the page',
  'Main thread blocked by long JavaScript tasks': 'JavaScript is hogging the main thread',
  'Heavy third-party load': 'Third-party files are weighing it down',
  'Slow largest contentful paint (LCP)': 'The main content arrives late',
  'Slow first contentful paint (FCP)': 'The first paint arrives late',
  'Heavy page weight': 'The page is too heavy',
  'Text files sent without compression': 'Text files are not compressed',
  'Layout shifting while loading (CLS)': 'The layout jumps while loading'
};
const firstSentence = (s) => { const m = String(s).match(/^.*?\.(\s|$)/); return m ? m[0].trim() : String(s); };
const fmtS = (n) => (n / 1000).toFixed(2);
const hostOf = (u) => { try { return new URL(u).host; } catch (e) { return ''; } };

let view = 'overview'; // overview | causes | blocking | history | details
let lastView = 'overview';
let menuOpen = false;
let aiOpen = false;

const SVG = (body) => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICON = {
  server: SVG('<rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/><path d="M7 7.5h.01M7 16.5h.01"/>'),
  warn: SVG('<path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4M12 17h.01"/>'),
  ok: SVG('<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9.5"/>')
};

function overviewHtml(c) {
  const v = c.vitals;
  const ttfb = c.docRow && c.docRow.ttfb;

  // 1. Verdict: the most serious cause in plain words. Slow LCP/FCP are symptoms, so a real cause wins over them;
  //    the box keeps the colour of the worst finding.
  const SYMPTOM = /\((LCP|FCP)\)$/;
  const serious = c.findings.filter((f) => f.sev === 'high' || f.sev === 'med');
  const top = serious.find((f) => f.sev === 'high' && !SYMPTOM.test(f.title)) || serious.find((f) => !SYMPTOM.test(f.title)) || serious[0];
  const verdict = top
    ? `<section class="verdict ${serious[0].sev}">${segOf(top) === 'srv' ? ICON.server : ICON.warn}<div><strong>${esc(HEADLINE[top.title] || top.title)}</strong><span class="why">${esc(firstSentence(top.detail))}</span></div></section>`
    : `<section class="verdict none">${ICON.ok}<div><strong>No major bottleneck</strong><span class="why">Nothing was rated high or medium. Causes lists any minor items.</span></div></section>`;

  // 2. Headline time and where it went
  const endKey = ok(v.lcp) ? 'lcp' : ok(v.fcp) ? 'fcp' : null;
  const end = endKey ? v[endKey] : (ok(v.load) ? v.load : null);
  const endLabel = endKey === 'lcp' ? 'until main content showed' : endKey === 'fcp' ? 'until first paint' : 'until the load event';
  const r = endKey ? rate(end, endKey) : '';
  const BADGE = { good: 'Fast', warn: 'Needs work', bad: 'Slow' };
  let hero = '';
  if (ok(end)) {
    hero = `<div class="hero-top"><span class="big" data-rate="${r}">${fmtS(end)} s</span><span class="lbl">${endLabel}</span>${r ? `<span class="badge" data-rate="${r}">${BADGE[r]}</span>` : ''}</div>`;
    if (ok(ttfb) && end > 0) {
      const srv = Math.min(ttfb, end);
      const fcp = ok(v.fcp) ? Math.min(Math.max(v.fcp, srv), end) : srv;
      const P = (x) => Math.max(0, Math.min(100, (x / end) * 100));
      const pS = P(srv), pB = P(fcp - srv), pR = Math.max(0, 100 - pS - pB), fcpP = P(fcp);
      const seg = (cls, p, name, ms) => (p > 0 ? `<div class="seg c-${cls}" style="width:${p.toFixed(1)}%" title="${name}: ${Math.round(ms)} ms">${p >= 14 ? name : ''}</div>` : '');
      const labels = ['<span style="left:0">0</span>'];
      if (pS > 10 && pS < 85 && Math.abs(pS - fcpP) > 18) labels.push(`<span style="left:${pS.toFixed(1)}%;transform:translateX(-50%)">${fmtS(srv)}</span>`);
      if (ok(v.fcp) && fcpP > 12 && fcpP < 78) labels.push(`<span class="mk" style="left:${fcpP.toFixed(1)}%;transform:translateX(-50%)">FCP ${fmtS(fcp)}</span>`);
      labels.push(`<span style="right:0">${fmtS(end)} s</span>`);
      hero += `<div class="tl">
        <div class="tl-bar" role="img" aria-label="Server ${Math.round(srv)} ms, render-blocking ${Math.round(fcp - srv)} ms, rendering ${Math.round(end - fcp)} ms">${seg('srv', pS, 'Server', srv)}${seg('blk', pB, 'Block', fcp - srv)}${seg('rnd', pR, 'Render', end - fcp)}</div>
        ${ok(v.fcp) && fcpP > 0 && fcpP < 100 ? `<div class="tl-mark" style="left:${fcpP.toFixed(1)}%"></div>` : ''}
        <div class="tl-axis">${labels.join('')}</div></div>`;
    }
  }

  // 3. The next findings, one line each (open the Causes tab)
  const rest = c.findings.filter((f) => f !== top && f.sev !== 'info').slice(0, 4);
  const also = rest.length
    ? `<section class="top" aria-label="Also found"><div class="top-h">Also found</div>${rest.map((f) => `<button type="button" class="topc" data-go="causes"><span class="sw c-${segOf(f)}"></span><span class="t">${esc(f.title)}</span><span class="sev" data-sev="${f.sev}">${SEV_SHORT[f.sev]}</span></button>`).join('')}</section>`
    : '';

  // 4. One line of totals, then the comparison if there is one
  const stats = [`${c.totals.requests} req`, fmtKb(c.totals.kb), `3P ${pct(c.origin.thirdFiles, c.totals.requests)}%`, `TBT ${fmtMs(c.env.blockingMs)}`, `CLS ${ok(v.cls) ? v.cls.toFixed(2) : '–'}`];
  let since = '';
  if (c.cmp) {
    const s = c.cmp.summary;
    since = `<button type="button" class="since" data-go="history"><span>Since the last run: ${s.better} better · ${s.worse} worse · ${s.same} unchanged</span>${ARROW}</button>`;
  }
  return `<div class="ov">${verdict}${hero ? `<section class="hero" aria-label="Load time">${hero}</section>` : ''}<div class="stats" aria-label="Totals">${stats.map((s) => `<span>${esc(s)}</span>`).join('')}</div>${also}${since}</div>`;
}

function causesHtml(c) {
  if (!c.findings.length) return '<div class="pad"><div class="ok">Nothing obvious flagged.</div></div>';
  const rows = c.findings.map((f) => {
    const s = segOf(f);
    return `<details class="cause"><summary><span class="sw c-${s}"${SEG_WORD[s] ? ` title="${SEG_WORD[s]} part of the load"` : ''}></span><span class="t">${esc(f.title)}</span><span class="sev" data-sev="${f.sev}">${SEV_SHORT[f.sev]}</span></summary>
      <div class="body">${esc(f.detail)}${f.items.length ? `<ul>${f.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}</div></details>`;
  }).join('');
  return `<div class="list">${rows}</div><div class="pad hint">Most serious first. Each colour square matches a part of the Overview bar: Server, Block or Render. Grey ones are notes.</div>`;
}

function blockingHtml(c) {
  if (!c.blockers.length) return '<div class="pad"><div class="ok">No render-blocking CSS or JS was reported.</div><div class="hint">Chrome flags these per file; very old Chrome versions do not report it.</div></div>';
  const list = c.blockers.slice().sort((a, b) => (b.total || 0) - (a.total || 0));
  const kb = list.reduce((s, r) => s + (r.kb || 0), 0);
  const own = hostOf(c.url);
  // File name only (plus host when it is another site); the full URL is in the tooltip
  const path = (u) => { try { const x = new URL(u); const f = x.pathname.split('/').filter(Boolean).pop() || x.pathname; return (x.host !== own ? x.host + ' · ' : '') + f; } catch (e) { return u; } };
  return `<div class="pad hint">${list.length} file(s), ${fmtKb(kb)}. The browser has to fetch these before it can paint anything. Slowest first.</div>
    <div class="files"><div class="file head"><span class="ty">Type</span><span class="u">File</span><span class="n">Size</span><span class="n">Time</span></div>
    ${list.map((r) => `<div class="file"><span class="ty">${esc(r.type)}</span><span class="u" title="${esc(r.url)}">${esc(path(r.url))}</span><span class="n">${fmtKb(r.kb)}</span><span class="n">${fmtMs(r.total)}</span></div>`).join('')}</div>`;
}

function detailsHtml(c) {
  const v = c.vitals;
  const ttfb = c.docRow && c.docRow.ttfb;
  const thirdPct = pct(c.origin.thirdFiles, c.totals.requests);
  const CARD_WORD = { good: 'Good', warn: 'Needs a look', bad: 'Poor' };
  const card = (label, value, cls = '', sub = '') => `<div class="card"><div class="label">${esc(label)}</div><div class="value ${cls}">${esc(value)}</div>${cls ? `<div class="rating ${cls}">${cls === 'good' ? '✓' : cls === 'bad' ? '✗' : '!'} ${CARD_WORD[cls]}</div>` : ''}${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div>`;

  const host = hostOf(c.url);
  const hd = c.domains.find((d) => d.host === host);
  const conn = hd && hd.measured ? hd.tcp + hd.tls : null;
  const term = (name, value, cls, note) => `<dt>${esc(name)}</dt><dd class="${cls || ''}">${esc(value)}</dd><dd class="state">${cls ? esc(RATE_WORD[cls]) : esc(note || '')}</dd>`;
  const terminal = `<div class="terminal" role="group" aria-label="Key timings">
    <div class="term-cmd">$ whyslow ${esc(host || c.url)}</div>
    <dl class="term-list">
      ${term('TTFB', fmtMs(ttfb), rate(ttfb, 'ttfb'))}
      ${term('DNS', hd && hd.measured ? fmtMs(hd.dns) : '–', '', hd && hd.measured ? '' : 'Reused or cached')}
      ${term('Connection', fmtMs(conn), '', hd && hd.measured ? '' : 'Reused or cached')}
      ${term('Load', fmtMs(v.load))}
    </dl></div>`;

  const cards = [
    card('Server response (TTFB)', fmtMs(ttfb), rate(ttfb, 'ttfb'), 'good ≤ 800 ms'),
    card('First paint (FCP)', fmtMs(v.fcp), rate(v.fcp, 'fcp'), 'good ≤ 1.8 s'),
    card('Main content (LCP)', fmtMs(v.lcp), rate(v.lcp, 'lcp'), 'good ≤ 2.5 s'),
    card('Layout shift (CLS)', ok(v.cls) ? v.cls.toFixed(3) : '–', rate(v.cls, 'cls'), 'good ≤ 0.1'),
    card('Page load event', fmtMs(v.load)),
    card('Requests', String(c.totals.requests), c.totals.requests > 100 ? 'warn' : ''),
    card('Total size', fmtKb(c.totals.kb), c.totals.kb > 3072 ? 'warn' : ''),
    card('Third-party share', thirdPct + '%', thirdPct >= 40 ? 'warn' : '', `${c.origin.thirdFiles} requests, ${fmtKb(c.origin.thirdKb)}`),
    card('Render-blocking files', String(c.blockers.length), c.blockers.length > 3 ? 'warn' : ''),
    card('Script blocking time', fmtMs(c.env.blockingMs), rate(c.env.blockingMs, 'tbt'), `${c.env.longTasks || 0} long tasks`),
    card('Domains', String(c.domains.length), c.domains.length > 6 ? 'warn' : ''),
    card('DOM elements', ok(c.env.domNodes) ? String(c.env.domNodes) : '–', c.env.domNodes > 3000 ? 'bad' : c.env.domNodes > 1500 ? 'warn' : '')
  ].join('');

  const domainRows = c.domains.map((d) => `<tr>
    <td>${esc(d.host)}${d.third ? ' <span class="hint">(3rd party)</span>' : ''}</td>
    <td>${esc(d.proto || '–')}</td>
    <td class="num">${d.measured ? fmtMs(d.dns) : '–'}</td>
    <td class="num">${d.measured ? fmtMs(d.tcp) : '–'}</td>
    <td class="num">${d.measured ? fmtMs(d.tls) : '–'}</td>
    <td class="num">${d.files}</td>
    <td class="num">${fmtMs(d.ms)}</td>
    <td class="num">${fmtKb(d.kb)}</td></tr>`).join('');
  const typeRows = c.types.map((t) => `<tr><td>${esc(t.type)}</td><td class="num">${t.files}</td><td class="num">${fmtMs(t.ms)}</td><td class="num">${fmtKb(t.kb)}</td></tr>`).join('');
  const chips = c.types.map((t) => `<button type="button" class="chip ${typeFilter.has(t.type) ? 'on' : ''}" aria-pressed="${typeFilter.has(t.type)}" data-type="${esc(t.type)}">${esc(t.type)} (${t.files})</button>`).join('');

  return `<div class="pad">
    <div class="dhead"><div class="pageinfo"><strong>${esc(c.title || c.url)}</strong><br>${esc(c.url)}<br><span class="mode">${esc(MODE_WORD[c.mode])}</span></div>
      <button id="btnCsv" class="ds-btn ds-btn--outline ds-btn--sm" type="button">Export CSV</button></div>
    ${terminal}
    <div class="cards">${cards}</div>
    <div class="hint">"–" means the browser hid the value (cross-origin files without a Timing-Allow-Origin header). ${c.totals.cached ? c.totals.cached + ' file(s) came from cache, so their timings are not network times.' : ''}</div>
    <h2>Domain connection times</h2>
    <div class="scroll"><table><thead><tr><th>Domain</th><th>Protocol</th><th class="num">DNS</th><th class="num">TCP</th><th class="num">TLS</th><th class="num">Files</th><th class="num">Time</th><th class="num">Size</th></tr></thead><tbody>${domainRows}</tbody></table></div>
    <div class="hint">Connection times show only for the first request to each domain; reused connections report zero and show "–".</div>
    <h2>Totals per file type</h2>
    <table><thead><tr><th>Type</th><th class="num">Files</th><th class="num">Sum of file times</th><th class="num">Size</th></tr></thead><tbody>${typeRows}</tbody></table>
    <h2>All files</h2>
    <div class="chips">${chips}</div>
    <div class="scroll"><table id="resTable"></table></div>
  </div>`;
}

function render() {
  const c = current;
  document.body.classList.add('has-results');
  document.body.classList.toggle('wide', view === 'details');
  $('#host').textContent = hostOf(c.url) || c.url;
  $('#host').title = c.url;
  $('#btnAgain').hidden = false;
  $('#btnMenu').hidden = false;

  const tabs = [
    ['overview', 'Overview', null],
    ['causes', 'Causes', c.findings.filter((f) => f.sev !== 'info').length],
    ['blocking', 'Blocking', c.blockers.length],
    ['history', 'History', c.stored.length]
  ];
  $('#tabs').innerHTML = tabs.map(([k, label, n]) => `<button type="button" role="tab" class="tab" data-view="${k}" aria-selected="${view === k}" tabindex="${view === k || (view === 'details' && k === lastView) ? 0 : -1}">${label}${n != null ? `<span class="n">${n}</span>` : ''}</button>`).join('');
  $('#tabs').hidden = false;

  $('#results').innerHTML = view === 'causes' ? causesHtml(c)
    : view === 'blocking' ? blockingHtml(c)
    : view === 'history' ? `<div class="pad">${changesHtml()}${historyHtml()}</div>`
    : view === 'details' ? detailsHtml(c)
    : overviewHtml(c);
  $('#results').hidden = false;

  $('#btnDetails').setAttribute('aria-pressed', String(view === 'details'));
  $('#btnDetails').textContent = view === 'details' ? 'Close' : 'Details';
  document.querySelectorAll('#tabs .tab').forEach((t) => { t.onclick = () => go(t.dataset.view); });
  document.querySelectorAll('#results [data-go]').forEach((b) => { b.onclick = () => go(b.dataset.go); });

  if (view === 'history') wireHistory();
  if (view === 'details') {
    renderResources();
    document.querySelectorAll('.chip').forEach((el) => {
      el.onclick = () => {
        const t = el.dataset.type;
        typeFilter.has(t) ? typeFilter.delete(t) : typeFilter.add(t);
        render();
      };
    });
    $('#btnCsv').onclick = exportCsv;
  }

  renderAiHelp();
  $('#footer').hidden = false;
}

function go(v) {
  if (v !== 'details') lastView = v;
  view = v;
  $('#main').scrollTop = 0;
  render();
}

function renderResources() {
  const cols = [
    ['type', 'Type', ''], ['total', 'Total', 'num'], ['ttfb', 'TTFB', 'num'], ['kb', 'Size', 'num'],
    ['encoding', 'Compression', ''], ['status', 'Status', 'num'], ['proto', 'Proto', ''], ['url', 'URL', '']
  ];
  let list = current.all.filter((r) => !typeFilter.size || typeFilter.has(r.type));
  list = list.slice().sort((a, b) => {
    const x = a[sortKey], y = b[sortKey];
    if (x == null || x === '') return 1;
    if (y == null || y === '') return -1;
    return (x > y ? 1 : x < y ? -1 : 0) * sortDir;
  });
  const head = cols.map(([k, label, cls]) => `<th class="${cls}" data-key="${k}" tabindex="0" role="button" aria-sort="${sortKey === k ? (sortDir < 0 ? 'descending' : 'ascending') : 'none'}">${label}${sortKey === k ? (sortDir < 0 ? ' ▼' : ' ▲') : ''}</th>`).join('');
  const body = list.map((r) => {
    const slow = ok(r.total) && r.total > 1000 ? 'bad' : '';
    const big = r.kb > 300 ? 'warn' : '';
    return `<tr>
      <td>${esc(r.type)}${r.blocking ? ' <span class="hint">(blocking)</span>' : ''}</td>
      <td class="num ${slow}">${fmtMs(r.total)}${slow ? '<span class="flag">slow</span>' : ''}</td>
      <td class="num">${fmtMs(r.ttfb)}</td>
      <td class="num ${big}">${fmtKb(r.kb)}${big ? '<span class="flag">large</span>' : ''}</td>
      <td>${esc(r.encoding || (r.hasHeaders ? 'none' : '–'))}${r.cached ? ' (cached)' : ''}</td>
      <td class="num">${esc(r.status)}</td>
      <td>${esc(r.proto)}</td>
      <td class="url" title="${esc(r.url)}">${esc(r.url)}</td></tr>`;
  }).join('');
  $('#resTable').innerHTML = `<thead><tr>${head}</tr></thead><tbody>${body}</tbody>`;
  document.querySelectorAll('#resTable th[data-key]').forEach((th) => {
    th.onclick = () => {
      const k = th.dataset.key;
      if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = k === 'type' || k === 'url' ? 1 : -1; }
      renderResources();
      const again = document.querySelector(`#resTable th[data-key="${k}"]`);
      if (again) again.focus();
    };
    th.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); th.click(); } };
  });
}

// ---------- Running ----------

function setStatus(text, isError = false) {
  const el = $('#status');
  el.textContent = text;
  el.className = 'status' + (isError ? ' error' : '');
  el.hidden = !text;
}

function setBusy(busy) {
  ['#btnTab', '#btnReload', '#btnUrl', '#btnAgain'].forEach((s) => ($(s).disabled = busy));
}

async function run(msg, label) {
  setMenu(false);
  setAi(false);
  setBusy(true);
  setStatus(label);
  try {
    const data = await chrome.runtime.sendMessage(msg);
    if (!data) throw new Error('No response from the extension background worker.');
    if (data.error) throw new Error(data.error);
    current = build(data);
    await attachHistory(current);
    setStatus('');
    view = lastView = 'overview';
    render();
  } catch (e) {
    setStatus(e.message || String(e), true);
  } finally {
    setBusy(false);
  }
}

async function activeTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab.id;
}

$('#btnTab').onclick = async () => run({ type: 'analyzeTab', tabId: await activeTabId() }, 'I\'m analyzing this tab.');
$('#btnReload').onclick = async () => run({ type: 'analyzeTab', tabId: await activeTabId(), reload: true }, 'I\'m reloading without the cache, then measuring.');
$('#btnUrl').onclick = () => {
  let url = $('#urlInput').value.trim();
  if (!url) { setStatus('Enter a domain or URL first.', true); return; }
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = 'https://' + url;
  run({ type: 'testUrl', url }, 'I\'m loading ' + url + ' in a background tab.');
};
$('#urlInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btnUrl').click(); });

// ---------- Popup chrome: tabs, ⋯ menu, question menu, Details ----------

$('#btnAgain').onclick = () => $('#btnReload').click();

$('#tabs').onkeydown = (e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  const list = [...document.querySelectorAll('#tabs .tab')];
  const i = list.indexOf(document.activeElement);
  if (i < 0) return;
  e.preventDefault();
  const next = list[(i + (e.key === 'ArrowRight' ? 1 : -1) + list.length) % list.length].dataset.view;
  go(next);
  const again = document.querySelector(`#tabs .tab[data-view="${next}"]`);
  if (again) again.focus();
};

function setMenu(open) {
  menuOpen = open;
  document.body.classList.toggle('menu-open', open);
  $('#btnMenu').setAttribute('aria-expanded', String(open));
  if (open) { setAi(false); $('#btnReload').focus(); }
}
function setAi(open) {
  aiOpen = open;
  $('#aiMenu').hidden = !open;
  $('#btnAsk').setAttribute('aria-expanded', String(open));
  if (open) { setMenu(false); const f = document.querySelector('.aiq'); if (f) f.focus(); }
}
$('#btnMenu').onclick = (e) => { e.stopPropagation(); setMenu(!menuOpen); };
$('#btnAsk').onclick = (e) => { e.stopPropagation(); setAi(!aiOpen); };
document.addEventListener('click', (e) => {
  if (menuOpen && !e.target.closest('#launch, #btnMenu')) setMenu(false);
  if (aiOpen && !e.target.closest('#aiMenu, #btnAsk')) setAi(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || (!menuOpen && !aiOpen)) return;
  e.preventDefault();
  if (menuOpen) { setMenu(false); $('#btnMenu').focus(); }
  if (aiOpen) { setAi(false); $('#btnAsk').focus(); }
});
$('#btnDetails').onclick = () => { if (current) go(view === 'details' ? lastView : 'details'); };

// ---------- Export: AI diagnosis report ----------

function download(name, text, mime) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: mime }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function safeHost() {
  try { return new URL(current.url).host.replace(/[^a-zA-Z0-9.-]/g, '_'); } catch (e) { return 'page'; }
}

const mdCell = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
function mdTable(head, rows) {
  return ['| ' + head.join(' | ') + ' |', '|' + head.map(() => '---').join('|') + '|', ...rows.map((r) => '| ' + r.map(mdCell).join(' | ') + ' |')].join('\n');
}
const num = (n) => (ok(n) ? Math.round(n) : '');
const kb1 = (n) => (n != null && ok(n) ? n.toFixed(1) : '');

function report() {
  const c = current;
  const v = c.vitals;
  const e = c.env;
  const L = [];
  const ttfb = c.docRow && c.docRow.ttfb;
  const thirdAll = c.origin.thirdMs + c.origin.firstMs;

  L.push(`# WhySlow diagnosis brief: ${safeHost()}`, '');
  L.push('> Generated by the WhySlow Chrome extension. Paste this whole document into an AI assistant to work out why the site feels slow.', '');

  L.push('## Prompt for the AI', '');
  L.push('You are a senior web performance engineer. A website owner says this page feels slow. Using only the measurements in this document:');
  L.push('');
  L.push('1. Rank the most likely causes of the slowness, with the evidence for each (quote specific numbers and file URLs).');
  L.push('2. For each cause, say whether it is server-side (hosting, backend, caching), front-end (JS/CSS/images/fonts), or third-party.');
  L.push('3. Recommend concrete fixes in order of expected impact, and how to confirm each one worked.');
  L.push('4. State what you cannot tell from this data and what extra measurements or access would settle it.');
  if (c.cmp) L.push('5. This brief also compares the page with an earlier run. Say whether any change the owner describes actually helped, which differences are bigger than normal run-to-run noise, and what is still slow.');
  L.push('');
  L.push('Do not guess beyond the data. If the evidence is weak for a suspected cause, say so.', '');

  L.push('## Test context', '');
  L.push(`- **Page:** ${c.url}`);
  L.push(`- **Title:** ${c.title || '(none)'}`);
  L.push(`- **Run on:** ${c.when.toLocaleString()}`);
  L.push(`- **Load type:** ${MODE_WORD[c.mode]}`);
  L.push(`- **Browser:** ${e.userAgent || 'unknown'}`);
  L.push(`- **Connection reported by browser:** ${e.connection || 'unknown'}${e.rtt ? `, round-trip ${e.rtt} ms` : ''}${e.downlink ? `, about ${e.downlink} Mbps` : ''}`);
  L.push('- **Caveat:** measured from one browser on one connection. Treat numbers as indicative; repeat the test before concluding.', '');

  L.push('## Snapshot', '');
  L.push(mdTable(['Measure', 'Value', 'Rating', 'Good / poor threshold'], [
    ['Server response (HTML TTFB)', fmtMs(ttfb), RATE_WORD[rate(ttfb, 'ttfb')], '≤ 800 ms / > 1800 ms'],
    ['First contentful paint', fmtMs(v.fcp), RATE_WORD[rate(v.fcp, 'fcp')], '≤ 1800 ms / > 3000 ms'],
    ['Largest contentful paint', fmtMs(v.lcp), RATE_WORD[rate(v.lcp, 'lcp')], '≤ 2500 ms / > 4000 ms'],
    ['Cumulative layout shift', ok(v.cls) ? v.cls.toFixed(3) : '–', RATE_WORD[rate(v.cls, 'cls')], '≤ 0.1 / > 0.25'],
    ['Script blocking time (approx.)', fmtMs(e.blockingMs), RATE_WORD[rate(e.blockingMs, 'tbt')], '≤ 200 ms / > 600 ms'],
    ['DOM content loaded', fmtMs(v.dcl), '', ''],
    ['Page load event', fmtMs(v.load), '', ''],
    ['Requests (incl. HTML)', c.totals.requests, '', ''],
    ['Total size', fmtKb(c.totals.kb), '', ''],
    ['Third-party requests', `${c.origin.thirdFiles} (${pct(c.origin.thirdFiles, c.totals.requests)}%), ${fmtKb(c.origin.thirdKb)}`, '', ''],
    ['Render-blocking CSS/JS files', c.blockers.length, '', ''],
    ['Long JavaScript tasks', e.longTasks ?? '', '', ''],
    ['DOM elements', e.domNodes ?? '', '', ''],
    ['Domains', c.domains.length, '', ''],
    ['Redirects before page', `${e.redirects || 0}${e.redirectMs ? ` (${Math.round(e.redirectMs)} ms)` : ''}`, '', '']
  ]), '');

  changesMd(L);

  L.push('## Timeline of the main page load', '');
  const steps = [['Server first byte (TTFB)', ttfb], ['First contentful paint', v.fcp], ['Largest contentful paint', v.lcp], ['DOM content loaded', v.dcl], ['Load event', v.load]]
    .filter(([, t]) => ok(t)).sort((a, b) => a[1] - b[1]);
  L.push(steps.length ? steps.map(([n, t]) => `- ${Math.round(t)} ms: ${n}`).join('\n') : 'No timeline data available.', '');
  if (ok(ttfb) && ok(v.fcp)) L.push(`Between first byte and first paint the browser spent about ${Math.round(v.fcp - ttfb)} ms downloading and processing blocking resources.`, '');

  L.push('## Findings detected by the tool (most serious first)', '');
  L.push('These are heuristics, not conclusions. Use them as leads.', '');
  if (!c.findings.length) L.push('Nothing obvious flagged.');
  c.findings.forEach((f, i) => {
    L.push(`${i + 1}. **[${SEV_WORD[f.sev]}] ${f.title}.** ${f.detail}`);
    f.items.forEach((it) => L.push(`   - ${it}`));
  });
  L.push('');

  L.push('## Where the time and bytes go', '');
  L.push('Note: "sum of file times" adds up overlapping downloads, so it is larger than elapsed time. Use it to compare shares, not as a stopwatch.', '');
  L.push('### By file type', '');
  L.push(mdTable(['Type', 'Files', 'Sum of file times (ms)', 'Size (KB)'], c.types.map((t) => [t.type, t.files, Math.round(t.ms), t.kb.toFixed(1)])), '');
  L.push('### First-party vs third-party', '');
  L.push(mdTable(['Origin', 'Files', 'Sum of file times (ms)', 'Size (KB)', 'Share of file time'], [
    ['First-party (this site)', c.origin.firstFiles, Math.round(c.origin.firstMs), c.origin.firstKb.toFixed(1), pct(c.origin.firstMs, thirdAll) + '%'],
    ['Third-party', c.origin.thirdFiles, Math.round(c.origin.thirdMs), c.origin.thirdKb.toFixed(1), pct(c.origin.thirdMs, thirdAll) + '%']
  ]), '');
  L.push('Third-party is judged by registrable domain (a simple heuristic), so a site\'s own CDN on another domain counts as third-party.', '');
  L.push('### By domain', '');
  L.push(mdTable(['Domain', 'Party', 'Protocol', 'DNS (ms)', 'TCP (ms)', 'TLS (ms)', 'Files', 'Time (ms)', 'Size (KB)'],
    c.domains.map((d) => [d.host, d.third ? 'third' : 'first', d.proto, d.measured ? Math.round(d.dns) : '', d.measured ? Math.round(d.tcp) : '', d.measured ? Math.round(d.tls) : '', d.files, Math.round(d.ms), d.kb.toFixed(1)])), '');

  if (c.blockers.length) {
    L.push('## Render-blocking files', '');
    L.push(mdTable(['Type', 'Total (ms)', 'Size (KB)', 'URL'],
      c.blockers.slice().sort((a, b) => (b.total || 0) - (a.total || 0)).map((r) => [r.type, num(r.total), kb1(r.kb), r.url])), '');
  }

  const slowest = c.all.slice().sort((a, b) => (b.total || 0) - (a.total || 0)).slice(0, 15);
  const largest = c.all.filter((r) => r.kb != null).sort((a, b) => b.kb - a.kb).slice(0, 15);
  const fileRow = (r) => [r.type, r.third ? 'third' : 'first', num(r.total), num(r.ttfb), kb1(r.kb), r.encoding || (r.hasHeaders ? 'none' : ''), r.status, r.cache, r.url];
  const fileHead = ['Type', 'Party', 'Total (ms)', 'TTFB (ms)', 'Size (KB)', 'Compression', 'Status', 'Cache-Control', 'URL'];
  L.push('## 15 slowest files', '', mdTable(fileHead, slowest.map(fileRow)), '');
  L.push('## 15 largest files', '', mdTable(fileHead, largest.map(fileRow)), '');

  const LIMIT = 120;
  const everything = c.all.slice().sort((a, b) => (b.total || 0) - (a.total || 0));
  L.push(`## All files, slowest first${everything.length > LIMIT ? ` (top ${LIMIT} of ${everything.length})` : ''}`, '');
  L.push(mdTable(fileHead, everything.slice(0, LIMIT).map(fileRow)), '');

  L.push('## Limits of this data', '');
  L.push('- Cross-origin files without a Timing-Allow-Origin header hide their size and timing detail (shown blank).');
  L.push('- Only the main page load was measured; later interactions, logged-in states and other pages were not.');
  L.push('- No server-side data (CPU, database, PHP/CMS profiling, hosting specs) is included, so server-side causes can only be inferred from TTFB and response headers.');
  L.push('- Script blocking time is estimated from long-task entries and can differ from lab tools.');
  L.push('- This is lab data: one load, in one browser, on one connection. Field data from real visitors (Chrome UX Report, shown in PageSpeed Insights and Search Console) is not included, so it cannot show what typical users on other devices, locations and networks experience.');
  L.push('- JavaScript timings come from this computer\'s CPU. Phones and low-end devices run scripts several times slower, so main-thread blocking is likely worse for those users than reported here.');
  L.push(`- Response headers ${c.headersCaptured ? 'were' : 'were NOT'} captured, so compression and cache checks ${c.headersCaptured ? 'are' : 'are not'} reliable.`);
  L.push('');

  L.push('## Glossary', '');
  L.push('- **TTFB:** time until the server starts sending the page; high values point to slow hosting, uncached page generation or redirects.');
  L.push('- **FCP / LCP:** when the first content / the largest visible element appears.');
  L.push('- **CLS:** how much the layout jumps around while loading.');
  L.push('- **Render-blocking:** CSS/JS the browser must fetch before it can paint anything.');
  L.push('- **DNS / TCP / TLS:** looking up the server, opening the connection and securing it; every extra domain repeats this.');
  return L.join('\n');
}

function csv() {
  const q = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const head = ['Type', 'Party', 'Domain', 'Status', 'TtfbMs', 'TotalMs', 'KB', 'Encoding', 'Protocol', 'RenderBlocking', 'FromCache', 'CacheControl', 'Url'];
  const lines = [head.join(',')];
  for (const r of current.all) {
    lines.push([r.type, r.third ? 'third' : 'first', r.host, r.status, num(r.ttfb), num(r.total), kb1(r.kb), r.encoding, r.proto, r.blocking, r.cached, r.cache, r.url].map(q).join(','));
  }
  return lines.join('\r\n');
}

let toastTimer;
function toast(cls, text) {
  const t = $('#toast');
  t.className = 'toast ' + cls;
  t.textContent = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; t.textContent = ''; }, cls === 'fail' ? 8000 : 4500);
}
const exportNote = (text) => toast('done', text);

function exportCsv() {
  if (!current) return;
  download(`whyslow_${safeHost()}_${stamp()}.csv`, csv(), 'text/csv');
  exportNote('CSV saved to your Downloads folder.');
}

$('#btnMd').onclick = () => {
  if (!current) return;
  download(`whyslow_${safeHost()}_${stamp()}.md`, report(), 'text/markdown');
  exportNote('Report saved to your Downloads folder.');
};
$('#btnCopy').onclick = async () => {
  if (!current) return;
  const b = $('#btnCopy');
  try {
    await navigator.clipboard.writeText(report());
    b.textContent = 'Copied';
    aiSay('done', 'Copied the full report. Paste it into your AI chat.');
  } catch (e) {
    b.textContent = 'Copy failed';
    aiSay('fail', 'I could not copy the report. Use Save .md instead.');
  }
  setTimeout(() => (b.textContent = 'Copy AI brief'), 1800);
};

// ---------- Next step: give the report to an AI ----------

const AI_PROMPTS = [
  { label: 'Why is it slow?', text: 'Why does this page feel slow? Rank the top causes with the evidence, and tell me what to fix first.' },
  { label: 'Explain it simply', text: 'Explain these results in plain English for a non-technical site owner, then give me a short checklist of fixes in priority order.' },
  { label: 'WordPress / CMS', text: 'This site probably runs on a CMS such as WordPress. Based on the data, which causes look like plugin, theme, caching or hosting problems, and what should I check in each?' },
  { label: 'Message to my host or developer', text: 'Write a short, polite message I can send to my web host or developer. Summarise the problems found with the key numbers and ask for specific fixes.' },
  { label: 'Did my change help?', text: 'Compare this run with the earlier run. Did my change help? Which differences are real and which are normal run-to-run noise, and what should I try next?', needsCmp: true }
];

function aiSay(cls, text) { toast(cls, text); }

// The ▴ next to Copy AI brief: each question copies itself plus the full report
function renderAiHelp() {
  const list = AI_PROMPTS.filter((p) => !p.needsCmp || current.cmp);
  $('#aiChips').innerHTML = list.map((p) => `<button type="button" class="aiq" data-i="${AI_PROMPTS.indexOf(p)}" title="Copies the full report with this question on top: ${esc(p.text)}">${esc(p.label)}</button>`).join('');
  document.querySelectorAll('.aiq').forEach((b) => {
    b.onclick = async () => {
      const p = AI_PROMPTS[Number(b.dataset.i)];
      const text = `${p.text}\n\nThe measurements are below.\n\n${report()}`;
      setAi(false);
      try {
        await navigator.clipboard.writeText(text);
        aiSay('done', `Copied “${p.label}” plus the full report (about ${Math.round(text.length / 1000)}k characters). Paste it into your AI chat.`);
      } catch (e) {
        aiSay('fail', 'I could not copy. Use Save .md instead.');
      }
    };
  });
}
