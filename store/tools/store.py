# WhySlow store image tools. Not part of the extension.
# Needs: pip install playwright pillow && playwright install chromium
# 1) python preview/serve.py   (in another terminal, from the repo root)
# 2) python store/tools/shoot.py     -> screenshots/{light,dark}-NN-view.png
# 3) python store/tools/store.py / tile.py / marquee.py -> store/screenshots/
import os; ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'..','..')); os.chdir(ROOT)
os.makedirs('screenshots',exist_ok=True); os.makedirs('store/screenshots',exist_ok=True)
import asyncio, base64
from playwright.async_api import async_playwright
S='file://screenshots/'
slides=[
 ('1-overview','light-02-overview','The verdict first','One click times the page and names the most likely cause, with the load split into server, blocking and render time.'),
 ('2-causes','light-03-causes','Every likely cause, ranked','Findings sorted by severity, from slow server response to render-blocking files and heavy JavaScript.'),
 ('3-ai-brief','light-06-ai-menu','Hand it to your AI','Copy a structured Markdown brief with evidence and limits, or copy it with a ready-made question.'),
 ('4-history','dark-05-history','Did my change help?','Every run is saved in your browser. Compare against an earlier run to see what got better or worse.'),
 ('5-details','light-08-details','All the detail when you want it','Every measure, domain and file, sortable and filterable, with CSV export.'),
]
CSS='''*{margin:0;box-sizing:border-box}body{width:1280px;height:800px;font-family:"DM Sans",sans-serif;
background:linear-gradient(135deg,#eef3ff 0%,#dfe8fb 100%);color:#0f1a2e;display:flex;align-items:center;overflow:hidden}
.t{width:500px;padding:0 40px 0 90px}.k{font-size:15px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:#1c5fd9;margin-bottom:18px}
h1{font-size:48px;line-height:1.08;font-weight:700;margin-bottom:22px}p{font-size:21px;line-height:1.45;color:#3a4660}
.s{flex:1;display:flex;justify-content:center}img{border-radius:14px;box-shadow:0 30px 70px rgba(20,40,90,.25),0 0 0 1px rgba(20,40,90,.08)}
body.w{flex-direction:column;justify-content:center;gap:26px}body.w .s{flex:none}body.w .t{width:auto;padding:0;text-align:center}body.w h1{font-size:38px;margin-bottom:8px}body.w p{font-size:18px}body.w .k{margin-bottom:8px}'''
async def main():
  async with async_playwright() as p:
    b=await p.chromium.launch(); pg=await b.new_page(viewport={'width':1280,'height':800})
    for n,img,h,t in slides:
      wide='details' in n
      d=base64.b64encode(open(f'screenshots/{img}.png','rb').read()).decode()
      im=f'<img src="data:image/png;base64,{d}" style="width:{780 if wide else 500}px">'
      html=f'<html><style>{CSS}</style><body class="{"w" if wide else ""}"><div class="t"><div class="k">WhySlow</div><h1>{h}</h1><p>{t}</p></div><div class="s">{im}</div></body></html>'
      await pg.set_content(html); await pg.wait_for_timeout(300)
      await pg.screenshot(path=f'store/screenshots/whyslow-store-{n}.png')
    await b.close()
asyncio.run(main())
from PIL import Image; import glob
for f in glob.glob('store/screenshots/*.png'): Image.open(f).convert('RGB').save(f)
