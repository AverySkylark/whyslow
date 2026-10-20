# WhySlow

Chrome extension (Manifest V3) that works out why a website feels slow.

## Point of difference

Two things set it apart from other speed tools:

1. **AI-ready diagnosis report.** It exports (or copies) a structured Markdown brief designed to be pasted into an AI assistant: a built-in prompt, test context, rated snapshot, ranked findings with evidence, where time and bytes go, the slowest and largest files, and an explicit "limits of this data" section. The goal is for the AI to determine likely causes of sluggish performance, not just list numbers.
2. **Instant snapshot in the popup.** Totals and key metrics at a glance (TTFB, FCP, LCP, CLS, requests, size, third-party share, render-blocking files, script blocking time, domains, DOM size) plus the top likely causes, so the user sees the headline before opening the report.

It began as a port of the PowerShell script `reference/site-timing.ps1`.

## What it does

- **Analyze this tab**: reads Performance API data for what the tab has already loaded.
- **Reload & analyze**: reloads the tab with the cache bypassed, then measures. Needed for compression and Cache-Control checks, because response headers are only captured while the extension is running.
- **Test URL**: opens a URL in a background tab, reloads it cold, measures it, closes the tab.
- Exports: AI report (.md download or clipboard copy) and CSV. Downloads go to the browser's Downloads folder only; extensions can't write to arbitrary paths.

## File layout

| File | Role |
|---|---|
| `manifest.json` | MV3 manifest. Permissions: scripting, tabs, webRequest, storage, clipboardWrite; host `<all_urls>`. |
| `background.js` | Service worker. Captures response headers per tab (webRequest, persisted in `chrome.storage.session`), injects `collect()` into the page, handles reload and background-tab flows. Message types: `analyzeTab`, `testUrl`. Adds `mode` (tab / reload / url) to results. |
| `tokens.css` | Design tokens from the "Website v2" design system (colour light/dark, type, spacing, radius) and the General Sans `@font-face`. The only place colour values are written. |
| `theme.js` | Applies the saved theme (`wsTheme` in localStorage) to `<html data-theme>` before first paint; the switch itself is in `popup.js`. |
| `fonts/` | Bundled General Sans Regular and Medium woff2 (unmodified; ITF Free Font License in `fonts/FFL.txt`: no subsetting or conversion). |
| `popup.html` / `popup.css` / `popup.js` | UI, analysis (`build()`), rendering, AI report (`report()`), CSV. Light and dark theme via CSS variables. |
| `history.js` | Saved runs and "since the last run" comparison. Loaded before `popup.js` and shares its globals. Storage, `snapshot()`, `compare()`, popup section, history list and the report's comparison section (`changesMd()`). |
| `icons/` | Generated PNG icons (16, 32, 48, 128). |
| `README.md` | Install and usage notes. |
| `store/` | Chrome Web Store listing copy (`listing.md`) and privacy policy (`privacy-policy.md`). Not part of the extension; leave out of the package zip. Keep the permission justifications and policy in step with `manifest.json` and any new data the extension stores. |
| `package.py` | Builds the Web Store zip (`python package.py`). Not part of the extension. |
| `reference/site-timing.ps1` | Original PowerShell script. Not part of the extension; kept for reference. |

## Architecture notes

- `collect()` in `background.js` runs inside the page, so it must stay fully self-contained. It gathers navigation and resource timing (including `renderBlockingStatus`), FCP, LCP, CLS (layout-shift), long tasks (approximate blocking time), DOM node count, redirects, and connection info.
- Data flow: popup sends a message, the service worker returns `{url, title, doc, resources, vitals, env, headers, mode}`, and `popup.js` `build()` turns it into rows, domains, types, origin split and `findings`.
- `findings` are objects `{sev: high|med|low|info, title, detail, items[]}` sorted by severity. They drive both the popup's "most likely causes" snapshot and the report's ranked findings. To add a check, add one `add(...)` call in `build()`.
- Rating thresholds use Google's published values (`RATE` in `popup.js`).
- Third-party detection compares registrable domains with a simple heuristic (`baseDomain`); it will treat a site's own CDN domain as third-party.
- Cross-origin files without `Timing-Allow-Origin` report zero sizes and timings; the UI shows these as "–".
- Connection timing (DNS/TCP/TLS) only appears on the first request per domain.
- Chrome's resource timing buffer holds about 250 entries by default; the tool notes when that limit may have truncated results.
- The service worker can be suspended by Chrome at any time, which is why header data is persisted in session storage.

## AI hand-off panel

