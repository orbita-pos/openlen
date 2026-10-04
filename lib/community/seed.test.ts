// La siembra del Explore clona plantillas como `from-template`: desde el
// 2026-10-04 (la entrada como Vercel) con su JavaScript. La puerta, la
// normalización y los metadatos son los de verdad (con el binding nativo).
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {}, schema: { projects: {}, users: {} } }));
vi.mock("@/lib/projects", () => ({ publishProject: vi.fn() }));
vi.mock("@/lib/templates/store", () => ({ getTemplate: vi.fn(), getTemplateHtml: vi.fn() }));
vi.mock("./store", () => ({ setVisibility: vi.fn() }));

import { buildShowcaseProjectData } from "./seed";

const FILLER = "<p>Contenido de la plantilla.</p>".repeat(10);
const doc = (inner: string) =>
  `<!doctype html><html lang="es"><head><title>T</title></head><body>${inner}${FILLER}</body></html>`;

describe("buildShowcaseProjectData", () => {
  it("🔴 la portada y cada página conservan su JavaScript", () => {
    const js = "<script>if (1 < 2 && 2 > 1) { window.__demo = '<b>ok</b>'; }</script>";
    const data = buildShowcaseProjectData(
      "Demo",
      doc(`<h1>Home</h1><button onclick="abrir()">Abrir</button>${js}`),
      [{ slug: "tienda", html: doc(`<h1>Tienda</h1>${js}`) }],
    );

    expect(data).not.toBeNull();
    expect(data!.html).toContain(js);
    expect(data!.html).toContain('onclick="abrir()"');
    expect(data!.pages?.tienda?.html).toContain(js);
  });

  it("rechaza el marcador reservado, como todas las entradas", () => {
    expect(buildShowcaseProjectData("Demo", doc('<section data-slot-path="a">x</section>'), [])).toBeNull();
  });
});
