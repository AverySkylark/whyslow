// WhySlow - saved runs and "what changed since the last run".
// Loaded before popup.js and shares its globals (ok, fmtMs, fmtKb, esc, shortUrl, mdCell, mdTable, SEV_WORD, current).
// Everything is stored locally with chrome.storage.local; nothing leaves the browser.

const HIST = {
  KEY: 'wsRuns',          // { [pageKey]: { updated, runs: [snapshot, newest first] } }
  SETTINGS: 'wsSettings', // { save: boolean }
  MAX_RUNS: 15,           // runs kept per page
  MAX_PAGES: 30,          // pages kept; least recently tested are dropped first
  FILES_KEEP: 3,          // only the newest runs keep their per-file list (keeps storage small)
  FILE_CAP: 150           // per-file entries stored per run (slowest and largest)
};

const MODE_SHORT = { tab: 'tab as loaded', reload: 'cold reload', url: 'cold background load' };
const loadClass = (mode) => (mode === 'tab' ? 'warm' : 'cold');

// Lower is better for every metric. A change only counts when it beats BOTH thresholds,
// because the same page varies from load to load. Counts are exact, so any change counts.
const METRICS = [
  { k: 'ttfb', label: 'Server response (TTFB)', unit: 'ms', abs: 100, rel: 0.15 },
  { k: 'fcp', label: 'First paint (FCP)', unit: 'ms', abs: 100, rel: 0.1 },
  { k: 'lcp', label: 'Main content (LCP)', unit: 'ms', abs: 150, rel: 0.1 },
  { k: 'cls', label: 'Layout shift (CLS)', unit: 'cls', abs: 0.02, rel: 0.2 },
  { k: 'load', label: 'Page load event', unit: 'ms', abs: 200, rel: 0.1 },
  { k: 'blockingMs', label: 'Script blocking time', unit: 'ms', abs: 50, rel: 0.2 },
  { k: 'requests', label: 'Requests', unit: 'n', abs: 1, rel: 0 },
  { k: 'kb', label: 'Total size', unit: 'kb', abs: 20, rel: 0.05 },
  { k: 'thirdPct', label: 'Third-party share', unit: 'pct', abs: 3, rel: 0 },
  { k: 'blockers', label: 'Render-blocking files', unit: 'n', abs: 1, rel: 0 },
  { k: 'domains', label: 'Domains', unit: 'n', abs: 1, rel: 0 },
  { k: 'dom', label: 'DOM elements', unit: 'n', abs: 50, rel: 0.05 },
  { k: 'redirects', label: 'Redirects', unit: 'n', abs: 1, rel: 0 }
];

const VERDICT_WORD = { better: 'Better', worse: 'Worse', same: 'No meaningful change', na: 'n/a' };
const fmtWhen = (t) => new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
let histOpen = false;

// ---------- Keys ----------

// Same page = same host + path. Query strings and hashes are ignored so cache-busting
// parameters added while testing a fix don't start a new history.
function pageKey(url) {
  try {
    const u = new URL(url);
    return u.host.toLowerCase() + (u.pathname.replace(/\/+$/, '') || '/');
  } catch (e) { return String(url || ''); }
}

// Files are matched by origin + path so "?ver=123" bumps don't look like new files.
function fileKey(u) {
  try { const x = new URL(u); return x.origin + x.pathname; } catch (e) { return u; }
}

// ---------- Snapshot (compact record of one run) ----------

function compactFiles(c) {
  const best = new Map();
  for (const r of c.all) {
    const k = fileKey(r.url);
    const o = {
      u: r.url.length > 200 ? r.url.slice(0, 200) : r.url,
      t: r.type,
      p: r.third ? 1 : 0,
      ms: ok(r.total) ? Math.round(r.total) : null,
      kb: r.kb != null ? Math.round(r.kb * 10) / 10 : null,
      rb: r.blocking ? 1 : 0
    };
    const old = best.get(k);
    if (!old || (o.kb || 0) > (old.kb || 0)) best.set(k, o);
  }
  const list = [...best.values()];
  if (list.length <= HIST.FILE_CAP) return list;
  const half = Math.floor(HIST.FILE_CAP / 2);
  const byMs = list.slice().sort((a, b) => (b.ms || 0) - (a.ms || 0)).slice(0, half);
  const byKb = list.slice().sort((a, b) => (b.kb || 0) - (a.kb || 0)).slice(0, half);
  return [...new Map([...byMs, ...byKb].map((f) => [fileKey(f.u), f])).values()];
}

