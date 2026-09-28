// lib/len-bench/capturas.browser.test.ts — la página final de cada corrida, capturada.
// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Browser } from "puppeteer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { capturarPublicada, nombreDeCaptura } from "./capturas";
import { lanzarNavegador } from "./navegador";
import { servirPublicada } from "./servidor-publicada";

/** Ancho y alto de un WebP, de su cabecera (VP8, VP8L o VP8X). */
function medidasWebp(b: Buffer): { ancho: number; alto: number } {
  expect(b.toString("ascii", 0, 4)).toBe("RIFF");
  expect(b.toString("ascii", 8, 12)).toBe("WEBP");
  const trozo = b.toString("ascii", 12, 16);
  if (trozo === "VP8X") return { ancho: 1 + b.readUIntLE(24, 3), alto: 1 + b.readUIntLE(27, 3) };
  if (trozo === "VP8L") {
    const v = b.readUInt32LE(21);
    return { ancho: 1 + (v & 0x3fff), alto: 1 + ((v >> 14) & 0x3fff) };
  }
  return { ancho: b.readUInt16LE(26) & 0x3fff, alto: b.readUInt16LE(28) & 0x3fff };
}

const ALTA = (titulo: string) => `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${titulo}</title></head>
<body style="margin:0"><h1>${titulo}</h1><div style="height:2400px;background:linear-gradient(#fff,#c33)"></div></body></html>`;

let navegador: Browser;
let raiz = "";
const SUB = "lb-captura-de-prueba-abc123";

beforeAll(async () => {
  navegador = await lanzarNavegador();
  raiz = fs.mkdtempSync(path.join(os.tmpdir(), "lb-capturas-"));
  // La release viva, como la deja `publishToDir` (sin fichero `current`, el
  // servidor lee la carpeta `current/`).
  const viva = path.join(raiz, SUB, "current");
  fs.mkdirSync(path.join(viva, "menu"), { recursive: true });
  fs.writeFileSync(path.join(viva, "index.html"), ALTA("Portada"));
  fs.writeFileSync(path.join(viva, "menu", "index.html"), ALTA("Menú"));
}, 60_000);

afterAll(async () => {
  await navegador?.close();
  fs.rmSync(raiz, { recursive: true, force: true });
});

describe("capturarPublicada", () => {
  it("cada página en escritorio y en móvil, entera y no sólo lo que cabe en pantalla", async () => {
    const s = await servirPublicada({ raiz, sub: SUB, next: "http://127.0.0.1:9", hostPublicado: `${SUB}.openlen.app` });
    const destino = path.join(raiz, "capturas");
    try {
      const hechas = await capturarPublicada({ navegador, url: s.url, next: "http://127.0.0.1:9", sub: SUB, rutas: ["/", "/menu/"], destino });
      expect(hechas.map((f) => path.basename(f)).sort()).toEqual(
        [
          `${SUB}-escritorio.webp`,
          `${SUB}-movil.webp`,
          `${SUB}-menu-escritorio.webp`,
          `${SUB}-menu-movil.webp`,
        ].sort(),
      );
      const escritorio = medidasWebp(fs.readFileSync(path.join(destino, `${SUB}-escritorio.webp`)));
      const movil = medidasWebp(fs.readFileSync(path.join(destino, `${SUB}-menu-movil.webp`)));
      expect(escritorio.ancho).toBe(1280);
      expect(movil.ancho).toBe(390);
      // La página mide más de 2.400 px: la pantalla sola (900 / 844) no la enseña.
      expect(escritorio.alto).toBeGreaterThan(2400);
      expect(movil.alto).toBeGreaterThan(2400);
    } finally {
      await s.cerrar();
    }
  }, 120_000);
});

describe("nombreDeCaptura", () => {
  it("el sub, la página sin barras y la vista", () => {
    expect(nombreDeCaptura("lb-x-1a2b3c", "/", "movil")).toBe("lb-x-1a2b3c-movil.webp");
    expect(nombreDeCaptura("lb-x-1a2b3c", "/caja/", "escritorio")).toBe("lb-x-1a2b3c-caja-escritorio.webp");
  });
});
