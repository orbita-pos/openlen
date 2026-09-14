import { describe, expect, it } from "vitest";

import { nombreDeError, validarDatos, validarEventoDeCliente } from "./catalogo";

const SESION = "0f8e2c1a-6b1d-4d7e-9a55-3c2b1f0e9d11";

describe("el catálogo de eventos de uso", () => {
  it("acepta un evento del navegador que cumple su esquema", () => {
    expect(
      validarEventoDeCliente({ nombre: "crear_envio", sesion: SESION, datos: { imagenes: 2, referencia: false } }),
    ).toEqual({ nombre: "crear_envio", sesion: SESION, datos: { imagenes: 2, referencia: false } });
  });

  // 🔴 LA REGLA ENTERA: el brief no cabe. Una clave de más descarta el evento
  // completo, no se «limpia» y se guarda el resto.
  it("una clave de más descarta el evento entero — el brief no se cuela por ningún lado", () => {
    expect(
      validarEventoDeCliente({
        nombre: "crear_envio",
        sesion: SESION,
        datos: { imagenes: 0, referencia: false, brief: "mi negocio de tacos en Oaxaca" },
      }),
    ).toBeNull();
    expect(validarEventoDeCliente({ nombre: "crear_vista", sesion: SESION, datos: { texto: "hola" } })).toBeNull();
  });

  it("el navegador no puede fingir un fallo del servidor", () => {
    expect(
      validarEventoDeCliente({ nombre: "crear_fallo", sesion: SESION, datos: { codigo: "modelo" } }),
    ).toBeNull();
  });

  it("descarta nombres fuera del catálogo, también los que viven en el prototipo", () => {
    for (const nombre of ["crear_otro", "toString", "__proto__", "constructor", 42]) {
      expect(validarEventoDeCliente({ nombre, sesion: SESION, datos: {} })).toBeNull();
    }
  });

  it("una sesión sin forma descarta el evento", () => {
    expect(validarEventoDeCliente({ nombre: "crear_vista", sesion: "corta", datos: {} })).toBeNull();
    expect(validarEventoDeCliente({ nombre: "crear_vista", sesion: "tiene espacios dentro", datos: {} })).toBeNull();
  });

  // La copia del `SLUG` de las plantillas existe porque aquel fichero arrastra el
  // sanitizador. Una copia sin nada que la ate caduca en silencio: esto la ata,
  // por COMPORTAMIENTO y no por el texto de la regex.
  it("el slug de plantilla es el mismo que exige el alta de plantillas", async () => {
    const { SLUG } = await import("@/lib/templates/admin-schemas");
    const { SLUG_DE_PLANTILLA } = await import("./catalogo");
    const muestras = ["mirror", "a", "a1", "ab-cd", "-ab", "ab-", "Ab", "a_b", "con espacio", "x".repeat(32), "x".repeat(33), ""];
    for (const s of muestras) {
      expect([s, SLUG_DE_PLANTILLA.test(s)]).toEqual([s, SLUG.safeParse(s).success]);
    }
  });

  it("una plantilla sólo pasa con forma de slug", () => {
    expect(validarDatos("crear_plantilla", { plantilla: "mirror" })).toEqual({ plantilla: "mirror" });
    expect(validarDatos("crear_plantilla", { plantilla: "Mi Plantilla" })).toBeNull();
  });

  it("un código de fallo sólo pasa con el formato de Claude Code", () => {
    expect(validarDatos("crear_fallo", { codigo: "sin_creditos" })).toEqual({ codigo: "sin_creditos" });
    expect(validarDatos("crear_fallo", { codigo: "The model said: no" })).toBeNull();
    expect(validarDatos("crear_fallo", { codigo: "puerta", detalle: "x".repeat(41) })).toBeNull();
  });

  it("de un error sale su nombre como código, nunca el mensaje", () => {
    expect(nombreDeError(new TypeError("el brief decía algo privado"))).toBe("type_error");
    const abortado = new Error("x");
    abortado.name = "AbortError";
    expect(nombreDeError(abortado)).toBe("abort_error");
    expect(nombreDeError("no soy un error")).toBe("desconocido");
  });
});