function snapshot(c) {
  const v = c.vitals || {};
  const e = c.env || {};
  const r1 = (n) => (ok(n) ? Math.round(n * 10) / 10 : null);
  const files = compactFiles(c);
  return {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    t: c.when instanceof Date ? c.when.getTime() : Date.now(),
    url: c.url,
    title: c.title || '',
    mode: c.mode,
    hdr: !!c.headersCaptured,
    conn: e.connection || '',
    note: '',
    m: {
      ttfb: r1(c.docRow && c.docRow.ttfb),
      fcp: r1(v.fcp),
      lcp: r1(v.lcp),
      cls: ok(v.cls) ? Math.round(v.cls * 1000) / 1000 : null,
      load: r1(v.load),
      blockingMs: r1(e.blockingMs),
      requests: c.totals.requests,
      kb: r1(c.totals.kb),
      thirdPct: pct(c.origin.thirdFiles, c.totals.requests),
      blockers: c.blockers.length,
      domains: c.domains.length,
      dom: ok(e.domNodes) ? e.domNodes : null,
      redirects: e.redirects || 0
    },
    findings: c.findings.filter((f) => f.sev !== 'info').map((f) => ({ sev: f.sev, title: f.title })),
    tp: c.domains.filter((d) => d.third).slice(0, 40).map((d) => d.host),
    files,
    filesTotal: c.all.length
  };
}

// ---------- Comparison ----------

function defaultBaseline(prior, mode) {
  return prior.find((r) => r.mode === mode)
    || prior.find((r) => loadClass(r.mode) === loadClass(mode))
    || prior[0]
    || null;
}

