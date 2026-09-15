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

describe("la etiqueta del lienzo", () => {
  it("es el prefijo más el UUID sin guiones, y cabe en una etiqueta DNS", () => {
    const e = etiquetaDeLienzo(ID);
    expect(e).toBe(`${LIENZO_PREFIJO}${HEX}`);
    expect(e!.length).toBeLessThanOrEqual(63);
  });

  it("no se fabrica de algo que no es un UUID", () => {
    expect(etiquetaDeLienzo("../../etc")).toBeNull();
    expect(etiquetaDeLienzo("")).toBeNull();
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
  const prod = { NODE_ENV: "production", LIENZO_BASE_HOST: "openlen.app" };

  it("en producción va por https bajo LIENZO_BASE_HOST", () => {
    expect(urlDelDocumento({ projectId: ID, docId: "abc", hostDeLaPeticion: "openlen.com" }, prod)).toBe(
      `https://lienzo-${HEX}.openlen.app/api/lienzo/abc`,
    );
  });

  it("sin LIENZO_BASE_HOST cae a PUBLISH_BASE_HOST, nunca a un literal", () => {
    const env = { NODE_ENV: "production", PUBLISH_BASE_HOST: "openlen.app" };
    expect(urlDelDocumento({ projectId: ID, docId: "abc", hostDeLaPeticion: null }, env)).toBe(
      `https://lienzo-${HEX}.openlen.app/api/lienzo/abc`,
    );
    expect(urlDelDocumento({ projectId: ID, docId: "abc", hostDeLaPeticion: null }, { NODE_ENV: "production" })).toBeNull();
  });

  it("en desarrollo va por http a *.localhost con el puerto de la petición", () => {
    expect(
      urlDelDocumento({ projectId: ID, docId: "abc", hostDeLaPeticion: "localhost:3007" }, { NODE_ENV: "development" }),
    ).toBe(`http://lienzo-${HEX}.localhost:3007/api/lienzo/abc`);
  });

  it("un projectId que no es UUID no produce URL", () => {
    expect(urlDelDocumento({ projectId: "x", docId: "abc", hostDeLaPeticion: null }, prod)).toBeNull();
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
