import { describe, expect, it } from "vitest";

import { documentoDeVista } from "./documento";
import { STRIPE_HOSTS, isShopifyCheckoutUrl, withCheckoutEscape } from "./checkout-escape";

const HTML = '<!doctype html><html lang="es"><head><title>t</title></head><body><a href="https://buy.stripe.com/test_x">Comprar</a></body></html>';

describe("withCheckoutEscape", () => {
  it("adds one inline script before </head>, and only once", () => {
    const once = withCheckoutEscape(HTML);
    expect(once.match(/data-openlen-checkout-escape/g)).toHaveLength(1);
    expect(once.indexOf("data-openlen-checkout-escape")).toBeLessThan(once.indexOf("</head>"));
    expect(withCheckoutEscape(once)).toBe(once);
  });

  it("a document without <head> gets it at the start of <body>, or at the very start", () => {
    expect(withCheckoutEscape("<body><p>x</p></body>")).toMatch(/^<body><script data-openlen-checkout-escape/);
    expect(withCheckoutEscape("<p>x</p>")).toMatch(/^<script data-openlen-checkout-escape/);
  });

  it("knows Stripe's checkout, payment link and customer portal hosts", () => {
    expect(STRIPE_HOSTS).toEqual(["checkout.stripe.com", "buy.stripe.com", "billing.stripe.com"]);
  });

  it("documentoDeVista carries it", () => {
    const out = documentoDeVista(HTML, { projectId: "4f9c10cb-8781-48f1-b291-c5d146579f09", title: "t", sub: null, pagina: null, settings: undefined, logoUrl: null });
    expect(out).toContain("data-openlen-checkout-escape");
  });

  it("with Shopify off, the script has no Shopify rule", () => {
    expect(withCheckoutEscape(HTML)).toContain("myshopify");
    expect(withCheckoutEscape(HTML, { shopify: false })).not.toContain("myshopify");
  });
});

describe("isShopifyCheckoutUrl (spec local 2026-10-22-shopify-storefront, §6.4)", () => {
  it("the cart's checkout, buyNow's cart permalink and anything on a myshopify host", () => {
    // Measured on 22/10 against the demo store: the cart's link and buyNow()'s window.open.
    expect(isShopifyCheckoutUrl("https://checkout.hydrogen.shop/cart/c/abc?key=1")).toBe(true);
    expect(isShopifyCheckoutUrl("https://hydrogen-preview.myshopify.com/cart/41007289630776:1")).toBe(true);
    expect(isShopifyCheckoutUrl("https://www.tienda.mx/checkouts/cn/abc")).toBe(true);
    expect(isShopifyCheckoutUrl("https://x.myshopify.com/products/a")).toBe(true);
  });

  it("not a store's other pages, and nothing that isn't https", () => {
    expect(isShopifyCheckoutUrl("https://tienda.com/products/a")).toBe(false);
    expect(isShopifyCheckoutUrl("https://tienda.com/cart")).toBe(false);
    expect(isShopifyCheckoutUrl("http://x.myshopify.com/cart/c/a")).toBe(false);
    expect(isShopifyCheckoutUrl("not a url")).toBe(false);
  });
});
