// @vitest-environment jsdom
//
// El panel de la base de datos (fase 6 de plans/pages-backend/design.md), con
// los textos REALES en español —una clave que falte rompe la prueba— y el
// `fetch` de mentira: lo que se prueba es qué pide la vista y qué enseña.
// Arnés manual de react-dom + act(), como `code-view.test.tsx`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";

import messages from "@/messages/es/wsChrome.json";
import { DatabaseView } from "./database-view";
import type { TableInfo } from "@/lib/backend/dashboard";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOTAS: TableInfo = {
  name: "notas",
  rls: true,
  policies: 1,
  primaryKey: ["id"],
  columns: [
    { name: "id", type: "bigint", nullable: false, hasDefault: false, identity: "always", generated: false },
    { name: "texto", type: "text", nullable: false, hasDefault: false, identity: null, generated: false },
  ],
};
const LOG: TableInfo = {
  name: "visitas_log",
  rls: false,
  policies: 0,
  primaryKey: [],
  columns: [{ name: "ruta", type: "text", nullable: true, hasDefault: false, identity: null, generated: false }],
};

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

async function render() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="es" messages={{ wsChrome: messages }}>
        <DatabaseView projectId="p1" />
      </NextIntlClientProvider>,
    );
  });
  await settle();
}

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const text = () => host.textContent ?? "";
const button = (label: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(label) || b.getAttribute("aria-label") === label || b.title === label);

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

async function key(input: HTMLInputElement, k: string) {
  await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })); });
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

const READY = { status: "ready", url: "https://abcdefghijklmnopqrst.openlen.app", tables: [NOTAS, LOG] };
const ROWS = { rows: [{ id: 1, texto: "hola" }, { id: 2, texto: "adiós" }], total: 2 };

