// Tests for the publish-time music-player injection (lib/publish/music.ts)
// and the shared markup/CSS/runtime contracts (lib/publish/music-player.ts).
//
// Run via: npx tsx --test lib/publish/music.test.ts

import { test } from "node:test";
import { strict as assert } from "node:assert";

import { bakeMusic } from "./music";
import {
  isMusicSettings,
  musicCss,
  musicMarkup,
  MUSIC_RUNTIME_JS,
} from "./music-player";

const PAGE =
  '<!doctype html><html lang="en"><head><title>t</title></head><body><main><section><h1>Hi</h1></section></main></body></html>';

const TRACK = {
  src: "/api/projects/p1/assets/abc123.mp3",
  title: "luv u",
  cover: "/api/projects/p1/assets/cover9.webp",
};

test("settings guard accepts a track and rejects malformed shapes", () => {
  assert.ok(isMusicSettings(TRACK));
  assert.ok(isMusicSettings({ src: "/assets/a.mp3" }));
  for (const bad of [null, undefined, {}, { src: "" }, { src: "   " }, { src: 7 }, "x"]) {
    assert.equal(isMusicSettings(bad), false);
  }
});

test("no track / malformed track = byte-equal passthrough", () => {
  assert.equal(bakeMusic(PAGE, undefined), PAGE);
  assert.equal(bakeMusic(PAGE, null), PAGE);
  assert.equal(bakeMusic(PAGE, { src: "" }), PAGE);
});

test("bake injects the style, the player markup and the runtime", () => {
  const out = bakeMusic(PAGE, TRACK);
  assert.ok(out.includes("<style data-ol-music>"));
  assert.ok(out.includes('data-ol-music role="group"'));
  assert.ok(out.includes("<script data-ol-music>"));
  assert.ok(out.includes('src="/api/projects/p1/assets/abc123.mp3"'));
  assert.ok(out.includes("luv u"));
  // Style lands in <head>; widget before </body>.
  assert.ok(out.indexOf("<style data-ol-music>") < out.indexOf("</head>"));
  assert.ok(out.indexOf("<script data-ol-music>") < out.indexOf("</body>"));
});

test("bake is idempotent (already-baked page untouched)", () => {
  const once = bakeMusic(PAGE, TRACK);
  const twice = bakeMusic(once, TRACK);
  assert.equal(once, twice);
});

test("title + urls are escaped — hostile settings can't inject markup", () => {
  const out = musicMarkup({
    src: '/a.mp3"><script>alert(1)</script>',
    title: '<img src=x onerror=alert(1)> & "quotes"',
  });
  assert.ok(!out.includes("<script>alert(1)</script>"));
  assert.ok(!out.includes("<img src=x"));
  assert.ok(out.includes("&lt;img"));
  assert.ok(out.includes("&amp;"));
  // The only <script> allowed near the player is the one bakeMusic appends.
  assert.equal((out.match(/<script/g) ?? []).length, 0);
});

test("cover renders an <img>; no cover falls back to the note glyph", () => {
  const withCover = musicMarkup(TRACK);
  assert.ok(withCover.includes('<img class="olmp-cover"'));
  const noCover = musicMarkup({ src: "/a.mp3", title: "x" });
  assert.ok(!noCover.includes("<img"));
  assert.ok(noCover.includes("olmp-cover-fallback"));
});

test("player is honest about autoplay: preload none, loop, tap-to-play", () => {
  const out = musicMarkup(TRACK);
  assert.ok(out.includes('preload="none"'));
  assert.ok(out.includes(" loop "));
  assert.ok(out.includes('aria-label="Play"'));
});

test("css is token-driven with fallbacks + motion gated on reduced-motion", () => {
  const css = musicCss();
  assert.ok(css.includes("var(--ol-accent"));
  assert.ok(css.includes("var(--ol-surface"));
  assert.ok(css.includes("var(--ol-r-scale"));
  assert.ok(css.includes("position:fixed"));
  assert.ok(css.includes("@media (prefers-reduced-motion:no-preference)"));
});

test("player defends against kit button ornaments (no pseudo content inside)", () => {
  // Temática extraCss decorates [class*="btn"] buttons with ::before/::after
  // ornaments — .olmp-btn matches, so the widget must null them out or the
  // play icon grows a flower (seen live with coquette).
  assert.ok(musicCss().includes(".olmp ::before,.olmp ::after{content:none !important}"));
});

test("bake without <head> still injects (style after body open)", () => {
  const frag = "<html><body><main><p>x</p></main></body></html>";
  const out = bakeMusic(frag, TRACK);
  assert.ok(out.includes("<style data-ol-music>"));
  assert.ok(out.includes("<script data-ol-music>"));
});

test("the runtime is a self-contained IIFE that parses", () => {
  assert.doesNotThrow(() => new Function(MUSIC_RUNTIME_JS));
  assert.ok(MUSIC_RUNTIME_JS.includes("data-ol-music"));
});
