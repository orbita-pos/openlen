import { describe, expect, it } from "vitest";
import { generatePreviewToken, previewTokenMatches } from "./preview";

describe("preview tokens", () => {
  it("generates a url-safe token of at least 43 chars (256-bit base64url)", () => {
    const t = generatePreviewToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(t.length).toBeGreaterThanOrEqual(43);
  });

  it("generates a fresh token each call", () => {
    expect(generatePreviewToken()).not.toBe(generatePreviewToken());
  });

  it("matches a token against itself", () => {
    const t = generatePreviewToken();
    expect(previewTokenMatches(t, t)).toBe(true);
  });

  it("rejects a different token", () => {
    expect(
      previewTokenMatches(generatePreviewToken(), generatePreviewToken()),
    ).toBe(false);
  });

  it("rejects empty / null / undefined on either side without throwing", () => {
    const t = generatePreviewToken();
    expect(previewTokenMatches(t, "")).toBe(false);
    expect(previewTokenMatches("", t)).toBe(false);
    expect(previewTokenMatches(t, null)).toBe(false);
    expect(previewTokenMatches(null, t)).toBe(false);
    expect(previewTokenMatches(undefined, undefined)).toBe(false);
  });

  it("rejects a length-mismatched candidate (no length-leak path throws)", () => {
    expect(previewTokenMatches("short", generatePreviewToken())).toBe(false);
  });

  it("rejects a truncated prefix of a valid token", () => {
    const t = generatePreviewToken();
    expect(previewTokenMatches(t, t.slice(0, -1))).toBe(false);
  });
});
