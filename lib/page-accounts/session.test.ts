import { describe, expect, it } from "vitest";
import {
  buildSessionCookie,
  clearSessionCookie,
  hashToken,
  newSessionToken,
  OWNER_SESSION_TTL_MS,
  readSessionCookie,
  SESSION_COOKIE,
} from "./session";

const cabeceras = (cookie: string | null) => ({ get: (n: string) => (n === "cookie" ? cookie : null) });

describe("la cookie de sesión", () => {
  // 🔴 Lo que cierra la plantación desde un subdominio hermano: sin `Domain`,
  // con `Secure` y `Path=/`, que es lo que el navegador exige a `__Host-`.
  it("es __Host-: Secure, Path=/, sin Domain, HttpOnly", () => {
    const c = buildSessionCookie("x".repeat(43), OWNER_SESSION_TTL_MS);
    expect(c.startsWith(`${SESSION_COOKIE}=`)).toBe(true);
    expect(SESSION_COOKIE.startsWith("__Host-")).toBe(true);
    expect(c).toContain("; Secure");
    expect(c).toContain("; Path=/;");
    expect(c).toContain("; HttpOnly");
    expect(c).toContain("; SameSite=Lax");
    expect(c.toLowerCase()).not.toContain("domain=");
    expect(c).toContain(`Max-Age=${7 * 24 * 60 * 60}`);
  });

  it("borrarla la caduca con los mismos atributos", () => {
    const c = clearSessionCookie();
    expect(c).toContain("Max-Age=0");
    expect(c).toContain("; Secure");
    expect(c.toLowerCase()).not.toContain("domain=");
  });

  it("lee el token que emitimos y sólo ése", () => {
    const { raw, hash } = newSessionToken();
    expect(hash).toBe(hashToken(raw));
    expect(readSessionCookie(cabeceras(`ol_v=abc; ${SESSION_COOKIE}=${raw}; otra=1`))).toBe(raw);
    expect(readSessionCookie(cabeceras(`${SESSION_COOKIE}=corto`))).toBeNull();
    expect(readSessionCookie(cabeceras(`${SESSION_COOKIE}=${raw}'--`))).toBeNull();
    expect(readSessionCookie(cabeceras("ol_v=abc"))).toBeNull();
    expect(readSessionCookie(cabeceras(null))).toBeNull();
  });

  it("dos tokens nunca se repiten", () => {
    expect(newSessionToken().raw).not.toBe(newSessionToken().raw);
  });
});
