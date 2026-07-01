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

describe("injectSceneMarkup — background preset hero-scoped backdrop (Fix 1: z-index:-1)", () => {
  const BGSPEC = { ...SAMPLE_SPEC, background: "gradient" as const };
  const withSection =
    '<html><head></head><body><section id="hero" style="padding:4rem;color:#fff"><h1>Title</h1><div class="absolute inset-0 bg-gradient-to-br from-purple-900/60"></div><p>Text</p></section></body></html>';
  const out = injectSceneMarkup(withSection, { spec: BGSPEC, posterUrl: "/assets/p.avif", runtimeUrl: "/assets/r.js" });

  it("block lands INSIDE the first section, not before </body>", () => {
    const sectionIdx = out.indexOf("<section");
    const sectionOpenEnd = out.indexOf(">", sectionIdx) + 1;
    const blockIdx = out.indexOf("data-ol-3d-block");
    const sectionCloseIdx = out.indexOf("</section>");
    expect(blockIdx).toBeGreaterThanOrEqual(sectionOpenEnd);
    expect(blockIdx).toBeLessThan(sectionCloseIdx);
  });

  it("backdrop wrapper uses position:absolute;z-index:-1 (not z-index:0 or positive)", () => {
    const divStart = out.indexOf("<div data-ol-3d-block");
    expect(divStart).toBeGreaterThan(-1);
    const divTag = out.slice(divStart, out.indexOf(">", divStart) + 1);
    expect(divTag).toContain("position:absolute");
    expect(divTag).toContain("z-index:-1");
    expect(divTag).not.toContain("z-index:0");
    expect(divTag).not.toContain("position:fixed");
  });

  it("does NOT emit a content-above :not([data-ol-3d-block]) style rule", () => {
    expect(out).not.toMatch(/:not\(\[data-ol-3d-block\]\)/);
  });

  it("target element gets position:relative;isolation:isolate (required for z-index:-1 containment)", () => {
    const sectionIdx = out.indexOf("<section");
    const sectionTagEnd = out.indexOf(">", sectionIdx) + 1;
    const openTag = out.slice(sectionIdx, sectionTagEnd);
    expect(openTag).toContain("position:relative");
    expect(openTag).toContain("isolation:isolate");
  });

  it("poster keeps fetchpriority=high inside the hero target", () => {
    expect(out).toContain('fetchpriority="high"');
  });

  it("background backdrop has NO launch button (it would be unclickable at z-index:-1) and loads on first interaction", () => {
    // The backdrop sits behind content; a button inside it is intercepted by the
    // hero's content/overlays. Background scenes load on the first user gesture.
    expect(out).not.toContain("data-ol-3d-launch");
    expect(out).toContain("pointerdown");
  });

  it("accent/divider (inline) preset still uses the click-to-launch button", () => {
    const accent = injectSceneMarkup(withSection, {
      spec: { ...SAMPLE_SPEC, preset: "accent" as const },
      posterUrl: "/assets/p.avif",
      runtimeUrl: "/assets/r.js",
    });
    expect(accent).toContain("data-ol-3d-launch");
  });

  it("assigns ol3d-hero id when section has no id", () => {
    const noId = '<html><head></head><body><section style="padding:2rem"><h1>Hi</h1></section></body></html>';
    const r = injectSceneMarkup(noId, { spec: BGSPEC, posterUrl: "/assets/p.avif", runtimeUrl: "/assets/r.js" });
    expect(r).toContain('id="ol3d-hero"');
  });

  it("no content-above rule even when section has no id", () => {
    const noId = '<html><head></head><body><section style="padding:2rem"><h1>Hi</h1></section></body></html>';
    const r = injectSceneMarkup(noId, { spec: BGSPEC, posterUrl: "/assets/p.avif", runtimeUrl: "/assets/r.js" });
    expect(r).not.toMatch(/:not\(\[data-ol-3d-block\]\)/);
  });
});