- `#aiHelp` is a bar pinned to the bottom of the popup (`position: sticky`), so the prompt chips and **Copy report** stay in view while results scroll. `renderAiHelp()` in `popup.js` fills `#aiChips` and resets the status line; `aiSay()` shows copy feedback in `#aiStatus` (the report's Export buttons stay in `#footer` and use `exportNote()`). Chips wrap to at most two rows. `AI_PROMPTS` holds the example questions; a chip copies `question + report()` to the clipboard and a status line under the chips says exactly what was copied (the UI must keep making clear that the report is included). Entries with `needsCmp` only show when a comparison exists. Keep chip classes separate from `.chip` (that class is the file-type filter).

- The long diagnostic sections (findings, domain times, per-type totals, all files) sit in a collapsed `<details class="more">` in `render()`; its open state is kept in `detailsOpen` so filter clicks don't re-collapse it. Run history stays outside it.
- Local preview: `python preview/serve.py` then open http://localhost:8765/ (stubbed `chrome` API and sample data in `preview/stub.js`; add `?manual` to skip the auto-run). Not part of the package.

## Run history and comparison

- Every run is saved to `chrome.storage.local` (key `wsRuns`, setting `wsSettings.save`) by `attachHistory()`, called from `run()` right after `build()`. Nothing leaves the browser.
- A page is identified by host + path (`pageKey()`); query strings and hashes are ignored so cache-busting parameters don't split the history. Files are matched by origin + path (`fileKey()`) so `?ver=` bumps don't look like new files.
- A saved run is a compact `snapshot()`: metrics `m`, finding titles and severities, third-party hosts, and up to 150 of the slowest/largest files. Limits live in `HIST`: 15 runs per page, 30 pages, per-file lists kept for the 3 newest runs only. On a quota error the least recently tested other pages are dropped.
- `compare(base, cur)` marks a metric better/worse only if it beats both an absolute and a relative threshold (`METRICS`), so ordinary load-to-load noise reads as "unchanged". Counts (requests, domains) are exact.
- Default baseline: latest earlier run with the same load type, else the same warm/cold class, else the latest. The popup lets the user pick any earlier run.
- Warnings are raised for warm vs cold loads, headers captured in only one run, a different connection type, and missing/truncated file detail.
- The user can add a note to a run ("enabled page cache"); it appears in the history list and in the AI report as what changed between runs. The report also gets a run-history table and an extra prompt item asking the AI whether the change worked.
- To add a compared metric: add the value to `snapshot().m` and an entry to `METRICS`.

## Development

- No build step and no dependencies. Plain JS, HTML and CSS.
- Load it: `chrome://extensions` → Developer mode → Load unpacked → pick the folder containing `manifest.json`. After editing, click the reload icon on the extension card.
- Syntax checks: `node --check background.js && node --check popup.js` and validate `manifest.json` as JSON.
- Debug: inspect the popup (right-click the popup → Inspect) and the service worker (link on the extension card).
- Package: zip the folder contents so `manifest.json` is at the zip root, leaving out `store/`, `reference/`, `CLAUDE.md` and `README.md`.

## Versioning

- Bump `version` in `manifest.json` on EVERY change to the extension's code, styles or manifest, before finishing the task. Format `Major.small.minor`:
  - **Major**: big redesign or a change that breaks saved data.
  - **small**: a new feature or visible addition (e.g. run history, AI hand-off panel).
  - **minor**: a fix or tweak (spacing, wording, bug fix). Reset minor to 0 when small goes up, and small and minor to 0 when Major goes up.
- Update the "Status" line below to match. Docs-only edits don't need a bump.
- Chrome accepts up to four dot-separated numbers, so this three-part format is valid in the manifest.

## Conventions

- Vanilla JS, no frameworks or bundlers.
- Escape all page-derived strings with `esc()` before putting them in `innerHTML`.
- Report text is written for an AI reader: state numbers, thresholds and URLs explicitly, say what is uncertain, never overstate a heuristic as a conclusion.
- Timings come from the user's own browser and connection; treat them as relative comparisons, not exact figures.

## Status

- Version 1.6.0 (AI prompt chips and Copy report pinned to the bottom of the popup; findings, domain times, file-type totals and all files collapsed into one details block; 1.5.2 comment-only change in tokens.css; 1.5.1 no focus ring on popup open; terminal panel says "Reused or cached" when DNS and connection were not measured; 1.5.0 theme switch: auto, light, dark, saved in localStorage as wsTheme via theme.js; 1.4.0 restyled with the Website v2 design system: monochrome, pill buttons, terminal timings panel, status shown by weight and text labels, bundled General Sans; report format unchanged; not yet loaded in real Chrome, checked in a mocked page in light and dark; 1.3.1 clearer AI hand-off panel: buttons say they copy the full report plus a question; report limits now mention lab vs field data and mobile CPUs; 1.3.0 added a version label next to the popup title; 1.2.0 added the AI hand-off panel, a shorter manifest description and bottom spacing fixes; 1.1.0 added saved runs and "since the last run"; 1.2.0 adds the AI hand-off panel, a shorter manifest description and bottom spacing fixes). Logic exercised against mock data in Node, including a fake `chrome.storage`; not yet run in a real Chrome session, so first-run bugs are possible.

## Ideas / next steps

- Side-by-side comparison of two URLs.
- Multiple runs per measurement with median values, so the noise thresholds can be tightened.
- Export/import of saved history as JSON.
- Waterfall chart of request timing.
- Optional report sections for server hints (response headers such as Server, X-Powered-By, cache plugins) to help AI infer CMS/PHP causes.
- Chrome Web Store: listing copy and privacy policy are drafted in `store/`; still needed are screenshots, promo tile, a hosted privacy policy URL and the developer registration.
