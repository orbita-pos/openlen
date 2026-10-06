import { describe, expect, it } from "vitest";
import {
  LIENZO_PREFIJO,
  etiquetaDeLienzo,
  etiquetaDelHost,
  frameAncestors,
  lienzoApagado,
  urlDelDocumento,
} from "./host";

const ID = "4f9c10cb-8781-48f1-b291-c5d146579f09";
const HEX = "4f9c10cb878148f1b291c5d146579f09";

// 🔴 LA ETIQUETA NO SE ADIVINA POR EL ID (pieza 9 de Len 2.5). Con el sitio
// entero en el host, el HOST es la llave de los ficheros sin publicar, y el id
// del proyecto lo enseña la analítica de cualquier página publicada.
describe("la etiqueta del lienzo", () => {
  const env = { AUTH_SECRET: "s3cr3t" };

  it("es lienzo- + 32 hex, estable, cabe en una etiqueta DNS y NO es el UUID", () => {
    const e = etiquetaDeLienzo(ID, env);
    expect(e).toMatch(/^lienzo-[0-9a-f]{32}$/);
    expect(e!.length).toBeLessThanOrEqual(63);
    expect(e).toBe(etiquetaDeLienzo(ID, env));
    expect(e).toBe(etiquetaDeLienzo(ID.toUpperCase(), env));
    expect(e).not.toBe(`${LIENZO_PREFIJO}${HEX}`);
    expect(etiquetaDeLienzo(ID, { AUTH_SECRET: "otro" })).not.toBe(e);
  });

  it("sin secreto no hay etiqueta (el lienzo cae a la reserva)", () => {
    expect(etiquetaDeLienzo(ID, {})).toBeNull();
    expect(etiquetaDeLienzo(ID, { AUTH_SECRET: "  " })).toBeNull();
  });

  // 🔴 MEDIDO EN PRODUCCIÓN tras el deploy de 2.5 (06/10): `/api/lienzo` → 503
  // «sin_host» y todos los editores en la vista limitada. La caja (y el
  // `.env.local`) nombran el secreto `NEXTAUTH_SECRET`, que Auth.js acepta como
  // alias de `AUTH_SECRET`; el lienzo sólo leía el segundo.
  it("con el secreto de Auth.js por su otro nombre, NEXTAUTH_SECRET, la misma etiqueta", () => {
    expect(etiquetaDeLienzo(ID, { NEXTAUTH_SECRET: "s3cr3t" })).toBe(etiquetaDeLienzo(ID, env));
    expect(etiquetaDeLienzo(ID, { AUTH_SECRET: "s3cr3t", NEXTAUTH_SECRET: "otro" })).toBe(etiquetaDeLienzo(ID, env));
    expect(etiquetaDeLienzo(ID, { AUTH_SECRET: " ", NEXTAUTH_SECRET: "s3cr3t" })).toBe(etiquetaDeLienzo(ID, env));
  });

  it("no se fabrica de algo que no es un UUID", () => {
    expect(etiquetaDeLienzo("../../etc", env)).toBeNull();
    expect(etiquetaDeLienzo("", env)).toBeNull();
  });

  it("la que lee un host es la que se fabrica", () => {
    const e = etiquetaDeLienzo(ID, env)!;
    expect(etiquetaDelHost(`${e}.openlen.app`)).toBe(e);
  });
});

describe("leer la etiqueta de un host", () => {
  it("la reconoce con dominio, con puerto y en mayúsculas", () => {
    expect(etiquetaDelHost(`lienzo-${HEX}.openlen.app`)).toBe(`lienzo-${HEX}`);
    expect(etiquetaDelHost(`lienzo-${HEX}.localhost:3007`)).toBe(`lienzo-${HEX}`);
    expect(etiquetaDelHost(`LIENZO-${HEX.toUpperCase()}.openlen.app`)).toBe(`lienzo-${HEX}`);
  });

  it("🔴 NO reconoce el host de la app ni una página publicada", () => {
    expect(etiquetaDelHost("openlen.com")).toBeNull();
    expect(etiquetaDelHost("localhost:3007")).toBeNull();
    expect(etiquetaDelHost("marea.openlen.app")).toBeNull();
    expect(etiquetaDelHost("lienzo-abc.openlen.app")).toBeNull();
    expect(etiquetaDelHost(`lienzo-${HEX}`)).toBeNull();
    expect(etiquetaDelHost(null)).toBeNull();
  });
});

