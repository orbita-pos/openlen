import { describe, expect, it } from "vitest";
import es from "../../../messages/es/panelsChat.json";
import { httpErrorText } from "./http-error";

describe("httpErrorText (N44: el error HTTP en el idioma de quien mira)", () => {
  it("el código del servidor gana al estado", () => {
    expect(httpErrorText(400, "scopeTooLarge")).toEqual({ key: "errors.scopeTooLarge" });
    expect(httpErrorText(400, "promptLength")).toEqual({ key: "errors.promptLength" });
    expect(httpErrorText(400, "noTaggableElements")).toEqual({ key: "errors.noTaggableElements" });
    expect(httpErrorText(413, "pageTooLarge")).toEqual({ key: "errors.pageTooLarge" });
  });

  it("sin código, decide el estado: sesión, no encontrado, página cambiada, servidor", () => {
    expect(httpErrorText(401, undefined)).toEqual({ key: "errors.sessionExpired" });
    expect(httpErrorText(404, undefined)).toEqual({ key: "errors.notFound" });
    expect(httpErrorText(409, undefined)).toEqual({ key: "errors.pageChanged" });
    expect(httpErrorText(413, undefined)).toEqual({ key: "errors.pageTooLarge" });
    expect(httpErrorText(500, undefined)).toEqual({ key: "errors.serverError", values: { status: 500 } });
    expect(httpErrorText(503, null)).toEqual({ key: "errors.serverError", values: { status: 503 } });
  });

  it("un código que no conoce no se usa como clave, y un 4xx sin más cae a «Error en la solicitud (N)»", () => {
    expect(httpErrorText(400, "algoNuevo")).toEqual({ key: "errors.requestFailed", values: { status: 400 } });
    expect(httpErrorText(404, "toString")).toEqual({ key: "errors.notFound" });
    expect(httpErrorText(422, 7)).toEqual({ key: "errors.requestFailed", values: { status: 422 } });
  });

  it("todas las claves que puede devolver existen en panelsChat", () => {
    const casos: [number, unknown][] = [
      [400, "scopeTooLarge"], [400, "promptLength"], [400, "noTaggableElements"], [413, "pageTooLarge"],
      [401, null], [404, null], [409, null], [500, null], [400, null],
    ];
    const errores = es.errors as Record<string, string>;
    for (const [status, code] of casos) {
      const { key } = httpErrorText(status, code);
      expect(errores[key.replace(/^errors\./, "")], key).toBeTypeOf("string");
    }
  });
});
