// @vitest-environment jsdom
//
// The Payments tab of the Database view (spec local 2026-10-21-stripe-integration,
// §6.6 and §6.7), with the REAL Spanish texts and a fake `fetch`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";

import wsChrome from "@/messages/es/wsChrome.json";
import panelsChat from "@/messages/es/panelsChat.json";
import { DatabaseView } from "./database-view";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Call = { url: string; method: string };
let calls: Call[];
let root: Root;
let host: HTMLDivElement;

const EMPTY = { status: "empty", url: "https://abcdefghijklmnopqrst.openlen.app", environment: "draft", hasLive: false };
const FN = { available: true, blocked: false, functions: [{ name: "pago", draft: true, live: false, verifyJwt: false }], usage: { month: "2026-10", calls: 1, quota: 10000 }, errors: [] };
const PANEL = (environment: "draft" | "live", chargesEnabled: boolean | null) => ({
  available: true,
  environment,
  account: { id: "acct_1", name: "Taller", chargesEnabled },
  payments: [{ id: "pi_1", amount: 2900, currency: "usd", email: "ana@example.com", status: "succeeded", created: 1700000000, dashboardUrl: `https://dashboard.stripe.com/${environment === "draft" ? "test/" : ""}payments/pi_1` }],
  subscriptions: [],
  products: [{ id: "curso", name: "Curso de cerámica", prices: [{ id: "price_9", amount: 2900, currency: "usd", interval: null }] }],
  webhookEndpoints: [{ url: "https://x/functions/v1/pago", status: "enabled" }],
  dashboardUrl: environment === "draft" ? "https://dashboard.stripe.com/test" : "https://dashboard.stripe.com",
});

function stubFetch(stripe: (c: Call) => { status: number; body: unknown }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const c: Call = { url, method: init?.method ?? "GET" };
      calls.push(c);
      const r = url.includes("/stripe") ? stripe(c) : { status: 200, body: url.endsWith("/backend") ? EMPTY : url.endsWith("/functions") ? FN : { available: false } };
      return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
    }),
  );
}

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const text = () => host.textContent ?? "";
const button = (label: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === label);
async function click(el: Element | undefined) {
  if (!el) throw new Error("not there");
  await act(async () => { (el as HTMLElement).click(); });
  await settle();
}
async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function render() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="es" messages={{ wsChrome, panelsChat }}>
        <DatabaseView projectId="p1" />
      </NextIntlClientProvider>,
    );
  });
  await settle();
}

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

describe("the Payments tab", () => {
  it("shows the test environment's payments, products and webhooks, with links to Stripe, and switches to live", async () => {
    stubFetch((c) => ({ status: 200, body: PANEL(c.url.includes("env=live") ? "live" : "draft", c.url.includes("env=live") ? false : null) }));
    await render();
    await click(button("Pagos"));
    expect(text()).toContain("Taller");
    expect(text()).toContain("ana@example.com");
    expect(text()).toContain("Curso de cerámica");
    expect(text()).toContain("https://x/functions/v1/pago");
    expect([...host.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toContain("https://dashboard.stripe.com/test/payments/pi_1");
    await click(button("Real"));
    expect(calls.some((c) => c.url.includes("env=live"))).toBe(true);
    expect(text()).toContain("Tu cuenta de Stripe aún no puede cobrar de verdad.");
  });

  it("with no Stripe account yet, the tab says how to start: ask Len to charge", async () => {
    stubFetch(() => ({ status: 200, body: { available: true, environment: "draft", account: null } }));
    await render();
    await click(button("Pagos"));
    expect(text()).toContain("Pídele a Len que cobre");
  });

  it("is not there without Stripe, or for a member (403)", async () => {
    stubFetch(() => ({ status: 200, body: { available: false } }));
    await render();
    expect(button("Pagos")).toBeUndefined();
    act(() => root.unmount());
    root = createRoot(host);
    stubFetch(() => ({ status: 403, body: { error: "owner_only" } }));
    await render();
    expect(button("Pagos")).toBeUndefined();
  });

  it("disconnect asks to type the word, says it doesn't cancel subscriptions, and calls DELETE", async () => {
    stubFetch((c) => (c.method === "DELETE" ? { status: 200, body: { ok: true } } : { status: 200, body: PANEL("draft", null) }));
    await render();
    await click(button("Pagos"));
    await click(button("Desconectar Stripe"));
    expect(text()).toContain("No cancela suscripciones ni devuelve pagos");
    const confirm = button("Desconectar") as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await type(host.querySelector("input#stripe-disconnect") as HTMLInputElement, "DESCONECTAR");
    await click(button("Desconectar"));
    expect(calls.some((c) => c.method === "DELETE" && c.url.endsWith("/api/projects/p1/stripe"))).toBe(true);
  });
});
