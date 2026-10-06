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
    for (const n of ["Read", "Grep", "Glob", NOMBRE_WEB_SEARCH, NOMBRE_WEB_FETCH, "get_visits", "list_form_submissions", "list_messages", "view_page"]) {
      expect(isConcurrencySafe(n, {}), n).toBe(true);
    }
  });

  it("lo que escribe, pregunta o depende del orden es exclusivo", () => {
    for (const n of ["Edit", "Write", NOMBRE_BASH, "publish", "undo_last_change", "toggle_module", "edit_image", "preguntar", "draft_reply", "find_photo"]) {
      expect(isConcurrencySafe(n, {}), n).toBe(false);
    }
  });

  it("pieza 5: leer un evento de una charla es seguro; las dos búsquedas, exclusivas (como DeepSeek)", () => {
    expect(isConcurrencySafe("session_event_read", { seq: 1 })).toBe(true);
    expect(isConcurrencySafe("session_search", { query: "x" })).toBe(false);
    expect(isConcurrencySafe("session_event_search", { query: "x" })).toBe(false);
  });

  it("un nombre desconocido es exclusivo, también los de Object.prototype (falla cerrado)", () => {
    expect(isConcurrencySafe("no_existe", {})).toBe(false);
    expect(isConcurrencySafe("toString", {})).toBe(false);
    expect(isConcurrencySafe("constructor", {})).toBe(false);
  });

  it("use_page: segura sólo sin sign_in_as y sin ningún clic", () => {
    expect(isConcurrencySafe("use_page", { steps: [{ read: "Carrito" }, { reload: true }, { type: "ana", into: "Nombre" }] })).toBe(true);
    expect(isConcurrencySafe("use_page", { steps: [{ read: "x" }, { click: "Enviar" }] })).toBe(false);
    expect(isConcurrencySafe("use_page", { steps: [{ read: "x" }], sign_in_as: "ana@ejemplo.mx" })).toBe(false);
  });

  it("use_page con argumentos que no valen es exclusiva (como DeepSeek: lo inválido no se arriesga)", () => {
    expect(isConcurrencySafe("use_page", {})).toBe(false);
    expect(isConcurrencySafe("use_page", { steps: "lee" })).toBe(false);
    expect(isConcurrencySafe("use_page", { steps: [null] })).toBe(false);
    expect(isConcurrencySafe("use_page", { steps: [{ read: "x" }], sign_in_as: "" })).toBe(true);
  });
});
