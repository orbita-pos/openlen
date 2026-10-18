// @vitest-environment node
import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { decodificarPng } from "@/lib/ai/png-crudo";
import { stopBundlerWorker } from "@/lib/apps/bundler/bundle-app";
import type { ContextoDeVista } from "@/lib/lienzo/documento";

const captured = vi.hoisted(() => ({ png: null as Buffer | null, uploads: 0 }));
vi.mock("@/lib/db", () => ({ db: { update: () => ({ set: () => ({ where: () => ({ returning: async () => [{ id: "thumb-browser" }] }) }) }) }, schema: { projects: { id: "id" } } }));
vi.mock("@/lib/storage", () => ({ getStorage: () => ({ upload: async () => { captured.uploads++; return { url: "https://thumbnail.test/rendered.avif" }; } }) }));
vi.mock("@/lib/images", async (original) => {
  const actual = await original<typeof import("@/lib/images")>();
  return { ...actual, processImage: async (opts: import("@/lib/images").ProcessImageOptions) => {
    captured.png = opts.input;
    return actual.processImage(opts);
  } };
});
import { renderProjectThumbnail } from "./thumbnail";

beforeEach(() => { captured.png = null; captured.uploads = 0; });
afterAll(() => stopBundlerWorker());
const view: ContextoDeVista = { projectId: "thumb-browser", title: "Preview", sub: null, pagina: null, logoUrl: null, settings: undefined };

async function expectGreen(html: string, vista: ContextoDeVista) {
  expect(await renderProjectThumbnail({ projectId: "thumb-browser", html, view: vista })).toBe("https://thumbnail.test/rendered.avif");
  expect(captured.uploads).toBe(1);
  const png = decodificarPng(captured.png!);
  const pixel = (100 * png.ancho + 100) * png.canales;
  expect(Array.from(png.datos.subarray(pixel, pixel + 3))).toEqual([17, 170, 68]);
}

it("captures a React app's compiled entry and imported CSS rather than its empty shell", async () => {
  await expectGreen('<!doctype html><html><body style="margin:0"><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>', {
    ...view, app: { catalogo: "2026-11", entrada: "/src/main.jsx" },
    files: {
      "/src/main.jsx": 'import React from "react"; import {createRoot} from "react-dom/client"; import "./app.css"; createRoot(document.getElementById("root")).render(<main>App rendered</main>);',
      "/src/app.css": "body{margin:0}main{width:100vw;height:100vh;background:rgb(17,170,68);color:white}",
    },
  });
}, 60_000);

it("captures a page's script and stylesheet from its project folder", async () => {
  await expectGreen('<!doctype html><html><head><link rel="stylesheet" href="/css/site.css"></head><body><script src="/js/site.js"></script></body></html>', {
    ...view, files: { "/css/site.css": "body{margin:0;background:rgb(17,170,68)}", "/js/site.js": 'document.body.textContent="Page rendered";' },
  });
}, 60_000);
