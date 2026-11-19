import { describe, expect, it } from "vitest";
import { lintMotionSources } from "./lint";

describe("motion GSAP static linter (A4)", () => {
  it("reports clean on a deterministic GSAP composition with matching duration", () => {
    const res = lintMotionSources(
      {
        "index.html": "<!doctype html><html><body><h1>Hola</h1></body></html>",
        "styles.css": "h1 { color: #fff; opacity: 1; }",
        "main.ts": 'const tl = gsap.timeline({paused:true}); tl.fromTo("h1", {x:0}, {x:100, duration:6, immediateRender:false});',
      },
      6,
    );
    expect(res.warnings).toEqual([]);
    expect(res.stats).toEqual({ tweens: 1, animatedDurationEstimate: 6 });
  });

  it("flags gsap_css_transform_conflict when CSS transitions transform alongside GSAP transform tweens", () => {
    const res = lintMotionSources(
      {
        "styles.css": ".card { transition: transform 0.3s ease; }",
        "main.ts": 'tl.fromTo(".card", {x: -40}, {x: 0, duration: 5});',
      },
      6,
    );
    expect(res.warnings.map((w) => w.code)).toContain("gsap_css_transform_conflict");
  });

  it("flags layout_read_in_tween when onUpdate calls getBoundingClientRect", () => {
    const res = lintMotionSources(
      {
        "main.ts": 'tl.to(".bar", { scaleX: 1, duration: 5, onUpdate: () => { const r = el.getBoundingClientRect(); } });',
      },
      6,
    );
    expect(res.warnings.map((w) => w.code)).toContain("layout_read_in_tween");
  });

  it("flags dead_timeline_warning when no tweens exist or animated duration is sparse", () => {
    const none = lintMotionSources({ "main.ts": "window.lenMotion = { durationSeconds: 6, ready: async () => {}, seek: async () => {} };" }, 6);
    expect(none.warnings.map((w) => w.code)).toContain("dead_timeline_warning");

    const sparse = lintMotionSources({ "main.ts": 'tl.fromTo("h1", {opacity:0}, {opacity:1, duration: 0.5});' }, 10);
    expect(sparse.warnings.map((w) => w.code)).toContain("dead_timeline_warning");
  });
});
