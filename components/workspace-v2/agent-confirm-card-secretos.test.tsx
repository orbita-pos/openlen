// @vitest-environment jsdom
//
// La tarjeta de publicar de Len con las Edge Functions (spec local 2026-10-11):
// los secretos que faltan en producción se rellenan ahí mismo —a la ruta de
// secretos, nunca por el turno— o se publica igual. Textos REALES en español.
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

describe("la tarjeta de publicar con secretos que faltan", () => {
  it("🔴 los que Len vio que faltan salen ya en la tarjeta; «Guardar y publicar» los manda a la ruta de secretos (producción) y publica", async () => {
    stubFetch(() => ({ status: 200, body: { ok: true, url: "https://tienda.openlen.app" } }));
    await render({ ...BASE, secretosQueFaltan: ["STRIPE_SECRET_KEY"] });
    expect(text()).toContain("Faltan claves para la página publicada");
    await escribir(host.querySelector("input") as HTMLInputElement, "sk_live_valor123456");
    await click(button("Guardar y publicar"));
    expect(calls[0]).toEqual({ url: "/api/projects/p1/function-secrets", body: { secrets: [{ environment: "live", name: "STRIPE_SECRET_KEY", value: "sk_live_valor123456" }] } });
    expect(calls[1]!.url).toBe("/api/projects/p1/publish");
    expect(JSON.stringify(calls[1]!.body)).not.toContain("sk_live_valor123456");
    expect(text()).toContain("tienda.openlen.app");
  });

  it("428 de la ruta: la tarjeta pide los que faltan; «Publicar igual» lo salta, y también tras confirmar lo destructivo", async () => {
    stubFetch((_c, n) =>
      n === 1
        ? { status: 428, body: { error: "secrets_required", missing: ["STRIPE_SECRET_KEY"] } }
        : n === 2
          ? { status: 428, body: { error: "confirmation_required", destructive: [{ kind: "drop_table", table: "viejos", count: 3 }], fingerprint: "a".repeat(64) } }
          : { status: 200, body: { url: "https://tienda.openlen.app" } },
    );
    await render(BASE);
    await click(button("Publicar"));
    expect(text()).toContain("Faltan claves para la página publicada");
    await click(button("Publicar igual"));
    expect(calls.at(-1)?.body).toMatchObject({ skipMissingSecrets: true });
    await click(button("Publicar igual"));
    expect(calls.at(-1)?.body).toMatchObject({ skipMissingSecrets: true, confirmFingerprint: "a".repeat(64) });
    expect(text()).toContain("tienda.openlen.app");
  });

  it("unas funciones que no compilan se dicen con su fichero y línea", async () => {
    stubFetch(() => ({ status: 422, body: { error: "functions_do_not_compile", errors: ["/supabase/functions/checkout/index.ts:3:5 — x"] } }));
    await render(BASE);
    await click(button("Publicar"));
    expect(text()).toContain("Las funciones no compilan");
    expect(text()).toContain("/supabase/functions/checkout/index.ts:3:5 — x");
  });
});