describe("la base de datos de la página", () => {
  it("sin base dice que la página aún no guarda datos, sin pestañas", async () => {
    stubFetch(() => ({ status: "none" }));
    await render();
    expect(text()).toContain("Esta página todavía no guarda datos");
    expect(host.querySelector('[role="tablist"]')).toBeNull();
  });

  it("con base lista las tablas, su RLS y las filas", async () => {
    stubFetch((c) => (c.url.endsWith("/backend") ? READY : ROWS));
    await render();
    expect(text()).toContain("notas");
    expect(text()).toContain("visitas_log");
    expect(text()).toContain("RLS activo · 1 política");
    expect(text()).toContain("hola");
    expect(text()).toContain("1–2 de 2");
    expect(calls.map((c) => c.url)).toContain("/api/projects/p1/backend/tables/notas?offset=0&limit=50");
  });

  it("🔴 cambiar una celda manda la clave de la fila y el valor nuevo", async () => {
    stubFetch((c) => (c.url.endsWith("/backend") ? READY : c.method === "PATCH" ? { row: { id: 1, texto: "nuevo" } } : ROWS));
    await render();
    const cell = [...host.querySelectorAll("td")].find((td) => td.textContent === "hola")!;
    await click(cell);
    const input = cell.querySelector("input")!;
    await type(input, "nuevo");
    await key(input, "Enter");
    const patch = calls.find((c) => c.method === "PATCH")!;
    expect(patch.url).toBe("/api/projects/p1/backend/tables/notas");
    expect(patch.body).toEqual({ key: { id: 1 }, values: { texto: "nuevo" } });
    expect(text()).toContain("nuevo");
  });

  it("🔴 borrar una fila pide dos clics", async () => {
    stubFetch((c) => (c.url.endsWith("/backend") ? READY : c.method === "DELETE" ? { ok: true } : ROWS));
    await render();
    const trash = () => host.querySelectorAll('button[title="Borrar fila"]')[1]!;
    await click(trash());
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    await click(trash());
    expect(calls.find((c) => c.method === "DELETE")?.body).toEqual({ key: { id: 2 } });
  });

  it("agregar una fila manda sólo lo escrito (lo vacío, que lo ponga Postgres)", async () => {
    stubFetch((c) => (c.url.endsWith("/backend") ? READY : c.method === "POST" ? { row: {} } : ROWS));
    await render();
    await click(button("Agregar fila"));
    const input = host.querySelector('input[aria-label="texto"]') as HTMLInputElement;
    await type(input, "otra");
    await key(input, "Enter");
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ values: { texto: "otra" } });
  });

  it("una tabla sin clave ni RLS es de sólo lectura y lo avisa", async () => {
    stubFetch((c) => (c.url.endsWith("/backend") ? READY : { rows: [{ ruta: "/" }], total: 1 }));
    await render();
    await click(button("visitas_log"));
    expect(text()).toContain("Sin clave primaria: sólo lectura");
    expect(text()).toContain("Sin RLS: cualquiera puede leerla y cambiarla");
    expect(button("Agregar fila")).toBeUndefined();
    expect(host.querySelector('button[title="Borrar fila"]')).toBeNull();
  });

  it("invitar manda el correo y lo dice", async () => {
    stubFetch((c) =>
      c.url.endsWith("/backend") ? READY : c.url.includes("/tables/") ? ROWS : c.method === "POST" ? { ok: true } : { users: [], total: 0 },
    );
    await render();
    await click(button("Usuarios"));
    expect(text()).toContain("Todavía no hay usuarios");
    const input = host.querySelector('input[type="email"]') as HTMLInputElement;
    await type(input, "caro@tiendaluna.mx");
    await act(async () => { input.form!.requestSubmit(); });
    await settle();
    expect(calls.find((c) => c.method === "POST")).toMatchObject({ url: "/api/projects/p1/backend/users", body: { email: "caro@tiendaluna.mx" } });
    expect(text()).toContain("Invitación enviada a caro@tiendaluna.mx");
  });

  /* ── carril D: Storage (lib/backend/storage/dashboard.ts) ── */
  const BUCKETS = {
    buckets: [
      { id: "fotos", public: true, files: 2, bytes: 1_572_864, fileSizeLimit: null, allowedMimeTypes: null },
      { id: "facturas", public: false, files: 0, bytes: 0, fileSizeLimit: null, allowedMimeTypes: null },
    ],
  };
  const FILES = {
    files: [{ name: "u1/perfil.png", size: 1_048_576, mimetype: "image/png", updatedAt: "2026-10-04T12:00:00.000Z", url: "https://abcdefghijklmnopqrst.openlen.app/storage/v1/object/sign/fotos/u1/perfil.png?token=t" }],
  };
  const storageRoutes = (c: Call) =>
    c.url.endsWith("/backend")
      ? READY
      : c.url.includes("/tables/")
        ? ROWS
        : c.method === "DELETE"
          ? { ok: true }
          : c.url.includes("?bucket=")
            ? FILES
            : BUCKETS;

  it("Storage: los buckets (público o privado, cuántos ficheros, cuánto) y los ficheros del primero, con su enlace", async () => {
    stubFetch(storageRoutes);
    await render();
    await click(button("Storage"));
    expect(text()).toContain("fotos");
    expect(text()).toContain("Público");
    expect(text()).toContain("facturas");
    expect(text()).toContain("Privado");
    expect(calls.map((c) => c.url)).toContain("/api/projects/p1/backend/storage?bucket=fotos");
    expect(text()).toContain("u1/perfil.png");
    expect(text()).toContain("1 MB");
    const link = host.querySelector('a[href*="/object/sign/fotos/u1/perfil.png"]') as HTMLAnchorElement;
    expect(link.target).toBe("_blank");
    expect(link.rel).toContain("noopener");
  });

  it("🔴 Storage: borrar un fichero pide dos clics y manda bucket y nombre", async () => {
    stubFetch(storageRoutes);
    await render();
    await click(button("Storage"));
    const trash = () => host.querySelector('button[title="Borrar fichero"]')!;
    await click(trash());
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    await click(trash());
    expect(calls.find((c) => c.method === "DELETE")).toMatchObject({ url: "/api/projects/p1/backend/storage", body: { bucket: "fotos", name: "u1/perfil.png" } });
  });

  it("Storage sin buckets: lo dice", async () => {
    stubFetch((c) => (c.url.endsWith("/backend") ? READY : c.url.includes("/tables/") ? ROWS : { buckets: [] }));
    await render();
    await click(button("Storage"));
    expect(text()).toContain("Todavía no hay buckets");
  });
});
