# WhySlow store image tools. Not part of the extension.
# Needs: pip install playwright pillow && playwright install chromium
# 1) python preview/serve.py   (in another terminal, from the repo root)
# 2) python store/tools/shoot.py     -> screenshots/{light,dark}-NN-view.png
# 3) python store/tools/store.py / tile.py / marquee.py -> store/screenshots/
import os; ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'..','..')); os.chdir(ROOT)
os.makedirs('screenshots',exist_ok=True); os.makedirs('store/screenshots',exist_ok=True)
import asyncio
from playwright.async_api import async_playwright
SVG='<svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5"/><path d="M9 2h6"/></svg>'
HTML=f'''<html><style>*{{margin:0;box-sizing:border-box}}body{{width:440px;height:280px;overflow:hidden;font-family:"DM Sans",sans-serif;color:#fff;
background:radial-gradient(circle at 85% 0%,#3d7bff 0%,transparent 55%),linear-gradient(135deg,#1c5fd9,#0c3a96);padding:34px 36px}}
.r{{display:flex;align-items:center;gap:12px}}h1{{font-size:40px;font-weight:700;letter-spacing:-.01em}}
p{{font-size:21px;line-height:1.3;margin:16px 0 26px;color:#dbe7ff;max-width:340px}}
.bar{{display:flex;height:26px;border-radius:6px;overflow:hidden;font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase}}
.bar div{{display:flex;align-items:center;padding-left:9px}}
.a{{width:32%;background:#fff;color:#0c3a96}}.b{{width:30%;background:#9fc0ff;color:#0c3a96}}.c{{flex:1;background:rgba(255,255,255,.22)}}</style>
<body><div class="r">{SVG}<h1>WhySlow</h1></div><p>Find out why a page feels slow, then hand the brief to your AI.</p>
<div class="bar"><div class="a">Server</div><div class="b">Block</div><div class="c">Render</div></div></body></html>'''
async def main():
  async with async_playwright() as p:
    b=await p.chromium.launch(); pg=await b.new_page(viewport={'width':440,'height':280})
    await pg.set_content(HTML); await pg.wait_for_timeout(300); await pg.screenshot(path='store/screenshots/whyslow-promo-small-440x280.png'); await b.close()
asyncio.run(main())
from PIL import Image; import glob
for f in glob.glob('store/screenshots/*.png'): Image.open(f).convert('RGB').save(f)
