// @vitest-environment node
import { describe, expect, it } from "vitest";
import { isTokenShaped, newTokenSecret, normalizeScopes, tokenHash } from "./tokens";

describe("la forma de los tokens", () => {
  it("un token nuevo lleva su prefijo y 43 caracteres base64url", () => {
    const t = newTokenSecret("olp_");
    expect(t).toMatch(/^olp_[A-Za-z0-9_-]{43}$/);
    expect(isTokenShaped(t)).toBe(true);
  });
  it("dos tokens nunca se repiten", () => {
    expect(newTokenSecret("olp_")).not.toBe(newTokenSecret("olp_"));
  });
  it("rechaza lo que no tiene la forma (otro prefijo, corto, con espacios)", () => {
    expect(isTokenShaped("olx_" + "a".repeat(43))).toBe(false);
    expect(isTokenShaped("olp_abc")).toBe(false);
    expect(isTokenShaped("olp_" + "a".repeat(42) + " ")).toBe(false);
  });
  it("la huella es SHA-256 hex y estable", () => {
    expect(tokenHash("olp_x")).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash("olp_x")).toBe(tokenHash("olp_x"));
  });
  it("los permisos se quedan sólo con los conocidos, sin repetir y en orden", () => {
    expect(normalizeScopes(["publish", "projects:read", "admin", "publish"])).toEqual(["projects:read", "publish"]);
  });
});
