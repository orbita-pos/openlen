// Unit tests for the single save-path funnel (Phase 8.1, added during the
// Editor V5 adversarial-review pass). Locks the V5-marker fix: the backstop
// must remove the overlay, UNWRAP run-wrappers (preserving text), and strip
// the editable/edit-hidden/edit-noedit attrs — so a save from ANY co-injected
// editor surface (props/reorder/replace/insert) never ships them to the
// published page. jsdom provides DOMParser.

import { describe, it, expect } from "vitest";
import { stripEditorInstrumentation } from "./strip-editor-instrumentation";
import { injectBehaviorsPreview } from "./use-behaviors-preview";
import { bakeBehaviors, BEHAVIORS_MARKER } from "@/lib/behaviors/build";
import type { Behavior, BehaviorName } from "@/lib/behaviors/types";
import { CAROUSEL_JS, MARKER as CAROUSEL_MARKER } from "@/lib/publish/carousel";

const DOC = (body: string) =>
  `<!doctype html><html><head></head><body>${body}</body></html>`;

describe("stripEditorInstrumentation — Editor V5 markers", () => {
  it("removes the floating overlay div entirely", () => {
    const out = stripEditorInstrumentation(
      DOC(`<h1>Hello</h1><div data-openlen-edit-overlay contenteditable="plaintext-only">stale overlay text</div>`),
    );
    expect(out).not.toContain("data-openlen-edit-overlay");
    expect(out).not.toContain("stale overlay text");
    expect(out).toContain("<h1>Hello</h1>");
  });

  it("UNWRAPS run-wrappers (deletes the span, keeps the run text)", () => {
    const out = stripEditorInstrumentation(
      DOC(`<p>before <span data-openlen-edit-wrap data-openlen-edit-hidden>run text</span> after</p>`),
    );
    expect(out).not.toContain("data-openlen-edit-wrap");
    expect(out).not.toContain("data-openlen-edit-hidden");
    expect(out).toContain("run text"); // text preserved, span gone
    expect(out).not.toContain("<span");
  });

  it("strips data-openlen-editable / edit-hidden / edit-noedit attrs but keeps the elements", () => {
    const out = stripEditorInstrumentation(
      DOC(`<h1 data-openlen-editable>Title</h1><p data-openlen-edit-hidden>Body</p><span data-openlen-edit-noedit>X</span>`),
    );
    expect(out).not.toContain("data-openlen-editable");
    expect(out).not.toContain("data-openlen-edit-hidden");
    expect(out).not.toContain("data-openlen-edit-noedit");
    expect(out).toContain("Title");
    expect(out).toContain("Body");
    expect(out).toContain("X");
  });

  it("removes co-injected editor scripts + the edit-mode body attr", () => {
    const out = stripEditorInstrumentation(
      `<!doctype html><html><head></head><body data-openlen-edit-mode><h1 data-openlen-editable>Hi</h1>` +
        `<style data-openlen-inline-edit>.x{}</style><script data-openlen-inline-edit>void 0</script>` +
        `<script data-openlen-inspect>void 0</script></body></html>`,
    );
    expect(out).not.toContain("data-openlen-inline-edit");
    expect(out).not.toContain("data-openlen-inspect");
    expect(out).not.toContain("data-openlen-edit-mode");
    expect(out).not.toContain("data-openlen-editable");
    expect(out).toContain("<h1>Hi</h1>");
  });

  it("still strips legacy contenteditable (V4 backstop preserved)", () => {
    const out = stripEditorInstrumentation(DOC(`<h1 contenteditable="true">Hi</h1>`));
    expect(out).not.toContain("contenteditable");
  });

  it("fast-paths clean HTML untouched", () => {
    const clean = DOC(`<h1>Clean</h1>`);
    expect(stripEditorInstrumentation(clean)).toBe(clean);
  });

  it("removes motion/music preview scripts, styles and the preview player", () => {
    const out = stripEditorInstrumentation(
      `<!doctype html><html data-ol-motion="editorial" class="ol-motion-js"><head>` +
        `<style id="ol-motion-preview-style" data-openlen-motion-preview>.x{}</style>` +
        `<style id="ol-music-preview-style" data-openlen-music-preview>.olmp{}</style>` +
        `</head><body><h1>Hi</h1>` +
        `<script data-openlen-motion-preview>void 0</script>` +
        `<script data-openlen-music-preview>void 0</script>` +
        `<div data-openlen-music-preview data-openlen-edit-noedit>` +
        `<div class="olmp" data-ol-music><audio src="/a.mp3"></audio></div></div>` +
        `</body></html>`,
    );
    expect(out).not.toContain("data-openlen-motion-preview");
    expect(out).not.toContain("data-openlen-music-preview");
    expect(out).not.toContain("ol-motion-preview-style");
    expect(out).not.toContain("ol-music-preview-style");
    expect(out).not.toContain("data-ol-music");
    expect(out).not.toContain("<audio");
    expect(out).not.toContain("data-ol-motion");
    expect(out).not.toContain("ol-motion-js");
    expect(out).toContain("<h1>Hi</h1>");
  });

  it("restores motion-runtime mutations: reveal classes + frozen counters", () => {
    const out = stripEditorInstrumentation(
      DOC(
        `<section class="hero ol-in"><h1>Hero</h1>` +
          `<span data-openlen-editable data-ol-counted data-ol-orig="1,200+">37+</span></section>` +
          `<p class="ol-in">lead</p>`,
      ),
    );
    expect(out).not.toContain("ol-in");
    expect(out).not.toContain("data-ol-counted");
    expect(out).not.toContain("data-ol-orig");
    expect(out).not.toContain("37+");
    expect(out).toContain("1,200+"); // counter text restored to the original
    expect(out).toContain('class="hero"'); // sibling classes survive
  });

  it("PRESERVES the persisted temática world (style + font link + html attr)", () => {
    // Temáticas persist IN the document by design (like the Looks inline
    // vars) — the backstop must never confuse them with editor chrome.
    const out = stripEditorInstrumentation(
      `<!doctype html><html data-ol-tematica="coquette"><head>` +
        `<link rel="stylesheet" data-ol-tematica href="https://fonts.googleapis.com/css2?family=Playfair+Display">` +
        `<style data-ol-tematica>html[data-ol-tematica="coquette"]::before{content:""}</style>` +
        `</head><body data-openlen-edit-mode><h1 data-openlen-editable>Hero</h1></body></html>`,
    );
    expect(out).toContain('data-ol-tematica="coquette"');
    expect(out).toContain("<style data-ol-tematica");
    expect(out).toContain('<link rel="stylesheet" data-ol-tematica');
    expect(out).not.toContain("data-openlen-editable");
    expect(out).not.toContain("data-openlen-edit-mode");
  });

  it("removes drop-engine + section-insert markers (incl. the just-inserted highlight)", () => {
    const out = stripEditorInstrumentation(
      `<!doctype html><html><head><style data-openlen-drop>.x{}</style></head>` +
        `<body data-openlen-drop-active="drag">` +
        `<img src="/a.webp" data-openlen-drop-target>` +
        `<div data-openlen-drop="ui" class="openlen-drop-chip">Replace image</div>` +
        `<section data-openlen-just-inserted style="outline: 2px solid rgba(255,90,54,0.65); outline-offset: 3px;"><img src="/b.webp"></section>` +
        `<script data-openlen-section-insert>void 0</script>` +
        `<script data-openlen-drop>void 0</script></body></html>`,
    );
    expect(out).not.toContain("data-openlen-drop");
    expect(out).not.toContain("data-openlen-section-insert");
    expect(out).not.toContain("data-openlen-just-inserted");
    expect(out).not.toContain("openlen-drop-chip");
    expect(out).not.toContain("outline");
    expect(out).toContain('<img src="/a.webp">');
    expect(out).toContain('<img src="/b.webp">');
  });

  it("leaves a full editor-session capture with ZERO leaked markers", () => {
    // Simulates a Properties-panel ('props') save taken while an inline-edit
    // run is open: the shared live DOM carries inline-edit's markers.
    const messy = DOC(
      `<body data-openlen-edit-mode>` +
        `<h1 data-openlen-editable>Hero</h1>` +
        `<p data-openlen-editable>lead <span data-openlen-edit-wrap data-openlen-edit-hidden>run</span> tail</p>` +
        `<div data-openlen-edit-overlay contenteditable="plaintext-only">run edited</div>`,
    );
    const out = stripEditorInstrumentation(messy);
    for (const marker of [
      "data-openlen-editable",
      "data-openlen-edit-hidden",
      "data-openlen-edit-overlay",
      "data-openlen-edit-wrap",
      "data-openlen-edit-mode",
      "contenteditable",
    ]) {
      expect(out).not.toContain(marker);
    }
    expect(out).toContain("Hero");
    expect(out).toContain("run"); // unwrapped run text survives
  });
});

