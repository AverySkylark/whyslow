// Preview only: fakes the chrome.* APIs and feeds sample results to the real popup. Not part of the extension.
(function () {
  // chrome.storage.local stand-in, kept in sessionStorage so saved runs survive a reload (like reopening the popup)
  const mem = (() => { try { return JSON.parse(sessionStorage.getItem('stubLocal') || '{}'); } catch (e) { return {}; } })();
  const keepMem = () => { try { sessionStorage.setItem('stubLocal', JSON.stringify(mem)); } catch (e) { /* ignore */ } };
  const ver = (() => { try { const x = new XMLHttpRequest(); x.open('GET', '/manifest.json', false); x.send(); return JSON.parse(x.responseText).version; } catch (e) { return '?'; } })();
  const H = 'https://example-shop.com.au';
  const r = (name, init, start, dur, size, extra = {}) => Object.assign({
    name, init, start, dur, reqStart: start + 5, respStart: start + dur * 0.5, respEnd: start + dur,
    transfer: size, enc: size, dec: size * 2.4, dns0: 0, dns1: 0, c0: 0, c1: 0, s0: 0, proto: 'h2', status: 200, rb: ''
  }, extra);
  const res = [];
  res.push(r(H + '/wp-content/themes/shop/style.css', 'link', 180, 320, 94000, { rb: 'blocking' }));
  for (let i = 1; i <= 6; i++) res.push(r(`${H}/wp-content/plugins/p${i}/css/p${i}.css`, 'link', 190, 200 + i * 40, 18000 + i * 5000, { rb: i < 4 ? 'blocking' : '' }));
  for (let i = 1; i <= 14; i++) res.push(r(`${H}/wp-content/plugins/p${i}/js/p${i}.min.js?ver=${i}.2`, 'script', 220 + i * 15, 150 + i * 30, 30000 + i * 9000, { rb: i < 5 ? 'blocking' : '' }));
  for (let i = 1; i <= 22; i++) res.push(r(`${H}/wp-content/uploads/2026/product-${i}.jpg`, 'img', 700 + i * 40, 250 + i * 25, 120000 + i * 31000));
  for (let i = 1; i <= 5; i++) res.push(r(`https://cdn.thirdparty-ads.net/tag${i}.js`, 'script', 900 + i * 60, 400 + i * 90, 60000 + i * 20000, { dns0: 900, dns1: 940, c0: 940, c1: 1010, s0: 960 }));
  res.push(r('https://www.google-analytics.com/analytics.js', 'script', 1000, 220, 52000));
  res.push(r('https://fonts.gstatic.com/s/inter/v13/inter.woff2', 'css', 400, 260, 48000));
  res.push(r(H + '/wp-json/shop/v1/cart', 'fetch', 1900, 640, 3200));
  const SAMPLE = {
    url: H + '/shop/', title: 'Shop | Example Shop Australia',
    doc: r(H + '/shop/', 'navigation', 0, 1650, 61000, { reqStart: 40, respStart: 1480, respEnd: 1650, dns0: 5, dns1: 30, c0: 30, c1: 90, s0: 50 }),
    resources: res,
    vitals: { fcp: 2900, lcp: 4700, cls: 0.21, dcl: 2600, load: 5800 },
    env: { userAgent: 'preview', connection: '4g', downlink: 9.5, rtt: 50, domNodes: 3400, longTasks: 11, blockingMs: 940, redirects: 1, redirectMs: 120 },
    headers: {}, mode: 'reload'
  };
  window.chrome = {
    runtime: { getManifest: () => ({ version: ver }), sendMessage: async (msg = {}) => { await new Promise((ok) => setTimeout(ok, 400)); return { ...JSON.parse(JSON.stringify(SAMPLE)), mode: msg.type === 'testUrl' ? 'url' : msg.reload ? (msg.warm ? 'warm' : 'reload') : 'tab' }; } },
    tabs: { query: async () => [{ id: 1, url: SAMPLE.url }] },
    storage: { session: (() => {
      const ss = {};
      try { Object.assign(ss, JSON.parse(sessionStorage.getItem('stubSession') || '{}')); } catch (e) { /* ignore */ }
      const keep = () => { try { sessionStorage.setItem('stubSession', JSON.stringify(ss)); } catch (e) { /* ignore */ } };
      return {
        get: async (k) => (k == null ? { ...ss } : { [k]: ss[k] }),
        set: async (o) => { Object.assign(ss, o); keep(); },
        remove: async (k) => { [].concat(k).forEach((x) => delete ss[x]); keep(); }
      };
    })(),
    local: {
      get: async (k) => ({ [k]: mem[k] }),
      set: async (o) => { Object.assign(mem, o); keepMem(); },
      remove: async (k) => { delete mem[k]; keepMem(); }
    } }
  };
  // Auto-run once so the results are on screen straight away (add ?manual to the URL to skip)
  if (!/manual/.test(location.search)) addEventListener('load', () => setTimeout(() => document.getElementById('btnReload').click(), 100));
})();
