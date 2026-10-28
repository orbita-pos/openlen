const { chromium, expect } = require('@playwright/test');
const path = require('node:path');
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const [width, height] of [[390, 844], [360, 640]]) {
      const context = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true, locale: 'es-MX' });
      const page = await context.newPage();
      const errores = [];
      page.on('pageerror', error => errores.push(error.message));
      await page.goto('http://127.0.0.1:5175/?muestra=1');
      await page.getByRole('button', { name: 'Pedir un cambio', exact: true }).tap();
      const chat = page.locator('.lm-chat.is-on');
      await expect(chat.locator('.ch-day').first()).toBeAttached();
      await chat.locator('.ch-st').evaluate(el => {
        el.textContent = 'Len está trabajando…';
        el.classList.add('is-on');
      });
      await expect.poll(() => chat.evaluate(el => el.getAnimations({ subtree: true }).filter(a => a.playState === 'running' && a.effect.getTiming().iterations !== Infinity).length)).toBe(0);
      await chat.locator('.ch-log').evaluate(el => { el.scrollTop = 0; });
      const comprobar = async () => {
        await expect.poll(() => chat.evaluate(el => {
          const h = el.querySelector('.ch-top').getBoundingClientRect();
          return el.querySelector('.ch-log').getBoundingClientRect().top - h.bottom;
        })).toBeGreaterThanOrEqual(-1);
        await chat.locator('.ch-log').evaluate(el => { el.scrollTop = 0; });
        await expect.poll(() => chat.evaluate(el => {
          const h = el.querySelector('.ch-top').getBoundingClientRect();
          const d = el.querySelector('.ch-day').getBoundingClientRect();
          return d.top - h.bottom;
        })).toBeGreaterThanOrEqual(8);
        const header = await chat.locator('.ch-top').boundingBox();
        const day = await chat.locator('.ch-day').first().boundingBox();
        const log = await chat.locator('.ch-log').boundingBox();
        expect(day.y).toBeGreaterThanOrEqual(header.y + header.height + 8);
        expect(log.y).toBeGreaterThanOrEqual(header.y + header.height - 1);
      };
      await comprobar();
      // Insets como los que publica Capacitor y una ventana reducida por IME.
      await page.evaluate(() => {
        document.documentElement.style.setProperty('--safe-area-inset-top', '28px');
        document.documentElement.style.setProperty('--safe-area-inset-bottom', '26px');
      });
      await expect.poll(() => page.locator('.app-lienzo').evaluate(el => parseFloat(getComputedStyle(el).getPropertyValue('--app-arriba')))).toBe(28);
      await comprobar();
      await page.screenshot({ path: path.resolve(`reports/movil-etapas/chat-${width}-fecha-visible.png`) });
      await page.setViewportSize({ width, height: 460 });
      await expect(page.locator('.lm-screen')).toHaveClass(/con-teclado/);
      await chat.locator('.ch-log').evaluate(el => { el.scrollTop = 0; });
      await comprobar();
      await page.screenshot({ path: path.resolve(`reports/movil-etapas/chat-${width}-teclado-fecha.png`) });
      expect(errores).toEqual([]);
      await context.close();
      console.log(`${width}: fecha bajo cabecera dinámica, insets Android y teclado`);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
