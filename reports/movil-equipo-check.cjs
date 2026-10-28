const { chromium, expect } = require('@playwright/test');
const fs = require('node:fs'); const path = require('node:path');
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const dir = path.resolve('reports/movil-equipo'); fs.mkdirSync(dir, { recursive: true });
  try {
    for (const [width, height] of [[390,844],[360,640]]) {
      const context = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true, locale: 'es-MX' });
      const page = await context.newPage(); const errores = [];
      page.on('pageerror', error => errores.push(error.message));
      const foto = nombre => page.screenshot({ path: path.join(dir, `${width}-${nombre}.png`), animations: 'disabled' });
      await page.goto('http://127.0.0.1:5175/?muestra=1');
      await page.getByRole('button', { name: 'Equipo e hilos', exact: true }).tap();
      const panel = page.getByRole('dialog', { name: 'Equipo e hilos', exact: true });
      await expect(panel.getByText('Luis Pérez', { exact: true })).toBeVisible();
      await expect(panel.getByText('Los miembros del proyecto pueden ver lo que escribas aquí.', { exact: true })).toBeVisible();
      const campo = panel.getByRole('textbox', { name: 'Mensaje al equipo' });
      await campo.fill('@Lu'); await expect(panel.getByRole('option', { name: /Luis Pérez/ })).toBeVisible(); await foto('menciones');
      await panel.getByRole('option', { name: /Luis Pérez/ }).tap(); await expect(campo).toHaveValue('@Luis Pérez ');
      await campo.fill('@Luis Pérez revisa el horario'); await panel.getByRole('button', { name: 'Enviar', exact: true }).tap();
      await expect(panel.locator('.es-mio').getByText('@Luis Pérez revisa el horario')).toBeVisible(); await expect(campo).toHaveValue('');
      await expect(page.locator('.ent-revelar')).toHaveCount(0); await foto('mensaje');
      await panel.getByRole('button', { name: /^Hilos/ }).tap(); await panel.locator('.eq-hilo').first().tap();
      await expect(panel.getByText('@Ana ¿abrimos también el sábado por la mañana?', { exact: true })).toBeVisible();
      await panel.getByRole('textbox', { name: 'Mensaje al equipo' }).fill('Me encargo de revisarlo mañana.');
      await panel.getByRole('button', { name: 'Enviar', exact: true }).tap(); await expect(panel.getByText('Me encargo de revisarlo mañana.', { exact: true })).toBeVisible();
      await panel.getByRole('button', { name: 'Resolver hilo', exact: true }).tap(); await expect(panel.getByRole('button', { name: 'Reabrir hilo', exact: true })).toBeVisible(); await foto('hilo');
      // Dos niveles de Atrás: detalle -> lista -> proyecto.
      await page.goBack(); await expect(panel.locator('.eq-hilo-top')).toHaveCount(0); await expect(panel.locator('.eq-hilo')).toBeVisible();
      await page.goBack(); await expect(panel).toHaveCount(0); await expect(page.locator('.app-main-sheet')).toBeVisible();
      // Cerrar el panel desde un hilo también consume sus dos capas.
      await page.getByRole('button', { name: 'Equipo e hilos', exact: true }).tap();
      await panel.getByRole('button', { name: /^Hilos/ }).tap(); await panel.locator('.eq-hilo').first().tap();
      await panel.getByRole('button', { name: 'Cerrar', exact: true }).tap(); await expect(panel).toHaveCount(0);
      await expect.poll(() => page.evaluate(() => history.state?.lenCapa ?? 0)).toBe(0);
      // Error de red: conserva el borrador y no presenta una entrega ficticia.
      await page.goto('http://127.0.0.1:5175/?muestra=1&equipoError=1'); await page.getByRole('button', { name: 'Equipo e hilos', exact: true }).tap();
      await campo.fill('@Luis Pérez conservar este borrador'); await panel.getByRole('button', { name: 'Enviar', exact: true }).tap();
      await expect(panel.getByRole('alert')).toContainText('Tu borrador sigue aquí'); await expect(campo).toHaveValue('@Luis Pérez conservar este borrador'); await foto('error-borrador');
      // Un lector puede responder, sin opción de @Len ni resolver un hilo ajeno.
      await page.goto('http://127.0.0.1:5175/?muestra=1&equipoLector=1'); await page.getByRole('button', { name: 'Equipo e hilos', exact: true }).tap();
      await campo.fill('@'); await expect(panel.getByRole('option', { name: /Luis Pérez/ })).toBeVisible(); await expect(panel.getByRole('option', { name: /@Len/ })).toHaveCount(0);
      await campo.fill(''); await panel.getByRole('button', { name: /^Hilos/ }).tap(); await panel.locator('.eq-hilo').first().tap();
      await expect(panel.getByRole('button', { name: 'Resolver hilo', exact: true })).toHaveCount(0); await foto('lector');
      expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      expect(errores).toEqual([]); console.log(`${width}×${height}: menciones táctiles, mensajes, respuesta, resolver, dos niveles Atrás, borrador y lector. Sin errores JS.`);
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