describe("stripEditorInstrumentation — behaviors runtime scripts", () => {
  // Same fake-registry pattern as lib/behaviors/build.test.ts and
  // use-behaviors-preview.test.ts — the real registry (lib/behaviors/registry.ts)
  // is still empty in F1, so testing against it wouldn't prove anything.
  const fake = (name: string, marker: string, js: string, headJs?: string): Behavior =>
    ({
      name: name as BehaviorName, marker, js, headJs, budgetBytes: 700,
      schema: { root: { kind: "flag" } },
      degradation: "content-intact", a11y: [], status: "stable",
      doc: { when: "", whenNot: "", example: "" },
    }) as Behavior;

  const REG = {
    countdown: fake("countdown", "data-ol-countdown", "/*CD*/"),
  } as Partial<Record<BehaviorName, Behavior>>;
  const ORDER: BehaviorName[] = ["countdown"];

  it("removes the body behaviors script and keeps real content intact", () => {
    const out = stripEditorInstrumentation(
      DOC(`<h1>Hello</h1><script ${BEHAVIORS_MARKER}>void 0</script>`),
    );
    expect(out).not.toContain(BEHAVIORS_MARKER);
    expect(out).toContain("<h1>Hello</h1>");
  });

  it("removes the head behaviors script", () => {
    const out = stripEditorInstrumentation(
      `<!doctype html><html><head><script ${BEHAVIORS_MARKER}-head>void 0</script></head>` +
        `<body><h1>Hello</h1></body></html>`,
    );
    expect(out).not.toContain(`${BEHAVIORS_MARKER}-head`);
    expect(out).toContain("<h1>Hello</h1>");
  });

  it("removes both the head and body scripts when present together", () => {
    const out = stripEditorInstrumentation(
      `<!doctype html><html><head><script ${BEHAVIORS_MARKER}-head>void 0</script></head>` +
        `<body><h1>Hello</h1><script ${BEHAVIORS_MARKER}>void 0</script></body></html>`,
    );
    expect(out).not.toContain(BEHAVIORS_MARKER);
    expect(out).toContain("<h1>Hello</h1>");
  });

  it("lets bakeBehaviors re-inject after the strip — closes the idempotency-guard divergence bug", () => {
    const withBehavior = DOC(`<div data-ol-countdown="2026-08-15T20:00Z"></div>`);
    const baked = bakeBehaviors(withBehavior, REG, ORDER);
    expect(baked).toContain(BEHAVIORS_MARKER); // sanity: the bake actually fired

    const stripped = stripEditorInstrumentation(baked);
    expect(stripped).not.toContain(BEHAVIORS_MARKER);

    // Before the fix, bakeBehaviors' own guard —
    // `if (html.includes(BEHAVIORS_MARKER)) return html;` — would see the
    // leftover marker on a re-save and no-op forever. This proves it doesn't.
    const rebaked = bakeBehaviors(stripped, REG, ORDER);
    expect(rebaked).not.toBe(stripped);
    expect(rebaked).toContain(BEHAVIORS_MARKER);
  });

  it("a document without behaviors scripts passes through the parse path undamaged", () => {
    const out = stripEditorInstrumentation(
      DOC(`<h1 data-openlen-editable>Hello</h1><p>World</p>`),
    );
    expect(out).not.toContain(BEHAVIORS_MARKER);
    expect(out).not.toContain("data-openlen-editable");
    expect(out).toContain("Hello");
    expect(out).toContain("World");
  });
});

