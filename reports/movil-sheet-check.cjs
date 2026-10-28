const { chromium, expect } = require('@playwright/test');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const width of [390, 360]) {
      const height = width === 390 ? 844 : 640;
      const context = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true, locale: 'es-MX' });
      const page = await context.newPage();
      await page.goto('http://127.0.0.1:5175/?muestra=1');
      const sheet = page.locator('.app-main-sheet');
      await expect(sheet.locator('.lm-actions button').first()).toBeVisible();
      await expect.poll(() => sheet.evaluate(el => el.getAnimations().filter(a => a.playState === 'running').length)).toBe(0);
      const cdp = await context.newCDPSession(page);
      const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : [{ x, y }] });
      const metrics = () => sheet.evaluate(el => {
        const body = el.querySelector('.lm-body');
        return { top: el.getBoundingClientRect().top, bottom: el.getBoundingClientRect().bottom, height: el.offsetHeight, bodyHeight: body.offsetHeight, display: getComputedStyle(body).display, opacity: Number(getComputedStyle(body).opacity), min: el.classList.contains('is-min'), inert: body.inert };
      });
      const initial = await metrics();
      // El gesto comienza sobre un botón, lejos de la rayita y del encabezado.
      const button = await sheet.locator('.lm-actions button').first().boundingBox();
      const x = button.x + 20, y = button.y + button.height / 2;
      await touch('touchStart', x, y);
      await touch('touchMove', x, y + 20);
      await touch('touchMove', x, Math.min(height - 4, y + 70));
      await expect.poll(async () => (await metrics()).top).toBeGreaterThan(initial.top + 15);
      const during = await metrics();
      expect(during.height).toBe(initial.height);
      expect(during.bodyHeight).toBe(initial.bodyHeight);
      expect(during.opacity).toBeGreaterThan(0);
      expect(during.opacity).toBeLessThan(1);
      expect(during.bottom).toBeGreaterThanOrEqual(height - 1);
      await page.screenshot({ path: path.resolve(`reports/movil-etapas/sheet-${width}-arrastrando.png`) });
      await touch('touchMove', x, height - 2);
      await touch('touchEnd');
      await expect(sheet).toHaveClass(/is-min/);
      await expect.poll(async () => (await metrics()).opacity).toBe(0);
      const closed = await metrics();
      expect(closed.height).toBe(initial.height);
      expect(closed.bodyHeight).toBe(initial.bodyHeight);
      expect(closed.display).not.toBe('none');
      expect(closed.inert).toBe(true);
      await expect(page.locator('.lm-incoming,.lm-stage')).toHaveCount(0);
      await page.screenshot({ path: path.resolve(`reports/movil-etapas/sheet-${width}-cerrado.png`) });
      // Se abre desde el margen izquierdo, fuera de todos los hijos.
      const start = closed.top + 40;
      await touch('touchStart', 5, start);
      await touch('touchMove', 5, start - 20);
      await touch('touchMove', 5, start - 85);
      await touch('touchMove', 5, Math.max(65, start - 230));
      await touch('touchEnd');
      await expect(sheet).not.toHaveClass(/is-min/);
      await expect.poll(async () => (await metrics()).opacity).toBe(1);
      await expect.poll(async () => (await metrics()).top).toBeCloseTo(initial.top, 0);
      await page.screenshot({ path: path.resolve(`reports/movil-etapas/sheet-${width}-abierto.png`) });
      // Un toque normal sigue abriendo la gestión.
      await page.getByRole('button', { name: 'Publicar y gestionar', exact: true }).tap();
      await expect(page.locator('.app-gestion')).toBeVisible();
      await page.getByRole('button', { name: 'Cerrar', exact: true }).tap();
      // Cancelar no cambia el estado y tampoco deja una posición intermedia.
      const open = await metrics();
      await touch('touchStart', 5, open.top + 35);
      await touch('touchMove', 5, open.top + 95);
      await touch('touchCancel');
      await expect(sheet).not.toHaveClass(/is-min/);
      await expect.poll(async () => (await metrics()).top).toBeCloseTo(open.top, 0);
      // El contenido largo conserva su scroll nativo, sin plegar la hoja.
      const body = sheet.locator('.lm-body');
      await body.locator('.lm-msg').evaluate(el => { el.textContent = 'Un mensaje largo para revisar el desplazamiento. '.repeat(100); });
      await expect.poll(() => body.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
      const long = await metrics();
      const bodyBox = await body.boundingBox();
      const sy = Math.min(height - 90, bodyBox.y + 150);
      await touch('touchStart', width / 2, sy);
      await touch('touchMove', width / 2, sy - 35);
      await touch('touchMove', width / 2, sy - 95);
      await expect.poll(() => body.evaluate(el => el.scrollTop)).toBeGreaterThan(10);
      expect((await metrics()).top).toBeCloseTo(long.top, 0);
      await touch('touchEnd');
      await expect(sheet).not.toHaveClass(/is-min/);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await sheet.locator('.lm-grab').tap();
      await expect(sheet).toHaveClass(/is-min/);
      await expect.poll(async () => (await metrics()).opacity).toBe(0);
      expect(await sheet.evaluate(el => getComputedStyle(el).transitionDuration)).toBe('0s');
      console.log(`${width}×${height}: arrastre desde botón y borde, contenido estable, fade continuo y toque conservado`);
      await context.close();
    }
    const desktop = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'es-MX' });
    const mousePage = await desktop.newPage();
    await mousePage.goto('http://127.0.0.1:5175/?muestra=1');
    const mouseSheet = mousePage.locator('.app-main-sheet');
    await expect(mouseSheet.locator('.lm-actions button').first()).toBeVisible();
    const call = await mouseSheet.locator('.lm-actions button').first().boundingBox();
    await mousePage.mouse.move(call.x + 20, call.y + call.height / 2);
    await mousePage.mouse.down();
    await mousePage.mouse.move(call.x + 20, 840, { steps: 8 });
    await mousePage.mouse.up();
    await expect(mouseSheet).toHaveClass(/is-min/);
    await expect(mousePage.locator('.lm-incoming,.lm-stage')).toHaveCount(0);
    await mouseSheet.locator('.lm-grab').click();
    await expect(mouseSheet).not.toHaveClass(/is-min/);
    await mousePage.getByRole('button', { name: 'Publicar y gestionar', exact: true }).click();
    await expect(mousePage.locator('.app-gestion')).toBeVisible();
    console.log('Ratón: arrastrar sobre botón no llama; abrir y pulsar conserva los clics');
    await desktop.close();
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
