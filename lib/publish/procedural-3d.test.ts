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

describe("injectSceneMarkup — background preset hero-scoped backdrop", () => {
  const BGSPEC = { ...SAMPLE_SPEC, background: "gradient" as const };
  const withSection =
    '<html><head></head><body><section id="hero" style="padding:4rem;color:#fff"><h1>Title</h1><p>Text</p></section></body></html>';
  const out = injectSceneMarkup(withSection, { spec: BGSPEC, posterUrl: "/assets/p.avif", runtimeUrl: "/assets/r.js" });

  it("block lands INSIDE the first section, not before </body>", () => {
    const sectionIdx = out.indexOf("<section");
    const sectionOpenEnd = out.indexOf(">", sectionIdx) + 1;
    const blockIdx = out.indexOf("data-ol-3d-block");
    const sectionCloseIdx = out.indexOf("</section>");
    expect(blockIdx).toBeGreaterThanOrEqual(sectionOpenEnd);
    expect(blockIdx).toBeLessThan(sectionCloseIdx);
  });

  it("backdrop wrapper uses position:absolute, not position:fixed", () => {
    const divStart = out.indexOf("<div data-ol-3d-block");
    expect(divStart).toBeGreaterThan(-1);
    const divTag = out.slice(divStart, out.indexOf(">", divStart) + 1);
    expect(divTag).toContain("position:absolute");
    expect(divTag).not.toContain("position:fixed");
  });

  it("poster keeps fetchpriority=high inside the hero target", () => {
    expect(out).toContain('fetchpriority="high"');
  });

  it("injects content-above scoped style rule for the target id", () => {
    // Existing id="hero" is preserved; style rule uses it.
    expect(out).toMatch(/#hero>:not\(\[data-ol-3d-block\]\)\{position:relative;z-index:1\}/);
  });

  it("assigns ol3d-hero id and matching style rule when section has no id", () => {
    const noId = '<html><head></head><body><section style="padding:2rem"><h1>Hi</h1></section></body></html>';
    const r = injectSceneMarkup(noId, { spec: BGSPEC, posterUrl: "/assets/p.avif", runtimeUrl: "/assets/r.js" });
    expect(r).toContain('id="ol3d-hero"');
    expect(r).toMatch(/#ol3d-hero>:not\(\[data-ol-3d-block\]\)\{position:relative;z-index:1\}/);
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