describe("injectSceneMarkup — marker target gets min-height (Fix 3)", () => {
  const BGSPEC = { ...SAMPLE_SPEC, background: "gradient" as const };

  it("adds min-height to the data-ol-3d-scene marker so the slot has visible area", () => {
    const marker = '<html><head></head><body><section data-ol-3d-scene></section></body></html>';
    const r = injectSceneMarkup(marker, { spec: BGSPEC, posterUrl: "/assets/p.avif", runtimeUrl: "/assets/r.js" });
    const sectionIdx = r.indexOf("<section");
    const sectionTag = r.slice(sectionIdx, r.indexOf(">", sectionIdx) + 1);
    expect(sectionTag).toContain("min-height");
  });

  it("does NOT add min-height to a real section with content (priority 2)", () => {
    const real = '<html><head></head><body><section id="hero" style="padding:4rem"><h1>Title</h1></section></body></html>';
    const r = injectSceneMarkup(real, { spec: BGSPEC, posterUrl: "/assets/p.avif", runtimeUrl: "/assets/r.js" });
    const sectionIdx = r.indexOf("<section");
    const sectionTag = r.slice(sectionIdx, r.indexOf(">", sectionIdx) + 1);
    // Real section should not have min-height injected (it already has content height)
    expect(sectionTag).not.toContain("min-height");
  });
});

describe("injectSceneMarkup — single-quoted attribute handling", () => {
  const BGSPEC = { ...SAMPLE_SPEC, background: "gradient" as const };

  it("mergeStyle handles single-quoted style= correctly", () => {
    const singleQ = `<html><head></head><body><section id='hero' style='padding:4rem;color:#fff'><h1>Hi</h1></section></body></html>`;
    const r = injectSceneMarkup(singleQ, { spec: BGSPEC, posterUrl: "/assets/p.avif", runtimeUrl: "/assets/r.js" });
    // Should not produce a duplicate style= attribute
    const matches = r.match(/\bstyle=/g) ?? [];
    const heroSection = r.slice(r.indexOf("<section"), r.indexOf(">", r.indexOf("<section")) + 1);
    const styleCount = (heroSection.match(/\bstyle=/g) ?? []).length;
    expect(styleCount).toBe(1);
    // Should still inject position:relative;isolation:isolate
    expect(heroSection).toContain("position:relative");
    expect(heroSection).toContain("isolation:isolate");
  });

  it("withId handles single-quoted id= correctly (does not add duplicate)", () => {
    const singleId = `<html><head></head><body><section id='hero'><h1>Hi</h1></section></body></html>`;
    const r = injectSceneMarkup(singleId, { spec: BGSPEC, posterUrl: "/assets/p.avif", runtimeUrl: "/assets/r.js" });
    const heroSection = r.slice(r.indexOf("<section"), r.indexOf(">", r.indexOf("<section")) + 1);
    // Should not add a second id attribute
    const idCount = (heroSection.match(/\bid=/g) ?? []).length;
    expect(idCount).toBe(1);
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

  it("baked background scene wires context-loss recovery events", async () => {
    const subDir = mkdtempSync(join(tmpdir(), "ol3d-"));
    const html = await bake3dScene({
      html: "<html><head></head><body></body></html>",
      subDir,
      spec: SAMPLE_SPEC,
      renderPoster: async () => Buffer.from("FAKEAVIF"),
    });
    expect(html).toContain("three-context-lost");
    expect(html).toContain("three-context-restored");
  });
});

describe("injectSceneMarkup — context-loss recovery (Task 7)", () => {
  const backgroundOut = injectSceneMarkup(
    '<html><head></head><body><section id="hero"><h1>Hi</h1></section></body></html>',
    { spec: SAMPLE_SPEC, posterUrl: "/assets/p.avif", runtimeUrl: "/assets/r.js" },
  );
  const accentOut = injectSceneMarkup("<html><head></head><body></body></html>", {
    spec: { ...SAMPLE_SPEC, preset: "accent" as const },
    posterUrl: "/assets/p.avif",
    runtimeUrl: "/assets/r.js",
  });

  it("background (backdrop) bootstrap listens for context-lost/restored and re-shows the poster", () => {
    expect(backgroundOut).toContain("three-context-lost");
    expect(backgroundOut).toContain("three-context-restored");
  });

  it("accent (button-gated) bootstrap listens for context-lost/restored and re-shows the poster", () => {
    expect(accentOut).toContain("three-context-lost");
    expect(accentOut).toContain("three-context-restored");
  });

  it("accent canvas gets an opacity/transition style so the crossfade works there too", () => {
    const canvasStart = accentOut.indexOf("<canvas data-ol-3d-canvas");
    const canvasTag = accentOut.slice(canvasStart, accentOut.indexOf(">", canvasStart) + 1);
    expect(canvasTag).toContain("opacity:1");
    expect(canvasTag).toContain("transition:opacity .6s ease");
  });
});
