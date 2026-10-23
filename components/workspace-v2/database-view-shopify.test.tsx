// @vitest-environment jsdom
//
// The Shopify tab of the Database view (spec local 2026-10-22-shopify-storefront, §6.6),
// with the REAL Spanish texts and a fake `fetch`: it shows on a page with no backend when
// a store is connected, and disconnects it after asking.
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

const STORE = {
  name: "Hydrogen Demo Store",
  shopDomain: "hydrogen-preview.myshopify.com",
  primaryDomain: "checkout.hydrogen.shop",
  currency: "USD",
  country: "CA",
  productsCount: 22,
  collectionsCount: 6,
  checkedAt: "2026-10-22T10:00:00.000Z",
  connectedAt: "2026-10-22T10:00:00.000Z",
  adminUrl: "https://admin.shopify.com/store/hydrogen-preview",
};

function stubFetch(shopify: (c: Call) => unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const c: Call = { url, method: init?.method ?? "GET" };
      calls.push(c);
      // A page with no backend and no functions: only Shopify answers.
      const body = url.includes("/shopify") ? shopify(c) : url.endsWith("/backend") ? { status: "none" } : { available: false };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
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

const s = wsChrome.database.shopify;

describe("the Shopify tab", () => {
  it("a page without backend shows the tab when a store is connected, and not without one", async () => {
    stubFetch(() => ({ available: true, store: STORE }));
    await render();
    expect(button(wsChrome.database.tabs.shopify)).toBeDefined();
    act(() => root.unmount());
    root = createRoot(host);
    stubFetch(() => ({ available: true, store: null }));
    await render();
    expect(button(wsChrome.database.tabs.shopify)).toBeUndefined();
  });

  it("shows the store, its catalog line and the link to its Shopify admin", async () => {
    stubFetch(() => ({ available: true, store: STORE }));
    await render();
    await click(button(wsChrome.database.tabs.shopify));
    expect(text()).toContain("Hydrogen Demo Store");
    expect(text()).toContain("checkout.hydrogen.shop");
    expect(text()).toMatch(/22 productos · 6 colecciones/);
    expect(text()).toContain(s.readOnly);
    const open = [...host.querySelectorAll("a")].find((a) => a.textContent?.trim() === s.open)!;
    expect(open.getAttribute("href")).toBe(STORE.adminUrl);
    expect(open.getAttribute("target")).toBe("_blank");
  });

  it("Desconectar asks first, then sends DELETE and says what happened", async () => {
    stubFetch((c) => (c.method === "DELETE" ? { available: true, store: null } : { available: true, store: STORE }));
    await render();
    await click(button(wsChrome.database.tabs.shopify));
    await click(button(s.disconnect));
    expect(text()).toContain(s.disconnectConfirm);
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    await click(button(s.disconnectYes));
    expect(calls.filter((c) => c.method === "DELETE").map((c) => c.url)).toEqual(["/api/projects/p1/shopify"]);
    expect(text()).toContain(s.disconnected);
  });
});
