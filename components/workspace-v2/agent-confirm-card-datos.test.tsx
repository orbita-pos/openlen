// @vitest-environment jsdom
//
// La tarjeta de publicar de Len con los datos (spec local
// 2026-10-09-borrador-y-produccion-de-datos): la casilla de copiar los datos de
// prueba en la primera publicación, el aviso de lo destructivo que Len ensayó, y
// la confirmación roja cuando la ruta contesta 428. Textos REALES en español.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";

import wsPage from "@/messages/es/wsPage.json";
import modalsDomain from "@/messages/es/modalsDomain.json";
import { AgentConfirmCard, type AgentConfirm } from "./agent-confirm-card";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Call = { url: string; body: Record<string, unknown> | undefined };
let calls: Call[];
let root: Root;
let host: HTMLDivElement;

function stubFetch(reply: (c: Call, n: number) => { status: number; body: unknown }) {
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

async function render(confirm: AgentConfirm) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="es" messages={{ wsPage, modalsDomain }}>
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

describe("la tarjeta de publicar con datos", () => {
  it("primera publicación: la casilla de copiar viaja en la petición", async () => {
    stubFetch(() => ({ status: 200, body: { url: "https://tienda.openlen.app" } }));
    await render({ ...BASE, cambiosDeDatos: { kind: "first_publish", migrations: ["1_productos"] } });
    expect(text()).toContain("Copiar también los datos de prueba");
    await act(async () => { host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(); });
    await click(button("Publicar"));
    expect(calls.at(-1)?.body).toMatchObject({ subdomain: "tienda", copyDraftData: true });
  });

  it("lo destructivo que Len ensayó se enseña ANTES de pulsar", async () => {
    stubFetch(() => ({ status: 200, body: {} }));
    await render({
      ...BASE,
      cambiosDeDatos: { kind: "pending", migrations: ["2_sin_descuento"], destructive: [{ kind: "drop_column", table: "ventas", column: "descuento", count: 1240 }] },
    });
    expect(text()).toContain("Esta publicación borra datos reales");
    expect(text()).toContain("Borra la columna descuento de ventas (1240 valores)");
  });

  it("con UNO, en singular: «1 valor», no «1 valores»", async () => {
    await render({
      ...BASE,
      cambiosDeDatos: {
        kind: "pending",
        migrations: ["3_quitar"],
        destructive: [
          { kind: "drop_column", table: "productos", column: "categoria", count: 1 },
          { kind: "drop_table", table: "viejos", count: 1 },
        ],
      },
    });
    expect(text()).toContain("Borra la columna categoria de productos (1 valor)");
    expect(text()).toContain("Borra la tabla viejos (1 fila)");
  });

  it("428: la confirmación roja, y «Publicar igual» manda la huella", async () => {
    stubFetch((_c, n) =>
      n === 1
        ? { status: 428, body: { error: "confirmation_required", destructive: [{ kind: "drop_table", table: "viejos", count: 3 }], fingerprint: "a".repeat(64) } }
        : { status: 200, body: { url: "https://tienda.openlen.app" } },
    );
    await render(BASE);
    await click(button("Publicar"));
    expect(text()).toContain("Borra la tabla viejos (3 filas)");
    expect(button("Publicar")).toBeUndefined();
    await click(button("Publicar igual"));
    expect(calls.at(-1)?.body).toMatchObject({ confirmFingerprint: "a".repeat(64) });
    expect(text()).toContain("tienda.openlen.app");
  });

  it("una migración que falla en producción se dice", async () => {
    stubFetch(() => ({ status: 422, body: { error: "migration_failed", migration: "2_x", message: "boom" } }));
    await render(BASE);
    await click(button("Publicar"));
    expect(text()).toContain("No se publicó: la migración 2_x falló: boom");
  });
});
