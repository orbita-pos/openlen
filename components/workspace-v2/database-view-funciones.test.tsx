// @vitest-environment jsdom
//
// Las pestañas Funciones y Secretos de la vista Base de datos (spec local
// 2026-10-11, Partes 4 y 6), con los textos REALES en español —una clave que
// falte rompe la prueba— y el `fetch` de mentira, como database-view.test.tsx.
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

function stubFetch(routes: (c: Call) => unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const c: Call = { url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined };
      calls.push(c);
      return new Response(JSON.stringify(routes(c)), { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
}

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const text = () => host.textContent ?? "";
const button = (label: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === label || b.getAttribute("aria-label") === label);
async function click(el: Element | undefined) {
  if (!el) throw new Error("no está");
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

const URL_ = "https://abcdefghijklmnopqrst.openlen.app";
const EMPTY = { status: "empty", url: URL_, environment: "draft", hasLive: false };
const READY = { status: "ready", url: URL_, environment: "draft", hasLive: false, tables: [] };
const FN = {
  available: true,
  blocked: false,
  functions: [
    { name: "checkout", draft: true, live: false, verifyJwt: true },
    { name: "stripe-webhook", draft: true, live: true, verifyJwt: false },
  ],
  usage: { month: "2026-10", calls: 8000, quota: 10000 },
  errors: [{ environment: "live", name: "stripe-webhook", status: 500, errorCode: "WORKER_ERROR", error: "TypeError: x at supabase/functions/stripe-webhook/index.ts:3:5", startedAt: "2026-10-12T10:00:00.000Z" }],
};
const SECRETS = { available: true, draft: [{ name: "STRIPE_SECRET_KEY", digest: "a".repeat(64), updatedAt: "2026-10-12T10:00:00.000Z" }], live: [] };

const rutas = (o: { backend?: unknown; fn?: unknown } = {}) => (c: Call) =>
  c.url.endsWith("/backend")
    ? (o.backend ?? EMPTY)
    : c.url.endsWith("/functions")
      ? (o.fn ?? FN)
      : c.url.endsWith("/function-secrets")
        ? c.method === "GET"
          ? SECRETS
          : { ok: true }
        : {};

describe("las Edge Functions en la vista Base de datos", () => {
  it("🔴 sin tablas pero con funciones: salen las pestañas Funciones y Secretos", async () => {
    stubFetch(rutas());
    await render();
    expect(button("Funciones")).toBeTruthy();
    expect(button("Secretos")).toBeTruthy();
    expect(button("Tablas")).toBeUndefined();
  });

  it("Funciones: cada una con dónde está, la barra del mes y los últimos errores", async () => {
    stubFetch(rutas());
    await render();
    await click(button("Funciones"));
    expect(text()).toContain("checkout");
    expect(text()).toContain("stripe-webhook");
    expect(text()).toContain("Sin JWT");
    expect(text()).toContain("80%");
    expect(host.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("80");
    expect(text()).toContain("WORKER_ERROR");
    expect(text()).toContain("TypeError: x at supabase/functions/stripe-webhook/index.ts:3:5");
  });

  it("con la marca de abuso lo dice", async () => {
    stubFetch(rutas({ fn: { ...FN, blocked: true } }));
    await render();
    await click(button("Funciones"));
    expect(text()).toContain("Las Edge Functions de este proyecto están apagadas");
  });

  it("sin motor no hay pestañas de funciones; con tablas siguen las de siempre", async () => {
    stubFetch(rutas({ backend: READY, fn: { available: false } }));
    await render();
    expect(button("Tablas")).toBeTruthy();
    expect(button("Funciones")).toBeUndefined();
  });

  it("🔴 Secretos: por entorno, sin valores; añadir manda nombre y valor (recortado); borrar pide dos clics", async () => {
    stubFetch(rutas());
    await render();
    await click(button("Secretos"));
    expect(text()).toContain("STRIPE_SECRET_KEY");
    expect(text()).toContain("aaaaaaaaaaaa");
    expect(text()).not.toContain("a".repeat(13));
    const nombre = host.querySelector('input[aria-label="Borrador · Nombre"]') as HTMLInputElement;
    await type(nombre, "resend_api_key");
    expect(nombre.value).toBe("RESEND_API_KEY");
    const valor = host.querySelectorAll('input[type="password"]')[0] as HTMLInputElement;
    await type(valor, "  re_123456789 ");
    await click(button("Añadir"));
    expect(calls.find((c) => c.method === "POST")).toEqual({
      url: "/api/projects/p1/function-secrets",
      method: "POST",
      body: { secrets: [{ environment: "draft", name: "RESEND_API_KEY", value: "re_123456789" }] },
    });
    await click(button("Borrar"));
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    await click(button("¿Borrar?"));
    expect(calls.find((c) => c.method === "DELETE")).toEqual({
      url: "/api/projects/p1/function-secrets",
      method: "DELETE",
      body: { environment: "draft", names: ["STRIPE_SECRET_KEY"] },
    });
  });

  it("reemplazar un secreto no pide el valor viejo: sólo el nuevo", async () => {
    stubFetch(rutas());
    await render();
    await click(button("Secretos"));
    await click(button("Reemplazar"));
    const nuevo = host.querySelector('input[aria-label="STRIPE_SECRET_KEY · Para probar (borrador)"]') as HTMLInputElement;
    await type(nuevo, "sk_test_nuevo123456");
    await click(button("Guardar"));
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ secrets: [{ environment: "draft", name: "STRIPE_SECRET_KEY", value: "sk_test_nuevo123456" }] });
  });
});