function compare(base, cur) {
  const metrics = METRICS.map((m) => {
    const b = base.m ? base.m[m.k] : null;
    const a = cur.m[m.k];
    if (!ok(b) || !ok(a)) return { ...m, before: ok(b) ? b : null, after: ok(a) ? a : null, verdict: 'na' };
    const d = a - b;
    const rel = b !== 0 ? d / Math.abs(b) : (d !== 0 ? 1 : 0);
    const real = Math.abs(d) >= m.abs && Math.abs(rel) >= m.rel;
    return { ...m, before: b, after: a, delta: d, rel, verdict: !real ? 'same' : d < 0 ? 'better' : 'worse' };
  });
  const summary = {
    better: metrics.filter((m) => m.verdict === 'better').length,
    worse: metrics.filter((m) => m.verdict === 'worse').length,
    same: metrics.filter((m) => m.verdict === 'same').length
  };

  const order = { high: 0, med: 1, low: 2 };
  const bySev = (a, b) => order[a.sev] - order[b.sev];
  const bf = new Map(base.findings.map((f) => [f.title, f.sev]));
  const cf = new Map(cur.findings.map((f) => [f.title, f.sev]));
  const findings = {
    resolved: [...bf].filter(([t]) => !cf.has(t)).map(([title, sev]) => ({ title, sev })).sort(bySev),
    added: [...cf].filter(([t]) => !bf.has(t)).map(([title, sev]) => ({ title, sev })).sort(bySev),
    changed: [...cf].filter(([t, s]) => bf.has(t) && bf.get(t) !== s).map(([title, sev]) => ({ title, from: bf.get(title), to: sev }))
  };

  const bt = new Set(base.tp || []);
  const ct = new Set(cur.tp || []);
  const hosts = { added: [...ct].filter((h) => !bt.has(h)), removed: [...bt].filter((h) => !ct.has(h)) };

  let files = null;
  if (base.files && cur.files) {
    const bm = new Map(base.files.map((f) => [fileKey(f.u), f]));
    const cm = new Map(cur.files.map((f) => [fileKey(f.u), f]));
    const added = [];
    const changed = [];
    for (const [k, f] of cm) {
      const o = bm.get(k);
      if (!o) { added.push(f); continue; }
      const dMs = ok(f.ms) && ok(o.ms) ? f.ms - o.ms : null;
      const dKb = ok(f.kb) && ok(o.kb) ? f.kb - o.kb : null;
      const kbReal = dKb != null && Math.abs(dKb) >= 20 && Math.abs(dKb) / Math.max(o.kb, 1) >= 0.1;
      const msReal = dMs != null && Math.abs(dMs) >= 300 && Math.abs(dMs) / Math.max(o.ms, 1) >= 0.25;
      if (kbReal || msReal) changed.push({ u: f.u, t: f.t, before: o, after: f, dKb, dMs, kbReal, msReal });
    }
    const removed = [...bm].filter(([k]) => !cm.has(k)).map(([, f]) => f);
    const weight = (f) => (f.kb || 0) * 5 + (f.ms || 0);
    added.sort((a, b) => weight(b) - weight(a));
    removed.sort((a, b) => weight(b) - weight(a));
    changed.sort((a, b) => Math.abs(b.dMs || 0) + Math.abs(b.dKb || 0) * 5 - (Math.abs(a.dMs || 0) + Math.abs(a.dKb || 0) * 5));
    files = { added, removed, changed, truncated: base.filesTotal > base.files.length || cur.filesTotal > cur.files.length };
  }

  const warnings = [];
  if (loadClass(base.mode) !== loadClass(cur.mode)) {
    warnings.push(`The earlier run was a ${MODE_SHORT[base.mode]} and this one is a ${MODE_SHORT[cur.mode]}. Warm and cold loads are not directly comparable; repeat both the same way for a fair test.`);
  }
  if (base.hdr !== cur.hdr) {
    warnings.push('Response headers were captured in only one of the two runs, so compression and caching findings are not comparable. Use "Reload & analyze" for both.');
  }
  if (base.conn && cur.conn && base.conn !== cur.conn) {
    warnings.push(`The browser reported a different connection type (${base.conn} before, ${cur.conn} now), which can shift timings on its own.`);
  }
  if (!files) warnings.push('File-level detail is only kept for the three newest runs, so file changes are not shown for this older run.');
  else if (files.truncated) warnings.push(`Only the ${HIST.FILE_CAP} slowest and largest files are kept per run, so file changes below cover those files only.`);

  return { base, metrics, summary, findings, hosts, files, warnings };
}

// ---------- Storage ----------

async function histLoadAll() {
  try {
    const o = (await chrome.storage.local.get(HIST.KEY))[HIST.KEY];
    return o && typeof o === 'object' ? o : {};
  } catch (e) { return {}; }
}

async function histSaveAll(all) {
  try { await chrome.storage.local.set({ [HIST.KEY]: all }); return true; } catch (e) { return false; }
}

async function histSettings() {
  try {
    const s = (await chrome.storage.local.get(HIST.SETTINGS))[HIST.SETTINGS] || {};
    return { save: s.save !== false };
  } catch (e) { return { save: true }; }
}

async function histSetSettings(patch) {
  const s = { ...(await histSettings()), ...patch };
  try { await chrome.storage.local.set({ [HIST.SETTINGS]: s }); } catch (e) { /* ignore */ }
  return s;
}

async function histRecord(key, snap) {
  const all = await histLoadAll();
  const prev = (all[key] && all[key].runs) || [];
  const runs = [snap, ...prev].slice(0, HIST.MAX_RUNS);
  runs.forEach((r, i) => { if (i >= HIST.FILES_KEEP) delete r.files; });
  all[key] = { updated: snap.t, runs };
  Object.keys(all).sort((a, b) => all[b].updated - all[a].updated).slice(HIST.MAX_PAGES).forEach((k) => delete all[k]);
  for (let i = 0; i < 6; i++) {
    if (await histSaveAll(all)) return true;
    // Quota problem: drop the least recently tested other page and retry.
    const victim = Object.keys(all).filter((k) => k !== key).sort((a, b) => all[a].updated - all[b].updated)[0];
    if (!victim) return false;
    delete all[victim];
  }
  return false;
}

