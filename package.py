"""Build the Chrome Web Store package: python package.py
Writes whyslow-<version>.zip one folder above this one, with manifest.json at the zip root.
Not part of the extension itself."""
import json, os, sys, zipfile

root = os.path.dirname(os.path.abspath(__file__))
os.chdir(root)
version = json.load(open("manifest.json", encoding="utf-8"))["version"]
files = ["manifest.json", "background.js", "popup.html", "popup.css", "popup.js", "history.js", "theme.js", "tokens.css"]
dirs = ["icons", "fonts"]
fonts = ["fonts/GeneralSans-Regular.woff2", "fonts/GeneralSans-Medium.woff2"]

missing = [f for f in files + fonts if not os.path.isfile(f)]
if missing:
    sys.exit("Missing files, see fonts/README.md: " + ", ".join(missing))

out = os.path.join(os.path.dirname(root), f"whyslow-{version}.zip")
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for f in files:
        z.write(f, f)
    for d in dirs:
        for r, _, names in os.walk(d):
            for n in sorted(names):
                if n.lower().endswith(".md"):
                    continue
                p = os.path.join(r, n)
                z.write(p, p.replace(os.sep, "/"))
print("Wrote", out)
