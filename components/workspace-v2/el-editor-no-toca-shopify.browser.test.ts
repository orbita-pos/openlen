// @vitest-environment node
//
// EL EDITOR NO TOCA LO QUE PINTA SHOPIFY (spec local 2026-10-22-shopify-storefront, §6.4),
// con el script REAL del taller en Chromium. Un componente de Shopify (`<shopify-context>`,
// `<shopify-list-context>`) pinta su `<template>` con los datos de la tienda; si el editor
// dejara editar ese texto a mano, la edición iría al `<template>` y borraría la
// `<shopify-data>`: el precio dejaría de venir de Shopify. Aquí hacen de Shopify unos
// elementos de prueba que clonan su plantilla, como los de verdad, sin red.
import { afterAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";

import { injectInlineEdit } from "./use-inline-edit";

const DOC =
  "<!doctype html><html><head><title>t</title></head><body>" +
  "<main><h2 id='titulo'>Tienda</h2>" +
  "<shopify-context type='product' handle='v2-snowboard'><template><h3>Snowboard</h3><p>$500</p></template></shopify-context>" +
  "<shopify-list-context type='product' query='products' first='2'><template><h4>Producto</h4></template></shopify-list-context>" +
  "<shopify-cart id='cart'><div slot='empty'>Tu carrito está vacío</div></shopify-cart>" +
  "</main>" +
  // Stand-ins for Shopify's components: each renders a copy of its template into itself.
  "<script>['shopify-context','shopify-list-context'].forEach(function (n) {" +
  "customElements.define(n, class extends HTMLElement { connectedCallback() { var t = this.querySelector('template'); if (t) this.appendChild(t.content.cloneNode(true)); } });" +
  "}); customElements.define('shopify-cart', class extends HTMLElement {});</script>" +
  "</body></html>";

let server: Server | null = null;
afterAll(() => server?.close());

describe("el editor y los componentes de Shopify", () => {
  it("lo que pinta un componente de Shopify no se edita a mano; lo demás de la página, sí", async () => {
    const html = injectInlineEdit(DOC);
    server = createServer((_q, r) => {
      r.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      r.end(html);
    });
    await new Promise<void>((ok) => server!.listen(0, "127.0.0.1", ok));
    const dir = server!.address();
    if (dir === null || typeof dir === "string") throw new Error("sin puerto");
    const { default: puppeteer } = await import("puppeteer");
    const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"] });
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${dir.port}/`, { waitUntil: "load", timeout: 20_000 });
      await page.evaluate(() => document.body.setAttribute("data-openlen-edit-mode", ""));
      await new Promise((r) => setTimeout(r, 200));
      const marked = await page.evaluate(() => ({
        titulo: document.getElementById("titulo")!.hasAttribute("data-openlen-editable"),
        h3: document.querySelector("shopify-context > h3")?.hasAttribute("data-openlen-editable") ?? null,
        p: document.querySelector("shopify-context > p")?.hasAttribute("data-openlen-editable") ?? null,
        h4: document.querySelector("shopify-list-context > h4")?.hasAttribute("data-openlen-editable") ?? null,
        carrito: document.querySelector("shopify-cart > div")!.hasAttribute("data-openlen-editable"),
      }));
      expect(marked).toEqual({ titulo: true, h3: false, p: false, h4: false, carrito: false });
    } finally {
      await browser.close();
    }
  }, 60_000);
});