describe("la URL del documento", () => {
  const prod = { NODE_ENV: "production", LIENZO_BASE_HOST: "openlen.app", AUTH_SECRET: "s3cr3t" };
  const E = etiquetaDeLienzo(ID, prod);

  it("🔴 refleja la ruta de la publicada y lleva el documento en __lienzo", () => {
    expect(urlDelDocumento({ projectId: ID, docId: "D1", pagina: null, hostDeLaPeticion: "openlen.com" }, prod)).toBe(
      `https://${E}.openlen.app/?__lienzo=D1`,
    );
    // `index.html` y no `/menu/`: Next redirige toda ruta con barra final ANTES
    // del middleware (`/menu/` → `/menu`), y desde `/menu` lo relativo se
    // resolvería desde la raíz. `/menu/index.html` también la sirve la
    // publicada, y lo relativo se resuelve desde `/menu/`, como allí.
    expect(urlDelDocumento({ projectId: ID, docId: "D1", pagina: "menu", hostDeLaPeticion: null }, prod)).toBe(
      `https://${E}.openlen.app/menu/index.html?__lienzo=D1`,
    );
  });

  it("el id del documento va escapado", () => {
    expect(urlDelDocumento({ projectId: ID, docId: "a b&c", pagina: null, hostDeLaPeticion: null }, prod)).toBe(
      `https://${E}.openlen.app/?__lienzo=a%20b%26c`,
    );
  });

  it("sin LIENZO_BASE_HOST cae a PUBLISH_BASE_HOST, nunca a un literal", () => {
    const env = { NODE_ENV: "production", PUBLISH_BASE_HOST: "openlen.app", AUTH_SECRET: "s3cr3t" };
    expect(urlDelDocumento({ projectId: ID, docId: "abc", pagina: null, hostDeLaPeticion: null }, env)).toBe(
      `https://${E}.openlen.app/?__lienzo=abc`,
    );
    const sinBase = { NODE_ENV: "production", AUTH_SECRET: "s3cr3t" };
    expect(urlDelDocumento({ projectId: ID, docId: "abc", pagina: null, hostDeLaPeticion: null }, sinBase)).toBeNull();
  });

  it("en desarrollo va por http a *.localhost con el puerto de la petición", () => {
    const dev = { NODE_ENV: "development", AUTH_SECRET: "s3cr3t" };
    expect(urlDelDocumento({ projectId: ID, docId: "abc", pagina: null, hostDeLaPeticion: "localhost:3007" }, dev)).toBe(
      `http://${E}.localhost:3007/?__lienzo=abc`,
    );
  });

  it("un projectId que no es UUID, o sin secreto, no produce URL", () => {
    expect(urlDelDocumento({ projectId: "x", docId: "abc", pagina: null, hostDeLaPeticion: null }, prod)).toBeNull();
    const sinSecreto = { NODE_ENV: "production", LIENZO_BASE_HOST: "openlen.app" };
    expect(urlDelDocumento({ projectId: ID, docId: "abc", pagina: null, hostDeLaPeticion: null }, sinSecreto)).toBeNull();
  });
});

describe("quién puede enmarcar el lienzo", () => {
  it("🔴 en producción, sólo la app — nunca localhost", () => {
    const v = frameAncestors({ NODE_ENV: "production", NEXT_PUBLIC_SITE_URL: "https://openlen.com" });
    expect(v).toBe("https://openlen.com");
    expect(v).not.toContain("localhost");
  });

  it("en desarrollo, además localhost", () => {
    expect(frameAncestors({ NODE_ENV: "development" })).toContain("http://localhost:*");
  });
});

describe("la palanca", () => {
  it("sólo el literal 0 apaga", () => {
    expect(lienzoApagado({ OPENLEN_LIENZO_ORIGEN: "0" })).toBe(true);
    expect(lienzoApagado({ OPENLEN_LIENZO_ORIGEN: "false" })).toBe(false);
    expect(lienzoApagado({})).toBe(false);
  });
});
