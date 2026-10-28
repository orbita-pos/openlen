// Comprueba el bloqueo real en Chromium con el origen de la APK, sin cuentas
// ni tokens: el 404 de /p/ también debe poder mostrarse dentro de Len.
const { chromium, expect } = require('@playwright/test');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const preview = 'https://openlen.com/p/len-preview-header-check';
  try {
    for (const [origin, allowed] of [['https://localhost', true], ['https://untrusted.example', false]]) {
      const page = await context.newPage();
      const bloqueos = [];
      page.on('console', message => {
        if (message.type() === 'error' && /frame-ancestors/.test(message.text())) bloqueos.push(message.text());
      });
      await page.route(`${origin}/len-frame-check`, route => route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><title>Len — prueba de vista previa</title><iframe title="Vista previa" src="${preview}" style="width:100%;height:760px;border:0"></iframe>`,
      }));
      await page.goto(`${origin}/len-frame-check`);
      const content = page.frameLocator('iframe').getByRole('heading', { name: "This preview link isn't available" });
      if (allowed) {
        await expect(content).toBeVisible({ timeout: 10000 });
        await page.screenshot({ path: path.resolve('reports/movil-etapas/vista-previa-origen-android.png') });
      } else {
        await expect.poll(() => bloqueos.length, { timeout: 10000 }).toBeGreaterThan(0);
        await expect(content).toHaveCount(0);
      }
      console.log(`${origin}: ${allowed ? 'vista previa visible' : 'vista previa bloqueada'}`);
      await page.close();
    }
    const response = await context.request.get('https://openlen.com/es');
    expect(response.status()).toBe(200);
    expect(response.headers()['x-frame-options']).toBe('SAMEORIGIN');
    console.log('Aplicación web: protección SAMEORIGIN conservada');
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
