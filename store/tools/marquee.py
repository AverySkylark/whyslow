# WhySlow store image tools. Not part of the extension.
# Needs: pip install playwright pillow && playwright install chromium
# 1) python preview/serve.py   (in another terminal, from the repo root)
# 2) python store/tools/shoot.py     -> screenshots/{light,dark}-NN-view.png
# 3) python store/tools/store.py / tile.py / marquee.py -> store/screenshots/
import os; ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'..','..')); os.chdir(ROOT)
os.makedirs('screenshots',exist_ok=True); os.makedirs('store/screenshots',exist_ok=True)
import asyncio, base64
from playwright.async_api import async_playwright
d=base64.b64encode(open('screenshots/light-02-overview.png','rb').read()).decode()
SVG='<svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5"/><path d="M9 2h6"/></svg>'
HTML=f'''<html><style>*{{margin:0;box-sizing:border-box}}body{{width:1400px;height:560px;overflow:hidden;font-family:"DM Sans",sans-serif;color:#fff;
background:radial-gradient(circle at 90% 0%,#3d7bff 0%,transparent 55%),linear-gradient(135deg,#1c5fd9,#0c3a96);display:flex;align-items:center;padding:0 90px}}
.t{{flex:1}}.r{{display:flex;align-items:center;gap:16px}}h1{{font-size:64px;font-weight:700;letter-spacing:-.01em}}
p{{font-size:30px;line-height:1.3;margin:22px 0 36px;color:#dbe7ff;max-width:600px}}
.bar{{display:flex;height:38px;width:560px;border-radius:8px;overflow:hidden;font-size:15px;font-weight:600;letter-spacing:.05em;text-transform:uppercase}}
.bar div{{display:flex;align-items:center;padding-left:12px}}.a{{width:32%;background:#fff;color:#0c3a96}}.b{{width:30%;background:#9fc0ff;color:#0c3a96}}.c{{flex:1;background:rgba(255,255,255,.22)}}
img{{width:420px;margin-top:150px;border-radius:14px;box-shadow:0 30px 80px rgba(0,10,40,.45)}}</style>
<body><div class="t"><div class="r">{SVG}<h1>WhySlow</h1></div><p>Find out why a page feels slow, then hand the brief to your AI.</p>
<div class="bar"><div class="a">Server</div><div class="b">Block</div><div class="c">Render</div></div></div>
<img src="data:image/png;base64,{d}"></body></html>'''
async def main():
  async with async_playwright() as p:
    b=await p.chromium.launch(); pg=await b.new_page(viewport={'width':1400,'height':560})
    await pg.set_content(HTML); await pg.wait_for_timeout(300); await pg.screenshot(path='store/screenshots/whyslow-promo-marquee-1400x560.png'); await b.close()
asyncio.run(main())
from PIL import Image; import glob
for f in glob.glob('store/screenshots/*.png'): Image.open(f).convert('RGB').save(f)
