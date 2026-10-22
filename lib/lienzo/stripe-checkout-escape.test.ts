import { describe, expect, it } from "vitest";

import { documentoDeVista } from "./documento";
import { STRIPE_HOSTS, withStripeCheckoutEscape } from "./stripe-checkout-escape";

const HTML = '<!doctype html><html lang="es"><head><title>t</title></head><body><a href="https://buy.stripe.com/test_x">Comprar</a></body></html>';

describe("withStripeCheckoutEscape", () => {
  it("adds one inline script before </head>, and only once", () => {
    const once = withStripeCheckoutEscape(HTML);
    expect(once.match(/data-openlen-stripe-escape/g)).toHaveLength(1);
    expect(once.indexOf("data-openlen-stripe-escape")).toBeLessThan(once.indexOf("</head>"));
    expect(withStripeCheckoutEscape(once)).toBe(once);
  });

  it("a document without <head> gets it at the start of <body>, or at the very start", () => {
    expect(withStripeCheckoutEscape("<body><p>x</p></body>")).toMatch(/^<body><script data-openlen-stripe-escape/);
    expect(withStripeCheckoutEscape("<p>x</p>")).toMatch(/^<script data-openlen-stripe-escape/);
  });

  it("knows Stripe's checkout, payment link and customer portal hosts", () => {
    expect(STRIPE_HOSTS).toEqual(["checkout.stripe.com", "buy.stripe.com", "billing.stripe.com"]);
  });

  it("documentoDeVista carries it", () => {
    const out = documentoDeVista(HTML, { projectId: "4f9c10cb-8781-48f1-b291-c5d146579f09", title: "t", sub: null, pagina: null, settings: undefined, logoUrl: null });
    expect(out).toContain("data-openlen-stripe-escape");
  });
});
