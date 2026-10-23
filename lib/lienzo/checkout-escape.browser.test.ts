// @vitest-environment node
//
// CHECKOUT OUTSIDE THE CANVAS, in a real Chromium (spec local
// 2026-10-21-stripe-integration, §6.5). Stripe Checkout refuses to be framed, and
// the canvas's iframe may open windows but not navigate the tab above it: framed,
// a navigation to Stripe opens a new tab and the frame stays; top-level (Len's
// eyes), it goes ahead as usual. The same for Shopify's checkout (spec local
// 2026-10-22-shopify-storefront, §6.4): the cart's link lives in a shadow DOM with
// target="_top", and buyNow() calls window.open(url, "_top"). No request leaves the
// machine: Stripe's and Shopify's requests are answered here.
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser, Page } from "puppeteer";

import { withCheckoutEscape } from "./checkout-escape";

const CHECKOUT = "https://checkout.stripe.com/c/pay/cs_test_abc";
const LINK = "https://buy.stripe.com/test_8wM3cd";
const SHOPIFY_CART = "https://checkout.hydrogen.shop/cart/c/abc?key=1";
const SHOPIFY_BUY = "https://hydrogen-preview.myshopify.com/cart/1:1";
const INNER = withCheckoutEscape(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>tienda</title></head><body>
<button id="pagar" onclick="location.href='${CHECKOUT}'">Pagar</button>
<a id="enlace" href="${LINK}">Comprar</a>
<div id="carrito"></div>
<button id="ya" onclick="window.open('${SHOPIFY_BUY}', '_top')">Comprar ahora</button>
<script>
  // Like <shopify-cart>: its checkout link inside an open shadow root, target _top.
  var root = document.getElementById("carrito").attachShadow({ mode: "open" });
  root.innerHTML = '<a id="checkout" part="primary-button" href="${SHOPIFY_CART}" target="_top">CHECKOUT</a>';
</script>
</body></html>`);
const SANDBOX = "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals";

let server: Server;
let port = 0;
let browser: Browser;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/outer") {
      res.writeHead(200, { "content-type": "text/html" }).end(`<!doctype html><iframe id="lienzo" sandbox="${SANDBOX}" src="/inner" style="width:800px;height:600px"></iframe>`);
      return;
    }
    res.writeHead(200, { "content-type": "text/html" }).end(INNER);
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  port = (server.address() as { port: number }).port;
  const { default: puppeteer } = await import("puppeteer");
  browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((ok) => server.close(() => ok()));
});

/** Every page opened from now on answers Stripe's and Shopify's URLs here, never on the network. */
async function stubStripe(p: Page): Promise<string[]> {
  const seen: string[] = [];
  await p.setRequestInterception(true);
  p.on("request", (r) => {
    if (r.url().includes("stripe.com") || r.url().includes("hydrogen")) {
      seen.push(r.url());
      void r.respond({ status: 200, contentType: "text/html", body: "<p>stripe</p>" });
    } else void r.continue();
  });
  return seen;
}

function popupTo(url: string): Promise<string> {
  return new Promise((resolve) => {
    const onTarget = (t: { url(): string }) => {
      if (t.url().startsWith(url.slice(0, 30))) {
        browser.off("targetcreated", onTarget);
        resolve(t.url());
      }
    };
    browser.on("targetcreated", onTarget);
  });
}

describe("the canvas opens a checkout outside its frame", () => {
  it("framed: location.href to Checkout opens a new tab and the frame stays", async () => {
    const page = await browser.newPage();
    await stubStripe(page);
    await page.goto(`http://127.0.0.1:${port}/outer`, { waitUntil: "load" });
    const frame = page.frames().find((f) => f.url().endsWith("/inner"))!;
    const popup = popupTo(CHECKOUT);
    await frame.click("#pagar");
    expect(await Promise.race([popup, new Promise((r) => setTimeout(() => r("no popup"), 5000))])).toBe(CHECKOUT);
    await new Promise((r) => setTimeout(r, 300));
    expect(page.frames().find((f) => f !== page.mainFrame())?.url()).toBe(`http://127.0.0.1:${port}/inner`);
    await page.close();
  }, 30_000);

  it("framed: a click on a buy.stripe.com link opens a new tab", async () => {
    const page = await browser.newPage();
    await stubStripe(page);
    await page.goto(`http://127.0.0.1:${port}/outer`, { waitUntil: "load" });
    const frame = page.frames().find((f) => f.url().endsWith("/inner"))!;
    const popup = popupTo(LINK);
    await frame.click("#enlace");
    expect(await Promise.race([popup, new Promise((r) => setTimeout(() => r("no popup"), 5000))])).toBe(LINK);
    await page.close();
  }, 30_000);

  it("framed: Shopify's cart checkout, a _top link inside a shadow root, opens a new tab and the frame stays", async () => {
    const page = await browser.newPage();
    await stubStripe(page);
    await page.goto(`http://127.0.0.1:${port}/outer`, { waitUntil: "load" });
    const frame = page.frames().find((f) => f.url().endsWith("/inner"))!;
    const popup = popupTo(SHOPIFY_CART);
    await frame.evaluate(() => (document.getElementById("carrito")!.shadowRoot!.getElementById("checkout") as HTMLAnchorElement).click());
    expect(await Promise.race([popup, new Promise((r) => setTimeout(() => r("no popup"), 5000))])).toBe(SHOPIFY_CART);
    await new Promise((r) => setTimeout(r, 300));
    expect(page.frames().find((f) => f !== page.mainFrame())?.url()).toBe(`http://127.0.0.1:${port}/inner`);
    await page.close();
  }, 30_000);

  it("framed: buyNow()'s window.open(url, \"_top\") opens a new tab", async () => {
    const page = await browser.newPage();
    await stubStripe(page);
    await page.goto(`http://127.0.0.1:${port}/outer`, { waitUntil: "load" });
    const frame = page.frames().find((f) => f.url().endsWith("/inner"))!;
    // The new tab isn't stubbed: online, Shopify redirects the permalink to the store's own
    // checkout domain before the tab reports its address, so only its path is checked.
    const popup = new Promise<string>((resolve) => {
      const onTarget = (t: { url(): string }) => {
        if (t.url().includes("/cart/1:1")) {
          browser.off("targetcreated", onTarget);
          resolve("opened");
        }
      };
      browser.on("targetcreated", onTarget);
    });
    await frame.click("#ya");
    expect(await Promise.race([popup, new Promise((r) => setTimeout(() => r("no popup"), 5000))])).toBe("opened");
    await new Promise((r) => setTimeout(r, 300));
    expect(page.frames().find((f) => f !== page.mainFrame())?.url()).toBe(`http://127.0.0.1:${port}/inner`);
    await page.close();
  }, 30_000);

  it("top-level: Shopify's _top checkout link navigates as usual", async () => {
    const page = await browser.newPage();
    const seen = await stubStripe(page);
    await page.goto(`http://127.0.0.1:${port}/inner`, { waitUntil: "load" });
    await Promise.all([
      page.waitForNavigation({ timeout: 5000 }),
      page.evaluate(() => (document.getElementById("carrito")!.shadowRoot!.getElementById("checkout") as HTMLAnchorElement).click()),
    ]);
    expect(page.url()).toBe(SHOPIFY_CART);
    expect(seen).toContain(SHOPIFY_CART);
    await page.close();
  }, 30_000);

  it("top-level (Len's eyes): the navigation goes ahead", async () => {
    const page = await browser.newPage();
    const seen = await stubStripe(page);
    await page.goto(`http://127.0.0.1:${port}/inner`, { waitUntil: "load" });
    await Promise.all([page.waitForNavigation({ timeout: 5000 }), page.click("#pagar")]);
    expect(page.url()).toBe(CHECKOUT);
    expect(seen).toContain(CHECKOUT);
    await page.close();
  }, 30_000);
});
