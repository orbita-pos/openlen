import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PUBLISHED_BASE_HOST, publishedHost, publishedUrl, RESERVED_BASE_SUFFIXES } from "./base-host";

describe("base-host", () => {
  it("cae en openlen.com cuando nadie dice otra cosa", () => {
    expect(PUBLISHED_BASE_HOST).toMatch(/^openlen\.(com|app)$/);
  });

  it("compone host y URL", () => {
    expect(publishedHost("mitienda")).toBe(`mitienda.${PUBLISHED_BASE_HOST}`);
    expect(publishedUrl("mitienda", "/menu/")).toBe(
      `https://mitienda.${PUBLISHED_BASE_HOST}/menu/`,
    );
  });

  it("reserva los DOS dominios, mire lo que mire la variable", () => {
    expect(RESERVED_BASE_SUFFIXES).toContain(".openlen.com");
    expect(RESERVED_BASE_SUFFIXES).toContain(".openlen.app");
  });
});

// 🔴 EL GUARDIÁN QUE IMPORTA. El dominio estaba escrito a mano dentro de 8
// cadenas traducidas en 10 idiomas — 80 sitios. Se cambió `PUBLISH_BASE_HOST`
// en producción y la interfaz siguió diciendo openlen.com durante un día sin
// que nada fallara. Una cadena nueva con el dominio dentro vuelve a abrir el
// mismo agujero, y sólo se nota mirando la pantalla.
//
// `marketing.json` queda fuera a propósito: ahí el dominio es la marca en prosa
// de venta, no la dirección donde nace una página.
describe("ningún texto traducido lleva el dominio escrito a mano", () => {
  const raiz = path.join(process.cwd(), "messages");
  const locales = readdirSync(raiz, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  it("hay locales que revisar", () => {
    expect(locales.length).toBeGreaterThan(5);
  });

  for (const loc of locales) {
    it(`${loc} usa {host} y no el literal`, () => {
      const dir = path.join(raiz, loc);
      const culpables: string[] = [];
      for (const f of readdirSync(dir)) {
        if (!f.endsWith(".json") || f === "marketing.json") continue;
        const txt = readFileSync(path.join(dir, f), "utf8");
        if (/openlen\.(com|app)/.test(txt)) culpables.push(f);
      }
      expect(culpables, `usa {host} en vez del dominio: ${culpables.join(", ")}`).toEqual([]);
    });
  }
});
