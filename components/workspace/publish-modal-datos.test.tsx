// @vitest-environment jsdom
//
// El modal de publicar con los datos (spec local
// 2026-10-09-borrador-y-produccion-de-datos): cuando la ruta pide confirmar lo
// destructivo (428), la confirmación roja sustituye al botón, y el botón se ve
// deshabilitado —no sólo lo está—. Textos REALES en español.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";

import modalsDomain from "@/messages/es/modalsDomain.json";
import { PublishModal } from "./publish-modal";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
const posts: Record<string, unknown>[] = [];

beforeEach(() => {
  posts.length = 0;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/publish") && init?.method === "POST") {
        posts.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return new Response(
          JSON.stringify({ error: "confirmation_required", destructive: [{ kind: "drop_column", table: "ventas", column: "descuento", count: 1240 }], fingerprint: "f".repeat(64) }),
          { status: 428 },
        );
      }
      if (url.includes("/backend/environments")) return new Response(JSON.stringify({ hasBackend: true, hasLive: true, preview: { kind: "pending", migrations: ["2_sin_descuento"], destructive: null } }));
      return new Response("{}", { status: 404 });
    }),
  );
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const button = (label: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === label);

async function render() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="es" messages={{ modalsDomain }}>
        <PublishModal
          open
          onClose={() => {}}
          onSuccess={() => {}}
          project={{ id: "p1", subdomain: "tienda", publishedAt: new Date(), hasUnpublishedChanges: true, languages: [] }}
        />
      </NextIntlClientProvider>,
    );
  });
  await settle();
}

describe("el modal de publicar con datos", () => {
  it("enseña los cambios de tablas que se aplicarán", async () => {
    await render();
    expect(host.textContent).toContain("Cambios de tablas que se aplican al publicar: 2_sin_descuento");
  });

  it("con lo destructivo pendiente de confirmar, el botón se VE deshabilitado", async () => {
    await render();
    await act(async () => { button("Volver a publicar")!.click(); });
    await settle();
    expect(host.textContent).toContain("Borra la columna descuento de ventas (1240 valores)");
    const publicar = button("Volver a publicar")!;
    expect(publicar.disabled).toBe(true);
    expect(publicar.className).not.toContain("bg-coral-500");
  });

  it("«Publicar igual» manda la huella", async () => {
    await render();
    await act(async () => { button("Volver a publicar")!.click(); });
    await settle();
    await act(async () => { button("Publicar igual")!.click(); });
    await settle();
    expect(posts.at(-1)).toMatchObject({ subdomain: "tienda", confirmFingerprint: "f".repeat(64) });
  });
});
