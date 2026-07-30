import { describe, expect, test } from "vitest";
import { EMBED_SANDBOX_CSP, embedSandboxHeaders } from "./embed-sandbox";

function req(dest?: string): Request {
  return new Request("https://openlen.com/api/projects/p1/raw", {
    headers: dest === undefined ? {} : { "sec-fetch-dest": dest },
  });
}

describe("CSP de aislamiento para HTML de proyecto incrustado", () => {
  test("la política quita el origen: sin allow-same-origin", () => {
    expect(EMBED_SANDBOX_CSP).toContain("sandbox");
    expect(EMBED_SANDBOX_CSP).toContain("allow-scripts");
    // Lo único que importa: con allow-same-origin el sandbox no aísla nada.
    expect(EMBED_SANDBOX_CSP).not.toContain("allow-same-origin");
  });

  test("dentro de un iframe → sandboxeado", () => {
    expect(embedSandboxHeaders(req("iframe"))["content-security-policy"]).toBe(
      EMBED_SANDBOX_CSP,
    );
  });

  test("otros destinos de enmarcado también cuentan", () => {
    for (const dest of ["frame", "embed", "object"]) {
      expect(embedSandboxHeaders(req(dest))["content-security-policy"]).toBe(
        EMBED_SANDBOX_CSP,
      );
    }
  });

  test("navegación de primer nivel → SIN sandbox (abrir en pestaña sigue clicable)", () => {
    expect(embedSandboxHeaders(req("document"))).toEqual({});
  });

  // Deliberado: el header lo pone el navegador y una página no puede falsearlo
  // (es un nombre prohibido). Si falta, el cliente es viejo o no-navegador y se
  // sirve como hasta hoy — el aislamiento no empeora respecto del estado previo,
  // y en los iframes propios ya no va allow-same-origin.
  test("sin el header → sin sandbox, no rompe clientes que no lo mandan", () => {
    expect(embedSandboxHeaders(req())).toEqual({});
    expect(embedSandboxHeaders(req(""))).toEqual({});
  });

  test("tolera mayúsculas y espacios", () => {
    expect(embedSandboxHeaders(req(" IFRAME "))["content-security-policy"]).toBe(
      EMBED_SANDBOX_CSP,
    );
  });
});
