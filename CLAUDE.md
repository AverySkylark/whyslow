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
| `strata.css` | Copy of the built Strata core CSS (`C:\dev\apps\Strata\packages\core\dist\strata.css`): presets keystone, glass, meridian. Re-copy after rebuilding Strata. |
| `mode.js` | Applies a saved light/dark choice (`wsMode` in localStorage) to `<html data-mode>` before first paint. No saved choice = follow the system. The header button `#btnMode` (in `popup.js`) toggles and saves it. |
| `tokens.css` | Maps WhySlow's variables (`--bg`, `--ink`, `--action`, ...) onto Strata `--st-*` tokens. The only place colour roles are chosen. |
| `fonts/` | Bundled General Sans Regular and Medium woff2 (unmodified; ITF Free Font License in `fonts/FFL.txt`: no subsetting or conversion). |
| `popup.html` / `popup.css` / `popup.js` | UI (360 px mini app, see Popup layout), analysis (`build()`), rendering, AI report (`report()`), CSV. Light and dark theme via CSS variables. |
| `history.js` | Saved runs and "since the last run" comparison. Loaded before `popup.js` and shares its globals. Storage, `snapshot()`, `compare()`, popup section, history list and the report's comparison section (`changesMd()`). |
| `icons/` | Generated PNG icons (16, 32, 48, 128). |
| `README.md` | Install and usage notes. |
| `store/` | Chrome Web Store listing copy (`listing.md`) and privacy policy (`privacy-policy.md`). Not part of the extension; leave out of the package zip. Keep the permission justifications and policy in step with `manifest.json` and any new data the extension stores. |
| `build.ps1` | Builds the Web Store zip: `.\build.ps1` (`-Force` to overwrite, `-OutDir` to change folder). Checks the manifest, required files, that everything popup.html loads is packed, and JS syntax (if Node is installed). Packs an allow-list (`$Files`, `$Dirs`): add new extension files there. Not part of the extension. |
| `package.py` | Older Python packager; same allow-list idea but still packs `fonts/`. Superseded by `build.ps1`. |
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

## Popup layout (2.0)

- A 360 × 480 px mini app (`body.has-results`): header (`.bar`: name, host, light/dark `#btnMode`, Run again `#btnAgain`, ⋯ `#btnMenu`), tabs (`#tabs`), one scrolling view (`#main` > `#results`), and an action bar pinned to the bottom (`#footer`).
- Before the first run the popup shows only the start panel `#launch` (Reload & analyze, Analyze as loaded, Test URL, and an About line `.about` with the version `#ver` and a one-load data caveat). After a run the same element becomes the ⋯ menu (`body.menu-open`), so the run buttons keep their ids and handlers.
- Views are held in `view` (`overview | causes | blocking | history | details`); `go(v)` switches and re-renders. `render()` picks `overviewHtml / causesHtml / blockingHtml / detailsHtml`, or `changesHtml() + historyHtml()` for History.
- Overview: verdict box (worst high/medium finding, preferring a cause over the LCP/FCP symptoms; plain headline from `HEADLINE`, first sentence of its detail), the headline time (LCP, else FCP, else load) with a rating badge, a bar split into Server (to TTFB), Block (TTFB to FCP) and Render (FCP to LCP), one line of totals, "Also found" (next 4 findings, open Causes), and "Since the last run" when a comparison exists.
- `segOf(finding)` maps each finding to a bar segment; the colour squares in Causes and Overview use the same `.c-srv / .c-blk / .c-rnd` classes as the bar.
- Details widens the popup to 780 × 600 (`body.wide`) and shows the terminal panel, all measure cards, domain and file-type tables, and the sortable All files table with type filters and Export CSV (`#btnCsv`, wired in `render()`).
- Action bar: **Copy AI brief** (`#btnCopy`), ▴ (`#btnAsk`) opens `#aiMenu` with the `AI_PROMPTS` questions (each copies the question plus the full report; the menu heading and toast must keep saying the report is included; `needsCmp` entries only show with a comparison), **Save .md** (`#btnMd`) and **Details** (`#btnDetails`, becomes Close).
- Feedback for copy and export goes through `toast(cls, text)` (`#toast`, `done` / `fail`); `aiSay()` and `exportNote()` call it.
- Menus and the toast are `position: absolute` against `body` (not fixed), so they stay inside the popup in the preview too. Escape and outside clicks close them.
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
- Package: run `.\build.ps1` from this folder. It writes `whyslow-<version>.zip` here with `manifest.json` at the zip root and refuses to overwrite an existing version, so bump the version first.

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

- Version 2.1.3 (version moved from the header to an About line at the bottom of the start panel / ⋯ menu, with a short "one load, repeat before acting" caveat; 2.1.2 run history: Delete links replaced by bin icon buttons; 2.1.1 History tab: saved-run controls as settings rows with a switch and red Clear / Clear all buttons showing run counts, two-click "Confirm clear"; 2.1.0 sun/moon button in the header switches light and dark, saved as wsMode via mode.js; follows the system until first used; 2.0.1 style picker removed: always Keystone, light or dark follows the system; theme.js no longer used; 2.0.0 redesigned as a 360 × 480 px mini app from design option E: tabs Overview / Causes / Blocking / History, verdict box, Server-Block-Render load bar, bottom bar Copy AI brief ▴ / Save .md / Details; Details widens to 780 px for the full tables; start panel doubles as the ⋯ menu; AI question chips moved into the ▴ menu; history table trimmed to When / TTFB / LCP; report and CSV format unchanged; checked in the preview stub in Keystone light and Glass dark, not yet in real Chrome; 1.7.0 restyled with Strata; style dropdown with Keystone, Glass, Meridian in light and dark replaces the theme button; panels tinted instead of grey; status uses success/warning/danger colours alongside the text labels; General Sans no longer used, fonts/ kept for now; 1.6.0 AI prompt chips and Copy report pinned to the bottom of the popup; findings, domain times, file-type totals and all files collapsed into one details block; 1.5.2 comment-only change in tokens.css; 1.5.1 no focus ring on popup open; terminal panel says "Reused or cached" when DNS and connection were not measured; 1.5.0 theme switch: auto, light, dark, saved in localStorage as wsTheme via theme.js; 1.4.0 restyled with the Website v2 design system: monochrome, pill buttons, terminal timings panel, status shown by weight and text labels, bundled General Sans; report format unchanged; not yet loaded in real Chrome, checked in a mocked page in light and dark; 1.3.1 clearer AI hand-off panel: buttons say they copy the full report plus a question; report limits now mention lab vs field data and mobile CPUs; 1.3.0 added a version label next to the popup title; 1.2.0 added the AI hand-off panel, a shorter manifest description and bottom spacing fixes; 1.1.0 added saved runs and "since the last run"; 1.2.0 adds the AI hand-off panel, a shorter manifest description and bottom spacing fixes). Logic exercised against mock data in Node, including a fake `chrome.storage`; not yet run in a real Chrome session, so first-run bugs are possible.

## Ideas / next steps

- Side-by-side comparison of two URLs.
- Multiple runs per measurement with median values, so the noise thresholds can be tightened.
- Export/import of saved history as JSON.
- Waterfall chart of request timing.
- Optional report sections for server hints (response headers such as Server, X-Powered-By, cache plugins) to help AI infer CMS/PHP causes.
- Chrome Web Store: listing copy and privacy policy are drafted in `store/`; still needed are screenshots, promo tile, a hosted privacy policy URL and the developer registration.
