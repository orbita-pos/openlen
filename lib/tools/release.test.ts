// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { AppNoCompilaError } from "@/lib/apps/compilador";

import { buildToolRelease, type ReleaseDeps } from "./release";

const APP = { catalogo: "2026-11", entrada: "/src/main.tsx" };
const SHELL = `<!doctype html><html><head><title>Reservas</title></head><body><div id="root" data-op-id="x1"></div><script type="module" src="/src/main.tsx"></script></body></html>`;
const FILES = {
  "/src/main.tsx": "import App from './App'",
  "/src/App.tsx": "export default function App() { return null }",
  "/package.json": "{}",
  "/locale/en.json": '{"meta":{"title":"Bookings","description":"x"}}',
  "/icon.svg": "<svg></svg>",
  "/img/logo.png": "￿openlen-blob:" + "a".repeat(64) + ":10:" + "b".repeat(40),
  "/.env": "VITE_X=1",
};

const deps = (over: Partial<ReleaseDeps> = {}): ReleaseDeps => ({
  bundle: vi.fn(async () => ({ ok: true as const, js: "console.log('bundled')", map: "", bytes: 1, gzipBytes: 1, ms: 1 })),
  gate: (html: string) => html.replace(/ data-op-id="[^"]*"/g, ""),
  ...over,
});

const build = (d: ReleaseDeps, files: Record<string, string> = FILES, html = SHELL) =>
  buildToolRelease({ html, files, app: APP, entorno: { VITE_SUPABASE_URL: "https://ref.example" }, iconPath: "/icon.svg" }, d);

describe("buildToolRelease", () => {
  it("serves the shell, the production bundle at the entry, and what isn't a source", async () => {
    const d = deps();
    const r = await build(d);
    expect(d.bundle).toHaveBeenCalledWith(expect.objectContaining({ modo: "produccion", app: APP, entorno: { VITE_SUPABASE_URL: "https://ref.example" } }));
    expect(r.files["/index.html"]).toEqual({ content: SHELL.replace(' data-op-id="x1"', ""), contentType: "text/html; charset=utf-8" });
    expect(r.files["/src/main.tsx"]?.content).toBe("console.log('bundled')");
    expect(r.files["/src/main.tsx"]?.contentType).toMatch(/javascript/);
    expect(r.files["/src/App.tsx"]).toBeUndefined();
    expect(r.files["/.env"]).toBeUndefined();
    expect(r.files["/icon.svg"]?.contentType).toMatch(/svg/);
    expect(r.files["/img/logo.png"]?.content).toBe(FILES["/img/logo.png"]);
  });

  it("the icon is in the release even if it weren't publishable", async () => {
    const r = await buildToolRelease(
      { html: SHELL, files: { ...FILES, "/branding/mark.svg": "<svg/>" }, app: APP, entorno: {}, iconPath: "/branding/mark.svg" },
      deps(),
    );
    expect(r.files["/branding/mark.svg"]?.content).toBe("<svg/>");
  });

  it("the sha is the content: the same input gives the same sha, a change another", async () => {
    const a = await build(deps());
    const b = await build(deps());
    const c = await build(deps(), { ...FILES, "/icon.svg": "<svg><circle/></svg>" });
    expect(a.sha).toMatch(/^[0-9a-f]{64}$/);
    expect(b.sha).toBe(a.sha);
    expect(c.sha).not.toBe(a.sha);
  });

  it("a source that doesn't compile refuses the install", async () => {
    const errores = [{ ruta: "/src/App.tsx", linea: 1, columna: 1, mensaje: "boom" }];
    await expect(build(deps({ bundle: vi.fn(async () => ({ ok: false as const, errores })) }))).rejects.toBeInstanceOf(AppNoCompilaError);
  });

  it("a missing entry module refuses the install", async () => {
    const { ["/src/main.tsx"]: _, ...sinEntrada } = FILES;
    await expect(build(deps(), sinEntrada)).rejects.toBeInstanceOf(AppNoCompilaError);
  });

  it("a bundler that doesn't answer refuses the install", async () => {
    await expect(build(deps({ bundle: vi.fn(async () => null) }))).rejects.toThrow(/bundler/i);
  });

  it("an editor marker in the shell refuses the install", async () => {
    await expect(build(deps({ gate: () => null }))).rejects.toThrow(/data-slot-path/);
  });
});