async function histUpdate(key, id, patch) {
  const all = await histLoadAll();
  const run = ((all[key] && all[key].runs) || []).find((r) => r.id === id);
  if (!run) return false;
  Object.assign(run, patch);
  return histSaveAll(all);
}

async function histDelete(key, id) {
  const all = await histLoadAll();
  if (!all[key]) return;
  all[key].runs = all[key].runs.filter((r) => r.id !== id);
  if (!all[key].runs.length) delete all[key];
  await histSaveAll(all);
}

async function histClear(key) {
  if (key == null) { try { await chrome.storage.local.remove(HIST.KEY); } catch (e) { /* ignore */ } return; }
  const all = await histLoadAll();
  delete all[key];
  await histSaveAll(all);
}

// Called after build(): saves the run (if enabled) and works out the comparison.
async function attachHistory(c) {
  c.snap = snapshot(c);
  c.key = pageKey(c.url);
  c.settings = { save: false };
  c.stored = [];
  c.history = [];
  c.cmp = null;
  c.baseId = null;
  c.saveFailed = false;
  try {
    c.settings = await histSettings();
    const all = await histLoadAll();
    const prior = (all[c.key] && all[c.key].runs) || [];
    c.baseId = (defaultBaseline(prior, c.snap.mode) || {}).id || null;
    if (c.settings.save) c.saveFailed = !(await histRecord(c.key, c.snap));
    await histRefresh(c);
  } catch (e) { /* history is optional; the rest of the report still works */ }
}

async function histRefresh(c) {
  const all = await histLoadAll();
  c.stored = (all[c.key] && all[c.key].runs) || [];
  c.history = c.stored.filter((r) => r.id !== c.snap.id);
  if (!c.history.some((r) => r.id === c.baseId)) c.baseId = (defaultBaseline(c.history, c.snap.mode) || {}).id || null;
  const base = c.history.find((r) => r.id === c.baseId);
  c.cmp = base ? compare(base, c.snap) : null;
}

// ---------- Display helpers ----------

function histVal(unit, v) {
  if (!ok(v)) return '–';
  if (unit === 'ms') return Math.round(v) + ' ms';
  if (unit === 'cls') return v.toFixed(3);
  if (unit === 'kb') return fmtKb(v);
  if (unit === 'pct') return Math.round(v) + '%';
  return String(Math.round(v));
}

function histDelta(m) {
  if (m.verdict === 'na') return '–';
  if (m.delta === 0) return 'no change';
  const sign = m.delta > 0 ? '+' : '-';
  const a = Math.abs(m.delta);
  let t = m.unit === 'ms' ? Math.round(a) + ' ms'
    : m.unit === 'cls' ? a.toFixed(3)
    : m.unit === 'kb' ? fmtKb(a)
    : m.unit === 'pct' ? Math.round(a) + ' pts'
    : String(Math.round(a));
  if ((m.unit === 'ms' || m.unit === 'kb') && m.before > 0) t += ` (${sign}${Math.round(Math.abs(m.rel) * 100)}%)`;
  return sign + t;
}

const histFileLine = (f) => `${f.t} ${shortUrl(f.u, 110)} (${fmtMs(f.ms)}, ${fmtKb(f.kb)})`;
const histChangedLine = (f) => {
  const bits = [];
  if (f.msReal) bits.push(`${fmtMs(f.before.ms)} → ${fmtMs(f.after.ms)}`);
  if (f.kbReal) bits.push(`${fmtKb(f.before.kb)} → ${fmtKb(f.after.kb)}`);
  return `${f.t} ${shortUrl(f.u, 110)}: ${bits.join(', ')}`;
};

function histOptionLabel(r) {
  return `${fmtWhen(r.t)} · ${MODE_SHORT[r.mode] || r.mode}${r.note ? ' · ' + clip(r.note, 40) : ''}`;
}

// ---------- Popup: "Since the last run" ----------

