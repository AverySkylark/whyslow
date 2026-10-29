# WhySlow (Chrome extension)

Finds out why a website feels slow. The popup shows a quick snapshot (server response, paint times, request totals, third-party share, render-blocking files, script blocking time) with the most likely causes ranked, and exports an **AI-ready Markdown brief** you can paste into an AI assistant to diagnose the problem.

## Install (unpacked)

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** and pick this folder (the one containing `manifest.json`)
4. Pin the extension from the puzzle-piece menu
5. Optional: add the General Sans font files, see [fonts/README.md](fonts/README.md). Without them the popup uses Arial.

## Use

- **Cold load**: reloads the tab bypassing the cache, then measures. A realistic first visit, and it captures the response headers needed for compression and Cache-Control checks.
- **Warm load**: reloads the tab normally, using the browser cache, then measures. A repeat visit; compare it with a cold load to see whether caching works.
- **Measure the page as it is**: reads what the tab already loaded, without reloading. The cache state is unknown.
- **Test another page**: type a domain or address; it loads cold in a background tab, is measured, and the tab closes. Pages you tested before are suggested.
- **Copy AI brief**: copies the diagnosis brief to the clipboard, ready to paste into an AI chat. The ▴ next to it adds a question on top.
- **Save .md**: saves the same brief to your Downloads folder.
- **Details → Export CSV**: every request with its timings, for spreadsheets.
- **Next, give the report to an AI** (panel above the buttons): explains the paste-into-an-AI-chat step and offers example questions (why is it slow, plain English, WordPress/CMS, message to your host, did my change help). Each copies the report with that question on top.

- **Theme**: the switch next to the version label cycles auto, light and dark. Auto follows your system.

## Fix and retest

Every run is saved on your device. Test a page, make a change, test it again the same way, and the popup shows **Since the last run**: each measure before and after, which findings were fixed or are new, third-party domains added or removed, and files that disappeared, appeared or changed a lot. Small differences within normal load-to-load variation show as unchanged. You can compare against any earlier run, and add a note ("enabled page cache") that goes into the AI report so the assistant knows what you changed. Use **Run history** at the bottom to delete runs, clear a page, or turn saving off. Pages are matched by host and path.

## What the AI report contains

A ready-made prompt, test context, a run history and "changes since the earlier run" section (when the page has been tested before), a snapshot with good/poor ratings, a timeline, ranked findings with evidence, time and bytes by file type / first-party vs third-party / domain, render-blocking files, the 15 slowest and largest files, a full file table, and a "limits of this data" section so the AI knows what it can't conclude.

## Notes

- Cross-origin files without a `Timing-Allow-Origin` header hide size and timing detail; they show as "–".
- Chrome blocks extensions on `chrome://` pages and the Chrome Web Store.
- Timings come from your own browser and connection, so repeat the test and compare rather than treating one run as exact.
- Server-side causes (database, CMS, PHP) can only be inferred from TTFB; the report says so.

## Design

The popup uses the "Website v2" design system: monochrome, pill buttons, no shadows. All colour, type, spacing and radius tokens live in `tokens.css`; no other file contains colour values.

## Licence

The extension code has no licence file yet; add one before making the repository public. General Sans is a separate work under the ITF Free Font License and is not included here.
