# Fonts

WhySlow uses **General Sans** (Regular 400 and Medium 500) from Fontshare, under the
[ITF Free Font License](FFL.txt). The licence forbids redistributing the font files through
public servers, so the `.woff2` files are not in this repository. Without them the popup falls
back to Arial and everything still works.

To add them:

1. Download the General Sans family from https://www.fontshare.com/fonts/general-sans
2. From the zip, copy these two files, unmodified (no subsetting or conversion), into this folder:
   - `GeneralSans-Regular.woff2`
   - `GeneralSans-Medium.woff2`
3. Reload the extension at `chrome://extensions`.

Packaging for the Chrome Web Store: the files must be in this folder when you build the zip.
