# WhySlow: Chrome Web Store listing (draft)

Copy each block into the matching field in the Chrome Web Store Developer Dashboard. Items in [square brackets] need your input.

## Store listing tab

**Name** (max 75 characters)
WhySlow: Find Out Why a Website Is Slow

**Short description** (max 132 characters; this is the `description` in `manifest.json`)
Finds out why a website feels slow. Shows a load snapshot and exports an AI-ready Markdown report to paste into an assistant.

**Category:** Developer Tools
**Language:** English

**Detailed description**

Is a website slow, and you don't know why? WhySlow measures the page, shows you the headline numbers, and writes a report you can paste straight into an AI assistant to work out the cause.

HOW IT WORKS
1. Open the page you want to check and click the WhySlow icon.
2. Click "Reload & analyze" for a realistic first-visit test, or "Analyze tab" for what is already loaded. You can also type any address under "Test URL".
3. Read the snapshot, then copy the AI report and paste it into Claude, ChatGPT, Gemini or any other assistant. The report already contains instructions, so there is nothing to write.

WHAT YOU GET
• A quick snapshot: server response (TTFB), first paint, main content, layout shift, requests, total size, third-party share, render-blocking files, script blocking time, domains and DOM size, each rated good, needs improvement or poor.
• The most likely causes of slowness, ranked, with evidence and file names.
• An AI-ready Markdown report: a built-in prompt, test context, ranked findings, where time and bytes go, the slowest and largest files, and an honest "limits of this data" section so the AI doesn't guess.
• One-click example questions: why is it slow, explain it simply, WordPress/CMS angle, a message to send your host or developer.
• Fix and retest: every run is saved on your device. After you change something, WhySlow shows what improved, what got worse, which findings were fixed, and which files appeared or disappeared. Small differences within normal load-to-load variation are marked as unchanged. Add a note ("enabled page cache") and it goes into the report so the AI knows what you changed.
• Exports: Markdown report, copy to clipboard, and CSV of every request.
• Light and dark themes, with a switch in the popup. Auto follows your system.

PRIVATE BY DESIGN
WhySlow has no servers, no account, no analytics and no ads. All measuring and all saved history stay in your browser. The only things that leave are the reports you choose to copy or download.

GOOD TO KNOW
• Timings come from your own browser and connection. Repeat the test and compare rather than treating one run as exact.
• Server-side causes (database, CMS, PHP) can only be inferred from the server response time. The report says so.
• Chrome blocks extensions on chrome:// pages and the Chrome Web Store.

## Privacy practices tab

**Single purpose**
WhySlow diagnoses why a web page loads slowly. It measures a page's load performance, shows a summary with the most likely causes, and exports a report for the user to give to an AI assistant.

**Permission justifications**

- `scripting`: Injects a read-only measurement function into the page the user chooses to analyze, to read the browser's own Performance API data (timings, file sizes, paint and layout-shift metrics). It does not change the page.
- `tabs`: Finds the active tab's address, reloads it with the cache bypassed for a cold-load test, and opens and closes a background tab for the "Test URL" feature.
- `webRequest`: Read-only. Reads response headers (status, content-encoding, cache-control, content-length, server) so the report can say whether files were compressed and cacheable. These cannot be read from the Performance API. It never blocks, modifies or redirects any request.
- `storage`: Saves the user's run history and the on/off setting for saving locally (`chrome.storage.local`), and holds captured response-header data temporarily for each tab (`chrome.storage.session`, removed when the tab closes).
- `clipboardWrite`: Lets the "Copy report" button put the Markdown report on the clipboard so the user can paste it into an AI assistant.
- Host permission `<all_urls>`: The user can analyze any website, so measuring and header capture must work on any http(s) page. WhySlow only reads performance data for the page being analyzed and sends nothing anywhere.

**Remote code:** No. All code, styles and fonts (General Sans, bundled) are packaged in the extension. Nothing is loaded or evaluated from the network, and there are no inline scripts.

**Data usage disclosure** (the dashboard wording changes over time, so check each box against the current form)

WhySlow handles the following only on the user's device and never transmits it:
- Web history: addresses and titles of pages the user tested, kept in the local run history.
- Website content: the list of files a tested page loaded, with timings and sizes.

Certify all three statements: data is not sold to third parties; not used or transferred for purposes unrelated to the single purpose; not used for creditworthiness or lending.

**Privacy policy URL:** https://averyskylark.com/whyslow/privacy/ (page source: `site/whyslow/privacy/index.html`; keep it in step with `privacy-policy.md`)

## Assets

- **Icon:** 128×128 already in `icons/icon128.png`.
- **Screenshots** (1–5, 1280×800 or 640×400). Suggested set, all on a real slow page:
  1. Popup top: snapshot cards and "Most likely causes of slowness".
  2. "Since the last run" table showing a before/after fix.
  3. The "Next, give the report to an AI" panel with the example question buttons.
  4. The Markdown report pasted into an AI chat, with the AI's answer.
- **Small promo tile** (required, 440×280): `store/promo/tile-light.png` or `tile-dark.png`.
- **Marquee tile** (optional, 1400×560): `store/promo/marquee-light.png` or `marquee-dark.png`. Sources are the matching `.html` files; re-render with headless Chrome after edits.

## Before you submit

- Register as a Chrome Web Store developer (one-time registration fee, US$5 when last checked).
- Make sure `fonts/GeneralSans-Regular.woff2` and `fonts/GeneralSans-Medium.woff2` are in the folder (they are not in the Git repository; see `fonts/README.md`), then build the package with `python package.py`. It writes `whyslow-<version>.zip` next to the project folder, with `manifest.json` at the zip root, and leaves out `store/`, `reference/`, `CLAUDE.md`, `README.md`, `.gitignore` and `package.py`. It stops if the fonts are missing.
- Bump `version` in `manifest.json` for every upload; the store rejects a version it has already seen.
- Upload the zip, then fill in the listing and privacy tabs from this file.
- Expect a slower review: `<all_urls>` plus `webRequest` triggers extra scrutiny. The justifications above are written for that.
- Set the support/homepage URL: https://averyskylark.com/whyslow/ (page source: `site/whyslow/index.html`).
- Test the packaged zip once by unzipping it and loading it unpacked before uploading.