function changesHtml() {
  const c = current;
  const cmp = c.cmp;
  const stored = c.stored.some((r) => r.id === c.snap.id);
  const noteRow = stored
    ? `<div class="noterow"><label for="runNote">Note for this run</label><input id="runNote" type="text" maxlength="300" placeholder="What did you change before this run? (optional, included in the AI report)" value="${esc(c.snap.note)}"></div>`
    : '';

  if (!cmp) {
    const msg = c.saveFailed ? 'This run could not be saved (browser storage is full or blocked).'
      : !c.settings.save ? 'Run saving is off, so nothing was saved or compared. You can turn it on under Run history.'
      : 'This is the first saved run for this page. Make a change to the site, run the test again, and this section will show what improved and what got worse.';
    return `<h2>Since the last run</h2><div class="hint tight">${esc(msg)}</div>${noteRow}`;
  }

  const s = cmp.summary;
  const options = c.history.map((r) => `<option value="${esc(r.id)}"${r.id === c.baseId ? ' selected' : ''}>${esc(histOptionLabel(r))}</option>`).join('');
  const warn = cmp.warnings.map((w) => `<div class="warnbox">${esc(w)}</div>`).join('');
  const rows = cmp.metrics.map((m) => `<tr class="${m.verdict}">
      <td>${esc(m.label)}</td>
      <td class="num">${esc(histVal(m.unit, m.before))}</td>
      <td class="num">${esc(histVal(m.unit, m.after))}</td>
      <td class="num chg ${m.verdict}">${esc(histDelta(m))}${m.verdict === 'better' ? ' ✓ better' : m.verdict === 'worse' ? ' ✗ worse' : ''}</td></tr>`).join('');

  const sevTag = (sev) => `<span class="pill ${sev}">${SEV_WORD[sev]}</span>`;
  const list = (title, items) => (items.length ? `<div class="chg-block"><strong>${esc(title)}</strong><ul>${items.join('')}</ul></div>` : '');
  const F = cmp.findings;
  const findingsChg =
    list('Fixed since the earlier run', F.resolved.map((f) => `<li class="better">${sevTag(f.sev)} ${esc(f.title)}</li>`)) +
    list('New since the earlier run', F.added.map((f) => `<li class="worse">${sevTag(f.sev)} ${esc(f.title)}</li>`)) +
    list('Changed severity', F.changed.map((f) => `<li>${esc(f.title)}: ${esc(SEV_WORD[f.from])} → ${esc(SEV_WORD[f.to])}</li>`));
  const H = cmp.hosts;
  const hostsChg =
    list('Third-party domains removed', H.removed.map((h) => `<li class="better">${esc(h)}</li>`)) +
    list('Third-party domains added', H.added.map((h) => `<li class="worse">${esc(h)}</li>`));
  let filesChg = '';
  if (cmp.files) {
    const cap = (items, fn) => items.slice(0, 5).map((f) => `<li>${esc(fn(f))}</li>`).concat(items.length > 5 ? [`<li class="hint">…and ${items.length - 5} more</li>`] : []);
    filesChg =
      list('Files no longer loaded', cap(cmp.files.removed, histFileLine)) +
      list('New files', cap(cmp.files.added, histFileLine)) +
      list('Files that changed a lot', cap(cmp.files.changed, histChangedLine));
  }
  const anyDetail = findingsChg || hostsChg || filesChg;

  return `<h2>Since the last run</h2>
    <div class="cmpbar"><label for="baseSel">Compare with</label><select id="baseSel">${options}</select></div>
    <div class="cmpsum"><span class="better">${s.better} better</span> · <span class="worse">${s.worse} worse</span> · <span class="same">${s.same} unchanged</span></div>
    ${warn}
    <div class="scroll tall"><table class="cmp"><thead><tr><th>Measure</th><th class="num">Earlier run</th><th class="num">This run</th><th class="num">Change</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="hint">Differences smaller than normal run-to-run variation count as unchanged. Timings vary between loads of the same page, so repeat the test before trusting a small change; counts (requests, domains, files) are exact.</div>
    ${anyDetail ? `<div class="chg">${findingsChg}${hostsChg}${filesChg}</div>` : ''}
    ${noteRow}`;
}

