// @vitest-environment node
import { describe, expect, it } from "vitest";
import { CAPTURE_TTL_MS, captureUrl, getCapture, storeCapture } from "./capture-store";

const img = { mimeType: "image/jpeg", dataBase64: Buffer.from("jpeg-bytes").toString("base64") };

describe("las capturas de view_page", () => {
  it("se guardan con un id de 43 caracteres al azar y se leen tal cual", () => {
    const id = storeCapture(img);
    expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(getCapture(id)).toEqual({ mimeType: "image/jpeg", bytes: Buffer.from("jpeg-bytes") });
    expect(storeCapture(img)).not.toBe(id);
  });
  it("🔴 caducada o inventada: null", () => {
    const t0 = Date.now();
    const id = storeCapture(img, t0);
    expect(getCapture(id, t0 + CAPTURE_TTL_MS + 1)).toBeNull();
    expect(getCapture("x".repeat(43))).toBeNull();
  });
  it("no crece sin fin: las más viejas salen primero", () => {
    const first = storeCapture(img);
    for (let i = 0; i < 40; i++) storeCapture(img);
    expect(getCapture(first)).toBeNull();
  });
  it("la URL es la del origen de la web", () => {
    expect(captureUrl("abc", "https://openlen.com/")).toBe("https://openlen.com/api/mcp/capture/abc");
  });
});