// Task 14b — the carousel preview injector (use-behaviors-preview.ts) bakes
// the SAME <script data-ol-carousel> that publish's bakeCarousels does, and
// guards on CAROUSEL_MARKER's mere presence the same way BEHAVIORS_MARKER is
// guarded — so it is exposed to the EXACT divergence bug the tests above
// already closed for behaviors (commit 90f85c0). Same fix, same proof.
describe("stripEditorInstrumentation — carousel runtime script (Task 14b)", () => {
  it("removes the carousel script and keeps real content intact", () => {
    const out = stripEditorInstrumentation(
      DOC(`<h1>Hello</h1><script ${CAROUSEL_MARKER}>void 0</script>`),
    );
    expect(out).not.toContain(CAROUSEL_MARKER);
    expect(out).toContain("<h1>Hello</h1>");
  });

  it("lets the carousel preview injector re-inject after the strip — closes the idempotency-guard divergence bug for carousel too", () => {
    const withCarousel = DOC(
      `<div data-ol-row><button data-ol-scroll="prev">‹</button><button data-ol-scroll="next">›</button>` +
        `<div data-ol-scroller><article>1</article></div></div>`,
    );
    const injected = injectBehaviorsPreview(withCarousel);
    expect(injected).toContain(CAROUSEL_JS); // sanity: the injector actually fired

    const stripped = stripEditorInstrumentation(injected);
    expect(stripped).not.toContain(CAROUSEL_MARKER);

    // Before this fix, a leaked <script data-ol-carousel> surviving a save
    // would make the preview injector's own marker guard —
    // `if (html.includes(CAROUSEL_MARKER)) return html;` — no-op forever on
    // this document. This proves a re-save (strip) followed by a re-render
    // (inject) still produces a live runtime.
    const reinjected = injectBehaviorsPreview(stripped);
    expect(reinjected).not.toBe(stripped);
    expect(reinjected).toContain(CAROUSEL_JS);
  });
});