// ---------- Popup: run history list ----------

function histRowsHtml() {
  const c = current;
  return c.stored.map((r) => `<tr${r.id === c.snap.id ? ' class="thisrun"' : ''}>
    <td>${esc(fmtWhen(r.t))}${r.id === c.snap.id ? ' <span class="hint">(this run)</span>' : ''}</td>
    <td>${esc(MODE_SHORT[r.mode] || r.mode)}</td>
    <td class="num">${esc(histVal('ms', r.m.ttfb))}</td>
    <td class="num">${esc(histVal('ms', r.m.fcp))}</td>
    <td class="num">${esc(histVal('ms', r.m.lcp))}</td>
    <td class="num">${esc(histVal('n', r.m.requests))}</td>
    <td class="num">${esc(histVal('kb', r.m.kb))}</td>
    <td class="note" title="${esc(r.note)}">${esc(r.note)}</td>
    <td><button class="ds-btn ds-btn--text delRun" data-id="${esc(r.id)}" title="Delete this saved run" aria-label="Delete this saved run"><span class="lbl">Delete</span></button></td></tr>`).join('');
}

function historyHtml() {
  const c = current;
  return `<details class="hist"${histOpen ? ' open' : ''}>
    <summary>Run history for this page (${c.stored.length} saved)</summary>
    ${c.stored.length
      ? `<div class="scroll"><table><thead><tr><th>When</th><th>Load type</th><th class="num">TTFB</th><th class="num">FCP</th><th class="num">LCP</th><th class="num">Requests</th><th class="num">Size</th><th>Note</th><th></th></tr></thead><tbody id="histBody">${histRowsHtml()}</tbody></table></div>`
      : '<div class="hint">No saved runs for this page yet.</div>'}
    <div class="histctl">
      <label><input type="checkbox" id="saveToggle"${c.settings.save ? ' checked' : ''}> Save runs on this device</label>
      <button class="ds-btn ds-btn--text" id="clearPage"><span class="lbl">Clear this page</span>${ARROW}</button>
      <button class="ds-btn ds-btn--text" id="clearAll"><span class="lbl">Clear all pages</span>${ARROW}</button>
    </div>
    <div class="hint">Stored locally in this browser only. Keeps up to ${HIST.MAX_RUNS} runs for each of ${HIST.MAX_PAGES} pages. Pages are matched by host and path; query strings are ignored.</div>
  </details>`;
}

// Two-click confirmation without a dialog.
function armed(btn, label, action) {
  btn.onclick = () => {
    if (btn.dataset.armed) { action(); return; }
    btn.dataset.armed = '1';
    btn.querySelector('.lbl').textContent = 'Click again to confirm';
    setTimeout(() => { delete btn.dataset.armed; btn.querySelector('.lbl').textContent = label; }, 3000);
  };
}

function wireDeletes() {
  document.querySelectorAll('.delRun').forEach((b) => {
    b.onclick = async () => {
      await histDelete(current.key, b.dataset.id);
      await histRefresh(current);
      render();
    };
  });
}

function wireHistory() {
  const c = current;
  const sel = $('#baseSel');
  if (sel) {
    sel.onchange = () => {
      c.baseId = sel.value;
      c.cmp = compare(c.history.find((r) => r.id === c.baseId), c.snap);
      render();
    };
  }
  const note = $('#runNote');
  if (note) {
    note.oninput = () => { c.snap.note = note.value; };
    note.onchange = async () => {
      c.snap.note = note.value.trim();
      await histUpdate(c.key, c.snap.id, { note: c.snap.note });
      const mine = c.stored.find((r) => r.id === c.snap.id);
      if (mine) mine.note = c.snap.note;
      const body = $('#histBody');
      if (body) { body.innerHTML = histRowsHtml(); wireDeletes(); }
    };
  }
  const det = document.querySelector('details.hist');
  if (det) det.ontoggle = () => { histOpen = det.open; };
  wireDeletes();
  const tog = $('#saveToggle');
  if (tog) tog.onchange = async () => { c.settings = await histSetSettings({ save: tog.checked }); };
  const cp = $('#clearPage');
  if (cp) armed(cp, 'Clear this page', async () => { await histClear(c.key); await histRefresh(c); render(); });
  const ca = $('#clearAll');
  if (ca) armed(ca, 'Clear all pages', async () => { await histClear(null); await histRefresh(c); render(); });
}

