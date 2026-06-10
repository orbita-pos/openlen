// Tests for the publish-time Motion Looks injection (lib/publish/motion.ts)
// and the preset CSS/runtime contracts (lib/publish/motion-presets.ts).
//
// Run via: npx tsx --test lib/publish/motion.test.ts

import { test } from "node:test";
import { strict as assert } from "node:assert";

import { bakeMotion } from "./motion";
import {
  isMotionPreset,
  motionCss,
  MOTION_PRESETS,
  MOTION_RUNTIME_JS,
} from "./motion-presets";

const PAGE =
  '<!doctype html><html lang="en"><head><title>t</title></head><body><main><section><h1>Hi</h1></section></main></body></html>';

test("preset guard accepts only the three presets", () => {
  assert.ok(MOTION_PRESETS.every(isMotionPreset));
  for (const bad of ["", "off", "fancy", undefined, null, 1]) {
    assert.equal(isMotionPreset(bad), false);
  }
});

test("no preset / invalid preset = byte-equal passthrough", () => {
  assert.equal(bakeMotion(PAGE, undefined), PAGE);
  assert.equal(bakeMotion(PAGE, ""), PAGE);
  assert.equal(bakeMotion(PAGE, "off"), PAGE);
  assert.equal(bakeMotion(PAGE, "fancy"), PAGE);
});

test("bake stamps the marker, the style and the runtime", () => {
  const out = bakeMotion(PAGE, "editorial");
  assert.ok(out.includes('data-ol-motion="editorial"'));
  assert.ok(out.includes("<style data-ol-motion>"));
  assert.ok(out.includes("<script data-ol-motion>"));
  // The marker lands on <html>.
  assert.match(out, /<html[^>]*data-ol-motion="editorial"/);
});

test("bake is idempotent (already-baked page untouched)", () => {
  const once = bakeMotion(PAGE, "dramatic");
  const twice = bakeMotion(once, "dramatic");
  assert.equal(once, twice);
});

test("runtime + reveal CSS go inside prefers-reduced-motion no-preference", () => {
  for (const p of MOTION_PRESETS) {
    const css = motionCss(p);
    assert.ok(css.includes("@media (prefers-reduced-motion: no-preference)"));
    // The "start hidden" state must be gated so no-support+no-JS stays visible.
    assert.ok(css.includes("@supports (animation-timeline: view())"));
    assert.ok(css.includes("ol-motion-js"));
  }
  // Runtime bails under reduced-motion + reads the marker.
  assert.ok(MOTION_RUNTIME_JS.includes("prefers-reduced-motion: reduce"));
  assert.ok(MOTION_RUNTIME_JS.includes("data-ol-motion"));
});

test("preset character escalates: dramatic adds parallax + pin, calm doesn't", () => {
  const calm = motionCss("calm");
  const editorial = motionCss("editorial");
  const dramatic = motionCss("dramatic");
  // Parallax only on editorial/dramatic.
  assert.ok(!calm.includes("ol-parallax"));
  assert.ok(editorial.includes("ol-parallax"));
  assert.ok(dramatic.includes("ol-parallax"));
  // Sticky pin only on dramatic.
  assert.ok(!editorial.includes("position: sticky"));
  assert.ok(dramatic.includes("position: sticky"));
  // Stagger delays only when step > 0 (editorial/dramatic).
  assert.ok(!calm.includes("animation-delay"));
  assert.ok(editorial.includes("animation-delay"));
});

test("bake without <head> still injects (style before body, runtime at end)", () => {
  const frag = "<html><body><main><p>x</p></main></body></html>";
  const out = bakeMotion(frag, "calm");
  assert.ok(out.includes("<style data-ol-motion>"));
  assert.ok(out.includes("<script data-ol-motion>"));
  assert.ok(out.includes('data-ol-motion="calm"'));
});

test("the runtime is a self-contained IIFE that parses", () => {
  // Throws on a syntax error — guards against template-composition breakage.
  assert.doesNotThrow(() => new Function(MOTION_RUNTIME_JS));
});
