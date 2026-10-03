// LAS CUENTAS DE LA PÁGINA, CONTESTADAS EN LA MEDIDA — con un navegador de verdad.
//
// Hermana de `datos-en-la-medida.browser.test.ts`. El sustituto de /api/a
// (lib/page-accounts/substitute.ts) tiene su espejo contra las rutas; lo que
// esto prueba es el CABLEADO: que el servidor de medida le pase `/api/a/*`
// —con su `Referer`, que es como sabe de qué documento viene—, que la vuelta
// del dueño sea una redirección que el navegador sigue, y que lo que pasa en
// /api/a cambie quién es el actor de /api/d.
import puppeteer, { type Browser } from "puppeteer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { origenDeMedida } from "./origen-de-medida";

const CAJA = `<!doctype html><html><head><meta charset="utf-8"><title>Caja</title></head><body>
<script type="application/json" data-ol-accounts>{"registro":"cerrado","papeles":["cajero"]}</script>
<script type="application/json" data-ol-stores>{"ventas":{"visitante":"privado","papeles":{"cajero":["leer","crear"]},"campos":{"total":"numero"}}}</script>
<p id="yo">…</p>
<a id="dueno" href="/api/a/owner-start?back=/">Entrar como dueño</a>
<script>
  fetch('/api/a/me').then(function (r) { return r.json(); }).then(function (d) {
    document.getElementById('yo').textContent = d.owner ? 'dueño' : d.account ? d.account.email : 'nadie';
  });
</script>
</body></html>`;

let navegador: Browser;
beforeAll(async () => {
  navegador = await puppeteer.launch({ headless: true });
}, 60_000);
afterAll(async () => {
  await navegador?.close();
});

describe("el medidor contesta /api/a y la visita cambia el actor de /api/d", () => {
  it("nadie → «Entrar como dueño» → el dueño da de alta a una cajera → ella entra y vende", async () => {
    const origen = await origenDeMedida();
    const doc = origen.publicar(CAJA);
    const page = await navegador.newPage();
    try {
      await page.goto(doc.url, { waitUntil: "load" });
      await page.waitForFunction(() => document.getElementById("yo")?.textContent !== "…");
      expect(await page.$eval("#yo", (e) => e.textContent)).toBe("nadie");

      // Un clic de verdad: la navegación lleva el `Referer` del documento.
      await Promise.all([page.waitForNavigation({ waitUntil: "load" }), page.click("#dueno")]);
      expect(page.url()).toBe(doc.url);
      await page.waitForFunction(() => document.getElementById("yo")?.textContent !== "…");
      expect(await page.$eval("#yo", (e) => e.textContent)).toBe("dueño");

      const pide = (url: string, method = "GET", body?: unknown) =>
        page.evaluate(
          async (u, m, b) => {
            const r = await fetch(u, { method: m, headers: { "content-type": "application/json" }, ...(b === undefined ? {} : { body: JSON.stringify(b) }) });
            return r.status;
          },
          url,
          method,
          body,
        );
      expect(await pide("/api/a/accounts", "POST", { email: "marta@caja.mx", password: "contraseña-1", role: "cajero" })).toBe(201);
      expect(await pide("/api/d/ventas")).toBe(200); // el dueño lo ve todo
      expect(await pide("/api/a/logout", "POST")).toBe(200);
      expect(await pide("/api/d/ventas")).toBe(403); // fuera, `privado` cierra
      expect(await pide("/api/a/login", "POST", { email: "marta@caja.mx", password: "contraseña-1" })).toBe(200);
      expect(await pide("/api/d/ventas", "POST", { total: 120 })).toBe(200);
      expect(doc.datos.documentos("ventas")).toHaveLength(1);
      expect(doc.cuentas.calls().map((c) => `${c.method} ${c.path} ${c.status}`)).toContain("POST /api/a/login 200");
    } finally {
      await page.close();
      doc.soltar();
    }
  }, 60_000);

  // CONTRA-PRUEBA: el mismo camino en una página SIN el bloque de cuentas no
  // tiene a quién preguntar. Sin esto, la de arriba podría pasar porque el
  // servidor contestara cualquier cosa a /api/a.
  it("CONTRA-PRUEBA: sin data-ol-accounts, /api/a/me es 404 accounts_not_declared", async () => {
    const origen = await origenDeMedida();
    const doc = origen.publicar(CAJA.replace(/<script type="application\/json" data-ol-accounts>.*?<\/script>/, ""));
    const page = await navegador.newPage();
    try {
      await page.goto(doc.url, { waitUntil: "load" });
      const r = await page.evaluate(async () => {
        const res = await fetch("/api/a/me");
        return { status: res.status, body: await res.json() };
      });
      expect(r).toEqual({ status: 404, body: { error: "accounts_not_declared" } });
    } finally {
      await page.close();
      doc.soltar();
    }
  }, 60_000);
});
