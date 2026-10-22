// @vitest-environment jsdom
//
// Len's publish card and Stripe (spec local 2026-10-21-stripe-integration, §6.4):
// what will be copied to live Stripe, before publishing; the account that can't
// charge yet; and the two Stripe errors. REAL Spanish texts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";

import wsPage from "@/messages/es/wsPage.json";
import modalsDomain from "@/messages/es/modalsDomain.json";
import panelsChat from "@/messages/es/panelsChat.json";
import { AgentConfirmCard, type AgentConfirm } from "./agent-confirm-card";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Call = { url: string; body: Record<string, unknown> | undefined };
let calls: Call[];
let root: Root;
let host: HTMLDivElement;

function stubFetch(reply: (c: Call, publishN: number) => { status: number; body: unknown }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const c: Call = { url, body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined };
      calls.push(c);
      const r = reply(c, calls.filter((x) => x.url.endsWith("/publish")).length);
      return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
    }),
  );
}
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const text = () => host.textContent ?? "";
const button = (label: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === label);
async function click(el: Element | undefined) {
  if (!el) throw new Error("no está");
  await act(async () => { (el as HTMLElement).click(); });
  await settle();
}
const escribir = (el: HTMLInputElement, valor: string) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
});
async function render(confirm: AgentConfirm) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="es" messages={{ wsPage, modalsDomain, panelsChat }}>
        <AgentConfirmCard projectId="p1" confirm={confirm} onPublished={() => {}} />
      </NextIntlClientProvider>,
    );
  });
  await settle();
}
const BASE: AgentConfirm = { action: "publish", subdominio: "tienda", idiomas: [], republicar: true };

beforeEach(() => {
  calls = [];
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("the publish card and Stripe (spec local 2026-10-21-stripe-integration)", () => {
  const STRIPE = { create: { products: 1, prices: 1, paymentLinks: 1, shippingRates: 0, portalConfigurations: 0, webhookEndpoints: 1 }, swaps: 1, chargesEnabled: false, unknownRefs: [] };

  it("shows before publishing what will be copied to live Stripe, and warns when the account can't charge yet", async () => {
    stubFetch(() => ({ status: 200, body: { url: "https://tienda.openlen.app" } }));
    await render({ ...BASE, stripe: STRIPE });
    expect(text()).toContain("Se copiará a tu Stripe real: 1 producto, 1 precio, 1 enlace de pago, 1 webhook.");
    expect(text()).toContain("Tu cuenta de Stripe aún no puede cobrar de verdad.");
    expect([...host.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toContain("https://dashboard.stripe.com/account/onboarding");
  });

  it("nothing to copy and an account that can charge: nothing about Stripe", async () => {
    stubFetch(() => ({ status: 200, body: { url: "https://tienda.openlen.app" } }));
    await render({ ...BASE, stripe: { ...STRIPE, create: { ...STRIPE.create, products: 0, prices: 0, paymentLinks: 0, webhookEndpoints: 0 }, chargesEnabled: true } });
    expect(text()).not.toContain("Stripe");
  });

  it("the two Stripe errors of publishing are said", async () => {
    stubFetch(() => ({ status: 422, body: { error: "stripe_account_mismatch" } }));
    await render(BASE);
    await click(button("Publicar"));
    expect(text()).toContain("La clave de Stripe de la página publicada es de otra cuenta que la de prueba.");
    stubFetch(() => ({ status: 502, body: { error: "stripe_sync_failed", message: "Too many requests" } }));
    await render({ ...BASE, subdominio: "otra" });
    await click(button("Publicar"));
    expect(text()).toContain("No se pudieron copiar tus productos a Stripe real (Too many requests).");
  });
});
