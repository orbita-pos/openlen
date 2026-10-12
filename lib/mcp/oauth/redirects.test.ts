// @vitest-environment node
import { describe, expect, it } from "vitest";
import { isAcceptableRedirectUri, redirectUriMatches } from "./redirects";

describe("qué redirect_uri se acepta", () => {
  it("https, http sólo a loopback, y esquemas privados con punto (RFC 8252)", () => {
    expect(isAcceptableRedirectUri("https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(isAcceptableRedirectUri("http://127.0.0.1:33418/")).toBe(true);
    expect(isAcceptableRedirectUri("http://localhost:8787/callback")).toBe(true);
    expect(isAcceptableRedirectUri("com.example.app:/oauth")).toBe(true);
    expect(isAcceptableRedirectUri("http://evil.com/cb")).toBe(false);
    expect(isAcceptableRedirectUri("javascript:alert(1)")).toBe(false);
    expect(isAcceptableRedirectUri("https://x.com/cb#frag")).toBe(false);
  });
});

describe("🔴 la comparación de redirect_uri", () => {
  const reg = ["https://claude.ai/api/mcp/auth_callback", "http://127.0.0.1:1234/callback"];
  it("exacta para https", () => {
    expect(redirectUriMatches(reg, "https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(redirectUriMatches(reg, "https://claude.ai/api/mcp/auth_callback/x")).toBe(false);
    expect(redirectUriMatches(reg, "https://evil.ai/api/mcp/auth_callback")).toBe(false);
  });
  it("loopback: cualquier puerto, localhost = 127.0.0.1, misma ruta", () => {
    expect(redirectUriMatches(reg, "http://127.0.0.1:50211/callback")).toBe(true);
    expect(redirectUriMatches(reg, "http://localhost:50211/callback")).toBe(true);
    expect(redirectUriMatches(reg, "http://127.0.0.1:50211/otra")).toBe(false);
  });
});
