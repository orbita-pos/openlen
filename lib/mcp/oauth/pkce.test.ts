// @vitest-environment node
import { describe, expect, it } from "vitest";
import { verifyS256 } from "./pkce";

describe("PKCE S256 (RFC 7636)", () => {
  it("el ejemplo del RFC: el verifier da el challenge", () => {
    expect(verifyS256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk", "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")).toBe(true);
  });
  it("otro verifier, o uno con forma mala, no", () => {
    expect(verifyS256("x".repeat(43), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")).toBe(false);
    expect(verifyS256("corto", "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")).toBe(false);
  });
});
