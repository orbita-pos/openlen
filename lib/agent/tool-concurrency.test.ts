// QUÉ LLAMADAS PUEDEN CORRER A LA VEZ (pieza 4 de Len 2.5, como DeepSeek): un
// clasificador por llamada que falla cerrado.
import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_PARALLEL_TOOL_CALLS, isConcurrencySafe } from "./tool-concurrency";
import { NOMBRE_WEB_FETCH, NOMBRE_WEB_SEARCH } from "./web/herramientas";
import { NOMBRE_BASH } from "./terminal/declaracion";

describe("isConcurrencySafe", () => {
  it("el tope por defecto es el de DeepSeek", () => {
    expect(DEFAULT_MAX_PARALLEL_TOOL_CALLS).toBe(10);
  });

  it("las lecturas, la web y los datos del dueño son seguras", () => {
    for (const n of ["Read", "Grep", "Glob", NOMBRE_WEB_SEARCH, NOMBRE_WEB_FETCH, "ver_visitas", "ver_formularios", "ver_mensajes", "mirar_pagina"]) {
      expect(isConcurrencySafe(n, {}), n).toBe(true);
    }
  });

  it("lo que escribe, pregunta o depende del orden es exclusivo", () => {
    for (const n of ["Edit", "Write", NOMBRE_BASH, "publicar", "revertir_ultimo_cambio", "activar_modulo", "editar_imagen", "preguntar", "preparar_respuesta", "elegir_foto"]) {
      expect(isConcurrencySafe(n, {}), n).toBe(false);
    }
  });

  it("un nombre desconocido es exclusivo, también los de Object.prototype (falla cerrado)", () => {
    expect(isConcurrencySafe("no_existe", {})).toBe(false);
    expect(isConcurrencySafe("toString", {})).toBe(false);
    expect(isConcurrencySafe("constructor", {})).toBe(false);
  });

  it("usar_pagina: segura sólo sin sign_in_as y sin ningún clic", () => {
    expect(isConcurrencySafe("usar_pagina", { pasos: [{ lee: "Carrito" }, { recarga: true }, { escribe: "ana", en: "Nombre" }] })).toBe(true);
    expect(isConcurrencySafe("usar_pagina", { pasos: [{ lee: "x" }, { pulsa: "Enviar" }] })).toBe(false);
    expect(isConcurrencySafe("usar_pagina", { pasos: [{ lee: "x" }], sign_in_as: "ana@ejemplo.mx" })).toBe(false);
  });

  it("usar_pagina con argumentos que no valen es exclusiva (como DeepSeek: lo inválido no se arriesga)", () => {
    expect(isConcurrencySafe("usar_pagina", {})).toBe(false);
    expect(isConcurrencySafe("usar_pagina", { pasos: "lee" })).toBe(false);
    expect(isConcurrencySafe("usar_pagina", { pasos: [null] })).toBe(false);
    expect(isConcurrencySafe("usar_pagina", { pasos: [{ lee: "x" }], sign_in_as: "" })).toBe(true);
  });
});
