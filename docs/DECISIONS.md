# Decisions

## 2026-10-21 Restyle with Strata and a style dropdown
**Chose:** Copy Strata's built `strata.css` into the extension; `tokens.css` maps our variables to `--st-*`; a `<select>` switches preset+mode (6 options), saved as `wsStyle`. Panels use the accent tint, not grey.
**Alternative:** Keep the Website v2 monochrome tokens; or rebuild components with Strata's `st-` classes.
**Why:** Owner asked for Strata, no grey, and a dropdown of styles (like Strata's own theme picker). Mapping variables kept the popup markup unchanged. Colours for status added because the preset supplies them (inferred: grey removal implies colour is now welcome).

## 2026-10-24 Popup as a 360 px mini app (2.0.0)
**Chose:** Option E from the design canvas: fixed 360 × 480 popup with header, tabs (Overview, Causes, Blocking, History), one scrolling view and a pinned action bar (Copy AI brief ▴, Save .md, Details). Details widens the popup to 780 px for the full tables.
**Alternative:** Keep the 780 px scrolling page (1.7.0); options A–D on the canvas (verdict + tiles, tabs only, dense DevTools rows, timeline hero); a Chrome side panel.
**Why:** Owner wanted it to feel like an app, not a web page, with space treated as scarce. E combines the parts they picked: A's bottleneck verdict, B's tabs, C's bottom buttons, D's headline time and Server/Block/Render bar. The wide tables (domains, all files) don't fit 360 px, so Details widens instead of cramming them. A side panel remains the fallback if people need results to persist when the popup closes.

## 2026-10-24 Drop the style picker (2.0.1)
**Chose:** One look: Strata's Keystone preset, light or dark following the system. Removed the style dropdown, `wsStyle` and theme.js.
**Alternative:** Keep the six-option dropdown from 1.7.0.
**Why:** Owner called it a bad idea: it added a control to a space-starved popup and did nothing to explain why a page is slow.

## 2026-10-24 Light/dark button (2.1.0)
**Chose:** A sun/moon icon in the header that flips between light and dark and remembers it (`wsMode`). Until it is used, the popup follows the system.
**Alternative:** Bring back the style dropdown; or a three-way auto/light/dark control.
**Why:** Owner's browser runs dark and wanted a quick way out without the old picker. A two-state toggle is one icon; the trade-off is there is no way back to "follow the system" short of clearing the extension's storage.
