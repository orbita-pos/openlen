import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { injectSceneMarkup, bake3dScene } from "./procedural-3d";
import { SAMPLE_SPEC } from "../three3d/scene-spec";

describe("injectSceneMarkup", () => {
  const base = "<html><head></head><body><main>hi</main></body></html>";
  const out = injectSceneMarkup(base, { spec: SAMPLE_SPEC, posterUrl: "/assets/p.avif", runtimeUrl: "/assets/r.js" });

  it("uses an AVIF poster as the high-priority LCP image", () => {
    expect(out).toContain("/assets/p.avif");
    expect(out).toContain('fetchpriority="high"');
    expect(out).toMatch(/width="\d+"/);
  });
  it("marks the block for the CSP seal and stores the runtime URL + spec", () => {
    expect(out).toContain("data-ol-has-3d-block");
    expect(out).toContain('data-ol-3d-runtime="/assets/r.js"');
    expect(out).toContain('"kind":"iridescent"');
  });
  it("is idempotent", () => {
    const twice = injectSceneMarkup(out, { spec: SAMPLE_SPEC, posterUrl: "/assets/p.avif", runtimeUrl: "/assets/r.js" });
    expect(twice).toBe(out);
  });
  it("puts the look gradient on the block container when not transparent", () => {
    const out = injectSceneMarkup("<html><head></head><body></body></html>", {
      spec: { ...SAMPLE_SPEC, background: "gradient" }, posterUrl: "/assets/p.avif", runtimeUrl: "/assets/r.js",
    });
    expect(out).toContain("linear-gradient");
  });
  it("no gradient when background is transparent", () => {
    const out = injectSceneMarkup("<html><head></head><body></body></html>", {
      spec: { ...SAMPLE_SPEC, background: "transparent" }, posterUrl: "/assets/p.avif", runtimeUrl: "/assets/r.js",
    });
    expect(out).not.toContain("linear-gradient");
  });
});

describe("bake3dScene", () => {
  it("writes poster + runtime into subDir/assets and injects the block", async () => {
    const subDir = mkdtempSync(join(tmpdir(), "ol3d-"));
    const html = await bake3dScene({
      html: "<html><head></head><body></body></html>",
      subDir,
      spec: SAMPLE_SPEC,
      renderPoster: async () => Buffer.from("FAKEAVIF"),
    });
    expect(html).toContain("data-ol-has-3d-block");
    const assets = readdirSync(join(subDir, "assets"));
    expect(assets.some((f) => f.endsWith(".avif"))).toBe(true);
    expect(assets.some((f) => f.startsWith("openlen-3d-") && f.endsWith(".js"))).toBe(true);
    expect(existsSync(join(subDir, "assets"))).toBe(true);
  });
});
