import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCachedTransform, putCachedTransform } from "./cache";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ol-transform-cache-test-"));
  vi.stubEnv("OPENLEN_TRANSFORM_CACHE_DIR", dir);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe("cache del transform (FS, por templateId+contentHash)", () => {
  it("roundtrip put→get", async () => {
    await putCachedTransform("mirror", "abc123", "<html>transformado</html>");
    expect(await getCachedTransform("mirror", "abc123")).toBe("<html>transformado</html>");
  });
  it("miss → null (id distinto, hash distinto)", async () => {
    await putCachedTransform("mirror", "abc123", "x");
    expect(await getCachedTransform("mirror", "OTRO")).toBeNull();
    expect(await getCachedTransform("otro", "abc123")).toBeNull();
  });
  it("claves hostiles se sanean (sin path traversal)", async () => {
    await putCachedTransform("../../../etc/passwd", "h/../h", "seguro");
    expect(await getCachedTransform("../../../etc/passwd", "h/../h")).toBe("seguro");
    // Nada se escribió fuera del dir del cache: el dir de prueba contiene lo escrito.
    const { readdirSync } = await import("node:fs");
    expect(readdirSync(dir).length).toBeGreaterThan(0);
  });
  it("put falla en silencio si el dir es inescribible (cache es mejora, no dependencia)", async () => {
    vi.stubEnv("OPENLEN_TRANSFORM_CACHE_DIR", join(dir, "no\0valid"));
    await expect(putCachedTransform("a", "b", "c")).resolves.toBeUndefined();
  });
});
