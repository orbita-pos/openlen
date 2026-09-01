import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  PUBLISHED_BASE_HOST,
  publishedHost,
  publishedUrl,
  RESERVED_BASE_SUFFIXES,
  subdomainFromTitle,
} from "./base-host";

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

// El bug que se vio en producción el 2026-09-01: «Tacos El Güero — Taquería en
// Guadalajara» proponía `tacos-el-g-ero-taquer-a-en-g.openlen.app`. Tres
// implementaciones distintas, tres respuestas, y la que veía el usuario era la
// peor. Estas pruebas fijan la única que queda.
describe("subdomainFromTitle", () => {
  it("translitera las tildes en vez de tragárselas — el bug de producción", () => {
    expect(subdomainFromTitle("Tacos El Güero")).toBe("tacos-el-guero");
    expect(subdomainFromTitle("Panadería La Peña")).toBe("panaderia-la-pena");
    expect(subdomainFromTitle("El Niño Feliz")).toBe("el-nino-feliz");
    expect(subdomainFromTitle("Café")).toBe("cafe");
  });

  it("cubre los siete locales latinos, no sólo el español", () => {
    expect(subdomainFromTitle("Pão de Açúcar")).toBe("pao-de-acucar"); // pt
    expect(subdomainFromTitle("Café Crème")).toBe("cafe-creme"); // fr
    expect(subdomainFromTitle("Città di Perù")).toBe("citta-di-peru"); // it
    expect(subdomainFromTitle("Café Zoë")).toBe("cafe-zoe"); // nl
    expect(subdomainFromTitle("Müller Bäckerei")).toBe("muller-backerei"); // de
  });

  it("mapea la ß, que NFD sola deja rota", () => {
    expect(subdomainFromTitle("Straße 12")).toBe("strasse-12");
    expect(subdomainFromTitle("Weißbier")).toBe("weissbier");
  });

  it("NO expande la diéresis a 'ue' — eso rompería el español", () => {
    // `ü` → `ue` es la convención alemana, pero la misma letra en español no
    // se translitera así. Sin saber el idioma, expandir es peor que no hacerlo.
    expect(subdomainFromTitle("El Pingüino")).toBe("el-pinguino");
    expect(subdomainFromTitle("Vergüenza Ajena")).toBe("verguenza-ajena");
  });

  it("devuelve vacío en CJK para que quien llama elija el reemplazo", () => {
    expect(subdomainFromTitle("寿司の店")).toBe("");
    expect(subdomainFromTitle("김밥천국")).toBe("");
    expect(subdomainFromTitle("小笼包")).toBe("");
  });

  it("recorta sin dejar el guión colgando", () => {
    expect(subdomainFromTitle("Tacos El Güero — Taquería en Guadalajara", 28)).toBe(
      "tacos-el-guero-taqueria-en",
    );
    expect(subdomainFromTitle("aaaa bbbb", 5)).toBe("aaaa");
  });

  it("no deja separadores en los bordes", () => {
    expect(subdomainFromTitle("  ¡¿Hola?!  ")).toBe("hola");
    expect(subdomainFromTitle("---")).toBe("");
  });
});
