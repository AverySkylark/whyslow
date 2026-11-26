# WhySlow store image tools. Not part of the extension.
# Needs: pip install playwright pillow && playwright install chromium
# 1) python preview/serve.py   (in another terminal, from the repo root)
# 2) python store/tools/shoot.py     -> screenshots/{light,dark}-NN-view.png
# 3) python store/tools/store.py / tile.py / marquee.py -> store/screenshots/
import os; ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'..','..')); os.chdir(ROOT)
os.makedirs('screenshots',exist_ok=True); os.makedirs('store/screenshots',exist_ok=True)
import asyncio, sys
from playwright.async_api import async_playwright
U='http://localhost:8765/'
async def main():
  async with async_playwright() as p:
    b=await p.chromium.launch()
    for mode in ['light','dark']:
      ctx=await b.new_context(viewport={'width':800,'height':640},device_scale_factor=2,color_scheme=mode)
      pg=await ctx.new_page()
      errs=[]; pg.on('pageerror',lambda e: errs.append(str(e)))
      async def snap(n):
        await pg.wait_for_timeout(350); await pg.locator('body').screenshot(path=f'screenshots/{mode}-{n}.png')
      await pg.goto(U+'?manual'); await pg.wait_for_timeout(500); await snap('01-start')
      await pg.click('#btnReload'); await pg.wait_for_timeout(1200)
      # second run so History has a comparison
      await pg.click('#btnAgain'); await pg.wait_for_timeout(1200)
      await pg.evaluate('document.activeElement.blur()'); await pg.mouse.move(5,400); await snap('02-overview')
      for i,v in enumerate(['causes','blocking','history'],3):
        await pg.click(f'#tabs .tab[data-view="{v}"]'); await snap(f'0{i}-{v}')
      await pg.click('#tabs .tab[data-view="overview"]')
      await pg.click('#btnAsk'); await snap('06-ai-menu'); await pg.keyboard.press('Escape')
      await pg.click('#btnMenu'); await snap('07-menu'); await pg.keyboard.press('Escape')
      await pg.click('#btnDetails'); await snap('08-details')
      print(mode, errs)
      await ctx.close()
    await b.close()
asyncio.run(main())
