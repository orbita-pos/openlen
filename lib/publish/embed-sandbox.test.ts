import { describe, expect, test } from "vitest";
import { EMBED_SANDBOX_CSP, TAB_SANDBOX_CSP, embedSandboxHeaders } from "./embed-sandbox";

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

  // 🔴 INVERTIDA el 2026-10-04. Se llamaba «navegación de primer nivel → SIN
  // sandbox (abrir en pestaña sigue clicable)»: la pestaña corría el JavaScript
  // del proyecto como openlen.com, con la sesión del dueño. Hoy «abrir en
  // pestaña» redirige al lienzo en `.app`; lo que llega aquí en primer nivel es
  // la reserva, y la reserva tampoco es el origen de la app.
  test("navegación de primer nivel → sandbox navegable, SIN allow-same-origin", () => {
    expect(embedSandboxHeaders(req("document"))["content-security-policy"]).toBe(TAB_SANDBOX_CSP);
    expect(TAB_SANDBOX_CSP).toContain("sandbox");
    expect(TAB_SANDBOX_CSP).toContain("allow-scripts");
    expect(TAB_SANDBOX_CSP).toContain("allow-popups");
    expect(TAB_SANDBOX_CSP).toContain("allow-forms");
    expect(TAB_SANDBOX_CSP).not.toContain("allow-same-origin");
  });

  // También INVERTIDA: sin el header se servía sin sandbox «como hasta hoy».
  // Sin saber dónde va a pintarse, no se le da el origen de la app.
  test("sin el header → sandbox igual (no se sabe dónde va)", () => {
    expect(embedSandboxHeaders(req())["content-security-policy"]).toBe(TAB_SANDBOX_CSP);
    expect(embedSandboxHeaders(req(""))["content-security-policy"]).toBe(TAB_SANDBOX_CSP);
  });

  test("tolera mayúsculas y espacios", () => {
    expect(embedSandboxHeaders(req(" IFRAME "))["content-security-policy"]).toBe(
      EMBED_SANDBOX_CSP,
    );
  });
});
