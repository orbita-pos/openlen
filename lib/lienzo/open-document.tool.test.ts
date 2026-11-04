// @vitest-environment node
//
// A TOOL PROJECT'S CANVAS (spec local 2026-11-04-herramientas-hechas-por-len, §4.4): the document gets
// `window.openlen` first in its <head>, and the store remembers it is a tool so the canvas host serves the bridge.
import { beforeEach, describe, expect, it, vi } from "vitest";

const row = vi.hoisted(() => ({ value: null as Record<string, unknown> | null }));
vi.mock("@/lib/db", () => {
  const chain = { from: () => chain, where: () => chain, limit: async () => (row.value ? [row.value] : []) };
  return { db: { select: () => chain }, schema: { projects: { data: "data", title: "title", subdomain: "subdomain", logoUrl: "logoUrl", id: "id", userId: "userId" } } };
});
vi.mock("@/lib/apps/entorno", () => ({ entornoPublicoDeLaApp: vi.fn(async () => ({})) }));
vi.mock("@/lib/lienzo/documento", () => ({ documentoDeVista: (html: string) => html }));

const { openCanvasDocument } = await import("./open-document");
const { leerDocumento, vaciarAlmacenParaPruebas } = await import("./almacen");

const ID = "4f9c10cb-8781-48f1-b291-c5d146579f09";
const open = () => openCanvasDocument({ projectId: ID, ownerId: "u1", personId: "u1", page: null, html: null, requestHost: "localhost:3000" });
const docOf = (url: string) => leerDocumento(new URL(url).searchParams.get("__lienzo")!);

beforeEach(() => {
  vi.stubEnv("AUTH_SECRET", "s3cr3t");
  vaciarAlmacenParaPruebas();
});

describe("openCanvasDocument for a tool project", () => {
  it("injects the bridge and marks the document as a tool's", async () => {
    row.value = { data: { html: "<html><head><title>t</title></head><body></body></html>", app: { catalogo: "2026-11", entrada: "/src/main.tsx" }, tool: { bornAt: "x" } }, title: "T", subdomain: null, logoUrl: null };
    const r = await open();
    expect(r.ok).toBe(true);
    const doc = r.ok ? docOf(r.url) : null;
    expect(doc?.html).toContain('<head><script src="/openlen/tool-bridge.js"></script><title>t</title>');
    expect(doc?.tool).toBe(true);
  });

  it("an app that isn't a tool gets neither", async () => {
    row.value = { data: { html: "<html><head></head></html>", app: { catalogo: "2026-11", entrada: "/src/main.tsx" } }, title: "A", subdomain: null, logoUrl: null };
    const r = await open();
    const doc = r.ok ? docOf(r.url) : null;
    expect(doc?.html).not.toContain("tool-bridge");
    expect(doc?.tool).toBeFalsy();
  });
});
