# WhySlow privacy policy

Effective 17 October 2026

WhySlow is a Chrome extension that helps you find out why a website feels slow. This policy explains what data it handles. The short version: everything stays in your browser, and nothing is sent to the developer or anyone else.

## What WhySlow does and does not do

- It has no server, no account, no analytics, no advertising and no tracking.
- It does not send any data over the network. It makes no requests of its own.
- It does not sell or share data, and does not load or run code, fonts or other files from the internet.

## Data WhySlow handles, and where it lives

All of this stays on your device.

1. **Page measurements.** When you run a test, WhySlow reads performance data from the page you chose: its address and title, load timings, the list of files it loaded (addresses, sizes, timings, types) and basic page metrics. This is shown in the popup.
2. **Response header details.** While the extension is installed, it reads these response headers for web requests: status, content-encoding, cache-control, content-length and server. It uses them for compression and caching checks. They are kept per tab in temporary browser session storage and removed when the tab closes or the browser session ends. They are not written to disk as history.
3. **Run history.** Each test you run is saved in the extension's local storage so it can show what changed since your last run. A saved run holds the page address and title, the measurements, a list of findings, third-party domain names, up to 150 file addresses with timings and sizes, and any note you type. It keeps up to 15 runs for each of 30 pages and discards the oldest.
4. **Settings.** Whether run saving is on or off, and your light, dark or automatic theme choice.

## Your control

- Turn saving off, delete single runs, clear one page's history or clear all history under "Run history" in the popup.
- Uninstalling the extension deletes all of its stored data.

## What leaves your device

Only what you choose to export. "Copy report", "Export report" and "Export CSV" put your test results on your clipboard or in a file you save. The report includes the tested page's address and the addresses of the files it loaded.

If you paste a report into an AI assistant or share it, that service's own privacy policy applies. Avoid sharing reports from private, logged-in or internal pages, since addresses can reveal sensitive paths or names.

## Permissions

WhySlow asks for scripting, tabs, webRequest, storage, clipboardWrite and access to all sites. These are used only for the features described above: measuring a page you choose, reading response headers, saving your history locally and copying your report. They are not used to collect or transmit browsing data.

## Children

WhySlow is a developer tool and is not directed at children.

## Changes

If this policy changes, the new version will be published at the same address with a new effective date.

## Contact

Avery Skylark · whyslow@averyskylark.com
