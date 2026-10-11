import { describe, expect, it } from "vitest";
import { CATALOGO_ACTUAL } from "@/lib/apps/dependencias";
import type { ContextoDeVista } from "@/lib/lienzo/documento";
import { captureDesignElements } from "./design-screenshots";

const APP = { catalogo: CATALOGO_ACTUAL, entrada: "/src/main.jsx" };
const CASCARON = '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Caja</title></head><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>';
const FICHEROS: Record<string, string> = {
  "/src/main.jsx": [
    'import { createRoot } from "react-dom/client";', // 1
    'import { HashRouter, Routes, Route } from "react-router-dom";', // 2
    "createRoot(document.getElementById(\"root\")).render(", // 3
    "  <HashRouter><Routes>", // 4
    '    <Route path="/" element={<p>Inicio</p>} />', // 5
    '    <Route path="/ajustes" element={<h1 style={{ padding: 20 }}>Ajustes</h1>} />', // 6
    "  </Routes></HashRouter>,", // 7
    ");", // 8
  ].join("\n"),
};
const vista: ContextoDeVista = { projectId: "4f9c10cb-8781-48f1-b291-c5d146579f09", title: "Caja", sub: null, pagina: null, settings: undefined, logoUrl: null, files: FICHEROS, app: APP };
const elemento = (screen: string, line: number, tag: string) => ({ chain: [{ path: "/src/main.jsx", line, component: null }], primary: 0, tag, text: "", copies: 1, screen, changes: [{ property: "color" as const, before: "", after: "red" }] });

describe("las capturas del modo Diseño", () => {
  it("🔴 recorta el elemento en su pantalla: un PNG de verdad", async () => {
    const [img] = await captureDesignElements({ html: CASCARON, vista, elements: [elemento("#/ajustes", 6, "h1")], limit: 4 });
    expect(img?.mimeType).toBe("image/png");
    const png = Buffer.from(img!.dataBase64, "base64");
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect(png.readUInt32BE(16)).toBeGreaterThan(10); // ancho
  }, 120_000);
  it("🔴 con el turno ya cancelado no lanza Chromium; cancelado a mitad, vuelve enseguida sin capturas", async () => {
    let lanzados = 0;
    const lanzar = async () => {
      lanzados++;
      return (await import("@/lib/ai/visual-quality-renderer")).lanzarChromium();
    };
    const ya = new AbortController();
    ya.abort();
    expect(await captureDesignElements({ html: CASCARON, vista, elements: [elemento("#/ajustes", 6, "h1")], limit: 4, signal: ya.signal }, { lanzar })).toEqual([]);
    expect(lanzados, "lanzó Chromium para un turno ya cancelado").toBe(0);
    const c = new AbortController();
    const t0 = Date.now();
    const p = captureDesignElements({ html: CASCARON, vista, elements: [elemento("#/ajustes", 6, "h1")], limit: 4, signal: c.signal }, { lanzar });
    setTimeout(() => c.abort(), 300);
    expect(await p).toEqual([]);
    expect(Date.now() - t0, "siguió capturando después de cancelar").toBeLessThan(2500);
  }, 120_000);

  it("un elemento que no está, sin cadena, o sin hueco: no hay captura y no falla", async () => {
    const r = await captureDesignElements({
      html: CASCARON, vista,
      elements: [elemento("#/ajustes", 2, "h1"), { ...elemento("#/", 5, "p"), chain: [], primary: -1 }],
      limit: 4,
    });
    expect(r).toEqual([]);
    expect(await captureDesignElements({ html: CASCARON, vista, elements: [elemento("#/ajustes", 6, "h1")], limit: 0 })).toEqual([]);
  }, 120_000);
});
