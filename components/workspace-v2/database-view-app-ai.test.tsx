// @vitest-environment jsdom
//
// The AI tab of the Database view (spec local 2026-10-15, 4.6), with the REAL
// Spanish texts —a missing key breaks the test— and a fake `fetch`, like
// database-view-funciones.test.tsx.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";

import wsChrome from "@/messages/es/wsChrome.json";
import panelsChat from "@/messages/es/panelsChat.json";
import { DatabaseView } from "./database-view";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Call = { url: string; method: string; body: unknown };
let calls: Call[];
let root: Root;
let host: HTMLDivElement;

const URL_ = "https://abcdefghijklmnopqrst.openlen.app";
const EMPTY = { status: "empty", url: URL_, environment: "draft", hasLive: false };
const FN = { available: true, blocked: false, functions: [{ name: "ordenar-pedido", draft: true, live: false, verifyJwt: true }], usage: { month: "2026-10", calls: 10, quota: 10000 }, errors: [] };
const AI = {
  available: true,
  month: "2026-10",
  capCenticredits: 7_500,
  defaultCapCenticredits: 7_500,
  allotmentCenticredits: 30_000,
  explicit: false,
  spentCenticredits: 1_200,
  project: { draft: { centicredits: 200, calls: 9 }, live: { centicredits: 1_000, calls: 41 } },
};

function stubFetch(ai: (c: Call) => { status: number; body: unknown }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const c: Call = { url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined };
      calls.push(c);
      const r = url.endsWith("/app-ai") ? ai(c) : { status: 200, body: url.endsWith("/backend") ? EMPTY : url.endsWith("/functions") ? FN : {} };
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

describe("the AI tab", () => {
  it("shows the account's month, the note, and this project by environment", async () => {
    stubFetch(() => ({ status: 200, body: AI }));
    await render();
    await click(button("IA"));
    expect(text()).toContain("Tus apps este mes: 12 de 75 créditos");
    expect(text()).toContain("Este tope es de todas las apps de tu cuenta juntas.");
    expect(text()).toContain("2 créditos · 9 llamadas");
    expect(text()).toContain("10 créditos · 41 llamadas");
    expect(text()).toContain("Por defecto, el 25 % de tu plan: 75 créditos. Hasta 300.");
  });

  it("is not there when the gateway is off, or for a member (403)", async () => {
    stubFetch(() => ({ status: 200, body: { available: false } }));
    await render();
    expect(button("IA")).toBeUndefined();
    act(() => root.unmount());
    root = createRoot(host);
    stubFetch(() => ({ status: 403, body: { error: "owner_only" } }));
    await render();
    expect(button("IA")).toBeUndefined();
    expect(button("Funciones")).toBeTruthy();
  });

  it("saves a new limit in whole credits, and can go back to the default", async () => {
    stubFetch((c) =>
      c.method === "PUT"
        ? { status: 200, body: c.body && (c.body as { capCredits: number | null }).capCredits === null ? AI : { ...AI, capCenticredits: 5_000, explicit: true } }
        : { status: 200, body: AI },
    );
    await render();
    await click(button("IA"));
    await type(host.querySelector("input#app-ai-cap") as HTMLInputElement, "50");
    await click(button("Guardar"));
    expect(calls.find((c) => c.method === "PUT")?.body).toEqual({ capCredits: 50 });
    expect(text()).toContain("Tus apps este mes: 12 de 50 créditos");
    await click(button("Usar el de por defecto"));
    expect(calls.filter((c) => c.method === "PUT").at(-1)?.body).toEqual({ capCredits: null });
    expect(text()).toContain("12 de 75 créditos");
  });

  it("says so when saving fails", async () => {
    stubFetch((c) => (c.method === "PUT" ? { status: 500, body: { error: "x" } } : { status: 200, body: AI }));
    await render();
    await click(button("IA"));
    await click(button("Guardar"));
    expect(text()).toContain("No se pudo guardar el tope.");
  });
});