// ---------- Report (Markdown for the AI) ----------

function changesMd(L) {
  const c = current;
  const cmp = c.cmp;
  const line = (s) => String(s || '').replace(/\s+/g, ' ').trim();

  // Trend across saved runs of this page (this run first)
  const runs = [c.snap, ...c.history].sort((a, b) => b.t - a.t).slice(0, 8);
  if (cmp || runs.length > 1) {
    L.push('## Run history for this page', '');
    L.push('Newest first. All runs are of the same host and path, measured in the same browser, so compare like with like (check the load type column).', '');
    L.push(mdTable(['Run', 'Load type', 'TTFB (ms)', 'FCP (ms)', 'LCP (ms)', 'Requests', 'Size (KB)', 'Third-party %', 'Owner\'s note'],
      runs.map((r) => [fmtWhen(r.t) + (r.id === c.snap.id ? ' (this run)' : ''), MODE_SHORT[r.mode] || r.mode,
        ok(r.m.ttfb) ? Math.round(r.m.ttfb) : '', ok(r.m.fcp) ? Math.round(r.m.fcp) : '', ok(r.m.lcp) ? Math.round(r.m.lcp) : '',
        r.m.requests, ok(r.m.kb) ? r.m.kb.toFixed(1) : '', r.m.thirdPct + '%', line(r.note)])), '');
  }
  if (!cmp) return;

  const b = cmp.base;
  L.push('## Changes since the earlier run', '');
  L.push(`Compared with the run on ${fmtWhen(b.t)} (${MODE_SHORT[b.mode] || b.mode}).`, '');
  if (line(c.snap.note)) L.push(`**What the site owner says they changed before this run:** ${line(c.snap.note)}`, '');
  if (line(b.note)) L.push(`**Owner's note on the earlier run:** ${line(b.note)}`, '');
  L.push(`Result: ${cmp.summary.better} measure(s) better, ${cmp.summary.worse} worse, ${cmp.summary.same} without a meaningful change.`);
  L.push('A timing or size only counts as better/worse when it moves by more than normal run-to-run variation (for example TTFB by at least 100 ms and 15%). Counts such as requests and domains are exact, so any change counts.', '');
  L.push(mdTable(['Measure', 'Earlier run', 'This run', 'Change', 'Verdict'],
    cmp.metrics.map((m) => [m.label, histVal(m.unit, m.before), histVal(m.unit, m.after), histDelta(m), VERDICT_WORD[m.verdict]])), '');

  const F = cmp.findings;
  const bullet = (title, items) => { if (items.length) { L.push(`**${title}**`, ''); items.forEach((i) => L.push(`- ${i}`)); L.push(''); } };
  bullet('Findings fixed since the earlier run', F.resolved.map((f) => `[${SEV_WORD[f.sev]}] ${f.title}`));
  bullet('New findings since the earlier run', F.added.map((f) => `[${SEV_WORD[f.sev]}] ${f.title}`));
  bullet('Findings whose severity changed', F.changed.map((f) => `${f.title}: ${SEV_WORD[f.from]} → ${SEV_WORD[f.to]}`));
  bullet('Third-party domains no longer used', cmp.hosts.removed);
  bullet('Third-party domains newly used', cmp.hosts.added);
  if (cmp.files) {
    const cap = (items, fn) => items.slice(0, 8).map(fn).concat(items.length > 8 ? [`…and ${items.length - 8} more`] : []);
    bullet('Files no longer loaded', cap(cmp.files.removed, histFileLine));
    bullet('New files', cap(cmp.files.added, histFileLine));
    bullet('Files whose time or size changed a lot', cap(cmp.files.changed, histChangedLine));
  }
  if (cmp.warnings.length) bullet('Comparability warnings', cmp.warnings);
}
