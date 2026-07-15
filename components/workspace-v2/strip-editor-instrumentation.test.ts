// Unit tests for the single save-path funnel (Phase 8.1, added during the
// Editor V5 adversarial-review pass). Locks the V5-marker fix: the backstop
// must remove the overlay, UNWRAP run-wrappers (preserving text), and strip
// the editable/edit-hidden/edit-noedit attrs — so a save from ANY co-injected
// editor surface (props/reorder/replace/insert) never ships them to the
// published page. jsdom provides DOMParser.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { stripEditorInstrumentation } from "./strip-editor-instrumentation";
import { injectBehaviorsPreview, stashBehaviorsPristineState } from "./use-behaviors-preview";
import { bakeBehaviors, buildBehaviorsScript, BEHAVIORS_MARKER } from "@/lib/behaviors/build";
import { BEHAVIORS, BEHAVIOR_ORDER } from "@/lib/behaviors/registry";
import { mount, trackDocumentListeners } from "@/lib/behaviors/recipes/test-helpers";
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
  // use-behaviors-preview.test.ts — this file tests the STRIPPING mechanism
  // against a controlled registry, independent of what the real registry
  // (lib/behaviors/registry.ts, all 7 recipes since Task 13) happens to contain.
  const fake = (name: string, marker: string, js: string, headJs?: string): Behavior =>
    ({
      name: name as BehaviorName, marker, js, headJs, budgetBytes: 700, docBudgetChars: 1200,
      schema: { root: { kind: "flag" } },
      degradation: "content-intact", a11y: [], status: "stable",
      doc: { label: "", when: "", whenNot: "", example: "" },
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

// ---------------------------------------------------------------------------
// CRITICAL — the preview runtime (lib/behaviors/recipes/*.ts, injected live
// into the editor iframe for editor↔published parity) MUTATES THE LIVE DOM.
// The save funnel clones that live DOM (same principle as
// use-inline-edit.ts::captureClean) — every test above only proves the
// runtime SCRIPTS get removed on save, never that their MUTATIONS get undone.
// A creator who merely LOOKS at their own page in the preview (clicks a
// filter chip, opens a lightbox photo, tries the theme toggle) and then edits
// unrelated text ships the dirty live state: data-ol-hidden bakes into the
// publish CSS ([data-ol-hidden]{display:none!important}) as silent content
// loss, the lightbox modal ships with no working close listener (a dead
// black overlay), theme's on-page test leaks into the shipped default, and
// countdown ships whatever digits/visibility happened to be on screen.
//
// mount() from recipes/test-helpers.ts only sets body.innerHTML — this
// reproduction also needs control over <html>'s own class (theme's mutation
// target), so it uses its own fuller mount below.

/** Mounts a FULL document — runs `html` through stashBehaviorsPristineState
 *  (the same preview-only step preview-area.tsx's derive() applies before a
 *  browser ever sees the srcDoc) and transplants the result onto the GLOBAL
 *  document, since the composed runtime references bare `document.*` and
 *  must run against the same `document` the test queries afterwards. */
function mountFullDocument(html: string) {
  const withStash = stashBehaviorsPristineState(html);
  const parsed = new DOMParser().parseFromString(withStash, "text/html");
  for (const attr of Array.from(document.documentElement.attributes)) {
    document.documentElement.removeAttribute(attr.name);
  }
  for (const attr of Array.from(parsed.documentElement.attributes)) {
    document.documentElement.setAttribute(attr.name, attr.value);
  }
  document.head.innerHTML = parsed.head.innerHTML;
  document.body.innerHTML = parsed.body.innerHTML;
  const script = buildBehaviorsScript(withStash);
  if (script) {
    // eslint-disable-next-line no-new-func
    new Function(script)();
  }
}

const REPRO_MARKUP = `<!doctype html><html><head></head><body>
  <div data-ol-filter-group="menu">
    <button data-ol-filter="*" aria-pressed="true">Todo</button>
    <button data-ol-filter="tacos" aria-pressed="false">Tacos</button>
  </div>
  <div data-ol-filter-target="menu">
    <article data-ol-tag="tacos" id="a-tacos">Tacos al pastor</article>
    <article data-ol-tag="bebidas" id="a-bebidas">Agua de horchata</article>
  </div>
  <a data-ol-lightbox href="https://images.openlen.com/plato-grande.jpg" id="foto">
    <img src="https://images.openlen.com/plato-thumb.jpg" alt="Plato">
  </a>
  <button data-ol-theme aria-label="Cambiar tema">Tema</button>
  <div data-ol-countdown="2099-01-01T00:00:00Z" id="cd">
    <span data-ol-cd="days">00</span>
    <span data-ol-cd="hours">00</span>
    <span data-ol-cd="mins">00</span>
    <span data-ol-cd="secs">00</span>
  </div>
</body></html>`;

describe("stripEditorInstrumentation — CRITICAL: preview mutations must not reach the saved document", () => {
  trackDocumentListeners();

  beforeEach(() => {
    document.body.innerHTML = "";
    document.head.innerHTML = "";
    for (const attr of Array.from(document.documentElement.attributes)) {
      document.documentElement.removeAttribute(attr.name);
    }
  });

  it("un chip de filtro + una foto de lightbox + el toggle de tema, guardados, ensucian el HTML publicado", () => {
    mountFullDocument(REPRO_MARKUP);

    // El creador mira su propia página en el preview.
    document.querySelector<HTMLButtonElement>('[data-ol-filter="tacos"]')!.click();
    document.querySelector<HTMLAnchorElement>("#foto")!.click();
    document.querySelector<HTMLButtonElement>("[data-ol-theme]")!.click();

    // El funnel de guardado clona el DOM VIVO — mismo principio que
    // use-inline-edit.ts::captureClean().
    const dirty = "<!doctype html>\n" + document.documentElement.outerHTML;
    const saved = stripEditorInstrumentation(dirty);
    // DOM real, no substring crudo del HTML: filter/lightbox tienen `css`, y
    // el propio runtime lo inyecta en vivo como <style> SIN marcador — su
    // TEXTO de selector contiene literalmente "[data-ol-hidden]" /
    // "[data-ol-lb-modal]" aunque NINGÚN elemento lleve ya el atributo. Un
    // .toContain() de string confundiría ese CSS inerte con el bug real.
    const reparsed = new DOMParser().parseFromString(saved, "text/html");

    expect(
      reparsed.querySelectorAll("[data-ol-filtered]").length,
      "filter: data-ol-filtered llegó al HTML publicado (contenido oculto en producción)",
    ).toBe(0);
    expect(
      reparsed.querySelectorAll("[data-ol-lb-modal]").length,
      "lightbox: el modal (sin listener funcional) llegó al HTML publicado",
    ).toBe(0);
    expect(
      reparsed.documentElement.classList.contains("dark"),
      "theme: el toggle de PRUEBA del creador en el preview se filtró como default de <html>",
    ).toBe(false);
    expect(
      reparsed.querySelector('[data-ol-cd="days"]')!.textContent,
      "countdown: los dígitos que el runtime congeló llegaron al HTML publicado",
    ).toBe("00");
    // Arreglo 1 (revisión final de rama): data-ol-filtered ya se limpia
    // arriba, pero eso NO restaura aria-pressed — el click en "tacos" puso
    // aria-pressed="false" en "Todo" y "true" en "Tacos"; sin la restauración
    // esos valores (el estado del click, no el que escribió la IA) llegarían
    // permanentes a la página publicada, sobre una lista ya sin filtrar.
    expect(
      reparsed.querySelector('[data-ol-filter="*"]')!.getAttribute("aria-pressed"),
      "filter: aria-pressed del chip 'Todo' quedó en el valor que dejó el click del creador, no en el que escribió la IA",
    ).toBe("true");
    expect(
      reparsed.querySelector('[data-ol-filter="tacos"]')!.getAttribute("aria-pressed"),
      "filter: aria-pressed del chip 'Tacos' quedó en el valor que dejó el click del creador, no en el que escribió la IA",
    ).toBe("false");
  });

  it("tabs: el creador prueba una pestaña y guarda — ni data-ol-tab-ready/-active persisten (pérdida de contenido) ni aria-selected queda pegado al click", () => {
    const TABS = `<!doctype html><html><head></head><body>
      <div data-ol-tabs="inst"><button data-ol-tab="npm" aria-selected="true">npm</button><button data-ol-tab="pnpm" aria-selected="false">pnpm</button></div>
      <div data-ol-tab-panels="inst"><pre data-ol-tab-panel="npm">npm i</pre><pre data-ol-tab-panel="pnpm">pnpm add</pre></div>
      </body></html>`;
    mountFullDocument(TABS);
    // Sanity: el runtime corrió (init marcó el contenedor + el 1er panel).
    expect(document.querySelector('[data-ol-tab-panels="inst"]')!.hasAttribute("data-ol-tab-ready")).toBe(true);
    // El creador prueba la 2ª pestaña.
    document.querySelector<HTMLElement>('[data-ol-tab="pnpm"]')!.click();
    expect(document.querySelector('[data-ol-tab-panel="pnpm"]')!.hasAttribute("data-ol-tab-active")).toBe(true);

    const saved = stripEditorInstrumentation("<!doctype html>\n" + document.documentElement.outerHTML);
    const out = new DOMParser().parseFromString(saved, "text/html");
    // CRÍTICO: sin esto, la página publicada nacería con ready + active y el
    // CSS ready-gate ocultaría el resto de paneles sin runtime para cambiar.
    expect(saved).not.toContain("data-ol-tab-ready");
    expect(saved).not.toContain("data-ol-tab-active");
    // Y aria-selected vuelve al estado AUTORADO (npm=true), no al del click.
    expect(out.querySelector('[data-ol-tab="npm"]')!.getAttribute("aria-selected")).toBe("true");
    expect(out.querySelector('[data-ol-tab="pnpm"]')!.getAttribute("aria-selected")).toBe("false");
    // El contenido de ambos paneles sigue entero.
    expect(out.body.textContent).toContain("npm i");
    expect(out.body.textContent).toContain("pnpm add");
  });

  it('PRESERVA un <html class="dark"> que el creador escribió a propósito, aunque el runtime lo apague durante la prueba', () => {
    const authoredDark = REPRO_MARKUP.replace("<html><head>", '<html class="dark"><head>');
    mountFullDocument(authoredDark);

    // El creador prueba el toggle un número IMPAR de veces (termina en modo
    // claro) — el caso más adverso: si el strip solo "conservara lo que hay
    // ahora", esto fallaría; debe conservar lo que el AUTOR escribió, no lo
    // que el runtime dejó tras la última prueba.
    document.querySelector<HTMLButtonElement>("[data-ol-theme]")!.click();

    const dirty = "<!doctype html>\n" + document.documentElement.outerHTML;
    const saved = stripEditorInstrumentation(dirty);
    expect(
      new DOMParser().parseFromString(saved, "text/html").documentElement.classList.contains("dark"),
    ).toBe(true);
  });

  it("countdown expirado: la raíz NUNCA se esconde (el mensaje de fin vive dentro) y el mensaje revelado vuelve a nacer oculto al guardar", () => {
    const expiredMarkup = REPRO_MARKUP.replace(
      'data-ol-countdown="2099-01-01T00:00:00Z"',
      'data-ol-countdown="2020-01-01T00:00:00Z"',
    ).replace(
      '<span data-ol-cd="secs">00</span>',
      '<span data-ol-cd="secs">00</span><p data-ol-cd-ended style="display:none">¡Terminó!</p>',
    );
    mountFullDocument(expiredMarkup);
    // Contrato nuevo (revisión Fable, 2026-07-13): al expirar, el runtime
    // congela los dígitos en 00 y revela el mensaje — la raíz queda visible,
    // porque esconderla haría invisible al propio mensaje que revela.
    expect(
      document.getElementById("cd")!.style.display,
      "sanity: el runtime NO esconde la raíz al expirar",
    ).not.toBe("none");
    expect(
      document.querySelector<HTMLElement>("[data-ol-cd-ended]")!.style.display,
      "sanity: el runtime SÍ reveló el mensaje al montar (la fecha ya expiró)",
    ).toBe("");

    const dirty = "<!doctype html>\n" + document.documentElement.outerHTML;
    const saved = stripEditorInstrumentation(dirty);
    const reparsed = new DOMParser().parseFromString(saved, "text/html");
    expect(
      reparsed.getElementById("cd")!.style.display,
      "el bloque del countdown no debe publicarse oculto",
    ).not.toBe("none");
    expect(
      reparsed.querySelector<HTMLElement>("[data-ol-cd-ended]")!.style.display,
      "el mensaje de fin no debe publicarse visible por defecto",
    ).toBe("none");
  });

  // Arreglo 1 (revisión final de rama): el bug que ESTA rama vino a arreglar
  // (el preview ensuciando el documento guardado) se arregló restaurando el
  // style COMPLETO de countdown desde el stash — pero eso mismo BORRABA
  // cualquier estilo legítimo que el creador escribiera DESPUÉS de que el
  // runtime corriera. Es la imagen especular: aquél metía estado del runtime
  // en el documento, éste borraba estado del creador. Las dos pruebas de
  // abajo reproducen los dos vectores reales que lo disparan.
  it("countdown expirado + el creador le da padding/fondo en el inspector DESPUÉS — su estilo sobrevive al guardado intacto", () => {
    const expiredMarkup = REPRO_MARKUP.replace(
      'data-ol-countdown="2099-01-01T00:00:00Z"',
      'data-ol-countdown="2020-01-01T00:00:00Z"',
    );
    mountFullDocument(expiredMarkup);
    const root = document.getElementById("cd")!;
    expect(root.style.display, "sanity: el runtime ya no toca el display de la raíz").not.toBe("none");

    // El inspector (use-element-inspect.ts::applyStyle) hace exactamente
    // esto: el.style.setProperty(prop, value) — el creador estiliza el
    // bloque del countdown DESPUÉS de que el runtime ya lo ocultó.
    root.style.setProperty("padding", "40px");
    root.style.setProperty("background", "rgb(17, 24, 39)");

    const dirty = "<!doctype html>\n" + document.documentElement.outerHTML;
    const saved = stripEditorInstrumentation(dirty);
    const savedRoot = new DOMParser().parseFromString(saved, "text/html").getElementById("cd")!;

    expect(savedRoot.style.display, "el countdown expirado no debe publicarse oculto para siempre").not.toBe("none");
    expect(savedRoot.style.padding, "el padding que el creador escribió DESPUÉS del runtime se descartó").toBe("40px");
    expect(
      savedRoot.style.background,
      "el fondo que el creador escribió DESPUÉS del runtime se descartó",
    ).toBe("rgb(17, 24, 39)");
  });

  it("countdown expirado + el re-ink de Temáticas colorea [data-ol-cd-ended] DESPUÉS — su color sobrevive al guardado y sigue oculto por defecto", () => {
    const expiredMarkup = REPRO_MARKUP.replace(
      'data-ol-countdown="2099-01-01T00:00:00Z"',
      'data-ol-countdown="2020-01-01T00:00:00Z"',
    ).replace(
      '<span data-ol-cd="secs">00</span>',
      '<span data-ol-cd="secs">00</span><p data-ol-cd-ended style="display:none">¡Terminó!</p>',
    );
    mountFullDocument(expiredMarkup);
    const ended = document.querySelector<HTMLElement>("[data-ol-cd-ended]")!;
    expect(ended.style.display, "sanity: el runtime lo reveló al expirar").not.toBe("none");

    // El re-ink de Temáticas (use-element-inspect.ts::olReinkScoped) recorre
    // TODO elemento con texto directo y le fuerza un color — la raíz del
    // countdown incluida — DESPUÉS de que el runtime ya corrió.
    ended.style.setProperty("color", "rgb(255, 0, 0)", "important");

    const dirty = "<!doctype html>\n" + document.documentElement.outerHTML;
    const saved = stripEditorInstrumentation(dirty);
    const savedEnded = new DOMParser().parseFromString(saved, "text/html").querySelector<HTMLElement>(
      "[data-ol-cd-ended]",
    )!;

    expect(
      savedEnded.style.color,
      "el color que el re-ink escribió DESPUÉS del runtime se descartó",
    ).toBe("rgb(255, 0, 0)");
    expect(
      savedEnded.style.display,
      "el mensaje de fin debe seguir oculto por defecto (estado pre-runtime)",
    ).toBe("none");
  });

  // Arreglo 2 (revisión final de rama): el <style> que el propio runtime
  // compuesto crea en vivo (build.ts's styleInject, cuando alguna receta en
  // juego trae `css` — filter/lightbox aquí) no llevaba marcador, así que el
  // strip no podía distinguirlo de un <style> del documento y lo dejaba
  // pasar. Medido por el revisor: 1 → 2 → 3 → 4 tags en 3 ciclos
  // derive→guardar — crecimiento monótono de project.data.html que además
  // llega a la página publicada.
  it("acumulación: N ciclos derive→guardar nunca acumulan el <style> del runtime", () => {
    let html = REPRO_MARKUP; // trae filter + lightbox (ambas con `css`) + countdown + theme
    for (let cycle = 1; cycle <= 4; cycle++) {
      mountFullDocument(html);
      const dirty = "<!doctype html>\n" + document.documentElement.outerHTML;
      html = stripEditorInstrumentation(dirty);
      const styleCount = new DOMParser().parseFromString(html, "text/html").querySelectorAll("style").length;
      expect(
        styleCount,
        `ciclo ${cycle}: ${styleCount} <style> del runtime tras el guardado — se acumula en vez de limpiarse (project.data.html crecería sin límite, y llega a la página publicada)`,
      ).toBeLessThanOrEqual(1);
    }
  });
});

// CRITICAL (revisión final de rama) — data-ol-hidden NO es un marker
// runtime-owned de NINGUNA receta: es el atributo de use-element-inspect.ts's
// applyHide(), la acción deliberada del creador "Ocultar elemento" (toggle en
// properties-panel.tsx), persistida a propósito en el HTML guardado — ver su
// propio ensureHiddenStyle() ahí, que inyecta la regla CSS persistente
// `body:not([data-openlen-edit-mode]) [data-ol-hidden]{display:none!important}`.
// filter.ts solía reclamar ESE MISMO nombre para su propio estado de runtime
// (ahora `data-ol-filtered`, ver lib/behaviors/recipes/filter.ts) y la lista
// runtime-owned de arriba lo borraba incondicionalmente en cada guardado —
// des-ocultando en silencio cualquier elemento que un creador hubiera
// ocultado a propósito, con o sin la receta filter en la página. Este test
// reproduce exactamente lo que applyHide() deja en el documento (el atributo
// + su <style> persistente, SIN ningún inspect-marker — postClean ya los
// limpió) y prueba, con DOM real (no substring crudo: "data-ol-hidden-style"
// contiene "data-ol-hidden" como substring, así que un .toContain() de string
// pasaría en falso-verde incluso con el bug presente), que sobrevive.
describe("stripEditorInstrumentation — data-ol-hidden pertenece al inspector, no a ninguna receta (CRITICAL)", () => {
  it("un elemento oculto con la acción 'Ocultar elemento' del inspector sobrevive al guardado, con su regla CSS persistente intacta", () => {
    const dirty =
      `<!doctype html><html><head>` +
      `<style data-ol-hidden-style>body:not([data-openlen-edit-mode]) [data-ol-hidden]{display:none !important;}</style>` +
      `</head><body>` +
      `<section data-ol-hidden id="oculta"><h2>Seccion oculta a proposito por el creador</h2></section>` +
      `<h1>Visible</h1>` +
      `</body></html>`;

    const out = stripEditorInstrumentation(dirty);
    const reparsed = new DOMParser().parseFromString(out, "text/html");

    expect(
      reparsed.getElementById("oculta")?.hasAttribute("data-ol-hidden"),
      "data-ol-hidden es del INSPECTOR (acción 'Ocultar elemento', use-element-inspect.ts::applyHide) — una acción deliberada y PERSISTIDA del creador, nunca un marker runtime-owned de ninguna receta. Si esto es false, alguien re-agregó data-ol-hidden a la lista runtime-owned del strip (o una receta volvió a reclamar ese nombre) y este test debe recordar por qué eso rompe producción.",
    ).toBe(true);
    expect(
      reparsed.querySelector("style[data-ol-hidden-style]"),
      "la regla CSS persistente que oculta [data-ol-hidden] debe sobrevivir junto con el atributo — de lo contrario el elemento queda marcado como oculto pero sin CSS que lo oculte",
    ).not.toBeNull();
    expect(reparsed.body.textContent).toContain("Seccion oculta a proposito por el creador");
    expect(reparsed.body.textContent).toContain("Visible");
  });
});

// El restore de copy es CONDICIONAL (solo deshace el único string que su
// runtime puede escribir: el valor de data-ol-copied). Este candado protege la
// otra mitad de esa decisión: una edición DELIBERADA del creador al label del
// botón, hecha después del stash, jamás se revierte al guardar. Con un restore
// incondicional (el patrón de countdown) este test se pone rojo.
describe("stripEditorInstrumentation — copy stash condicional", () => {
  it("restaura '¡Copiado!' al label original, pero NUNCA revierte un label que el creador editó", () => {
    const stashed = stashBehaviorsPristineState(
      DOC(
        `<code id="cup">TACOS20</code>` +
          `<button id="b1" data-ol-copy="cup" data-ol-copied="¡Copiado!">Copiar</button>` +
          `<button id="b2" data-ol-copy="cup" data-ol-copied="¡Copiado!">Copiar</button>`,
      ),
    );
    const live = new DOMParser().parseFromString(stashed, "text/html");
    // b1: el creador lo probó — el runtime dejó el texto de confirmación.
    live.getElementById("b1")!.textContent = "¡Copiado!";
    // b2: el creador EDITÓ el label a propósito después del stash.
    live.getElementById("b2")!.textContent = "Copia mi cupón";

    const saved = stripEditorInstrumentation("<!doctype html>\n" + live.documentElement.outerHTML);
    const out = new DOMParser().parseFromString(saved, "text/html");
    expect(out.getElementById("b1")!.textContent).toBe("Copiar");
    expect(out.getElementById("b2")!.textContent).toBe("Copia mi cupón");
    expect(saved).not.toContain("data-openlen-copy-text");
  });
});

// Genérico — ninguna receta nombrada a mano. Si una FUTURA 8ª receta empieza a
// escribir un data-ol-* nuevo sobre el DOM vivo (al estilo filter/sticky/
// lightbox) y el strip no sabe limpiarlo, este test se pone rojo, porque la
// aserción se DERIVA del registro real + un diff antes/después — nunca de una
// lista fija de nombres de receta.
//
// Arreglo 5 (revisión final de rama): extendido para cubrir TAMBIÉN el stash
// de TEXTO (stashBehaviorsPristineState's data-ol-cd / countdown), no solo
// atributos. Antes, un rename de `data-ol-cd` (el selector hijo de countdown,
// hardcodeado a mano en use-behaviors-preview.ts — ver su propio comentario
// "have to be kept in sync BY HAND") podía romper el stash de texto sin que
// NINGÚN test se pusiera rojo: el canary de atributos de abajo no mira
// textContent en absoluto, y el único test que sí lo hace (más arriba, "el
// creador mira su propia página...") usa un fixture escrito a mano
// (REPRO_MARKUP) que no se entera si `countdown.ts` y `use-behaviors-
// preview.ts` divergen entre sí — solo si AMBOS divergen del fixture a la
// vez. Este test, en cambio, deriva su fixture de doc.example (igual que el
// canary de atributos), así que un rename real del selector se refleja aquí
// automáticamente.
//
// Nota de alcance (Arreglo 5 lo pide explícito si no se deriva del todo): NO
// se declaró un contrato `mutates?: { attrs?: string[]; textOf?: string }`
// por receta para derivar el stash/strip en sí (la opción "mejor" que el
// propio Arreglo 5 ofrece) — esta rama existe PORQUE el intento anterior de
// eliminar una duplicación parecida (derivar BEHAVIOR_NAMES/BEHAVIOR_COUNT,
// Arreglo 3 de esta misma revisión) introdujo una regresión nueva. Las
// mutaciones reales no son uniformes: (A) unas se limpian incondicionalmente,
// sin stash (data-ol-hidden, data-ol-stuck, el modal de lightbox); (B) otras
// necesitan una danza stash-antes/restaura-después con formas DISTINTAS entre
// sí (un TOKEN de clase en <html> para theme, una propiedad de estilo en DOS
// selectores para countdown, textContent en un TERCER selector también para
// countdown). Unificar eso seguiría necesitando un intérprete genérico no
// trivial en dos archivos distintos (el stash y el strip) — un rediseño real,
// no una línea nueva en un contrato, y mejor emprendido en su propia sesión
// con su propio plan test-first que como un extra dentro de un lote de 6
// fixes ya grande. El canary extendido de abajo es el mínimo aceptable que sí
// se implementó, y cubre el caso concreto que preocupa (un rename silencioso
// del selector de texto de countdown).
//
// Hueco de cobertura, a propósito: solo ejercita mutaciones alcanzables (a)
// ejecutando el runtime una vez al montar (el tick inmediato de countdown) y
// (b) haciendo click en cada elemento que lleve el MARCADOR PROPIO de una
// conducta (cubre filter/lightbox/theme/copy, cuyo marcador vive sobre el
// elemento clickeable exacto en su propio doc.example — ver cada recipes/*.ts).
// Una receta hipotética cuya mutación dependiera de un SCROLL (sticky) tiene
// su propio test dedicado abajo, con la misma técnica que
// recipes/sticky.test.ts. autoplay no necesita ningún trato especial: su
// única mutación (scrollLeft) ya es inmune por construcción (no se
// serializa) — fake timers alcanzan para que su setInterval no quede como un
// timer real colgado tras el test.
describe("stripEditorInstrumentation — audit canary (protege a la receta #8+)", () => {
  trackDocumentListeners();

  beforeEach(() => {
    document.body.innerHTML = "";
    document.head.innerHTML = "";
  });

  it("ninguna receta deja un data-ol-* NUEVO o un TEXTO mutado (ausentes de su doc.example) vivos tras el strip", () => {
    vi.useFakeTimers();
    try {
      const entries = BEHAVIOR_ORDER.map((n) => BEHAVIORS[n]).filter((b): b is Behavior => !!b);
      const pristineHtml = `<!doctype html><html><head></head><body>${entries.map((b) => b.doc.example).join("")}</body></html>`;
      const attrNames = (html: string) =>
        new Set(
          Array.from(new DOMParser().parseFromString(html, "text/html").querySelectorAll("*"))
            .flatMap((el) => Array.from(el.attributes).map((a) => a.name))
            .filter((name) => name.startsWith("data-ol-")),
        );
      // Texto DIRECTO de cada elemento (sus propios nodos de texto, NUNCA los
      // de sus descendientes) — así el dígito que countdown congela se
      // detecta en el elemento exacto que lo lleva, sin que un ancestro entero
      // tenga que compararse por su textContent agregado (que además cambiaría
      // de longitud cuando lightbox inserta su modal, algo que attrNames ya
      // maneja pero que textContent agregado confundiría con una fuga real).
      const ownTexts = (html: string) =>
        Array.from(new DOMParser().parseFromString(html, "text/html").body.querySelectorAll("*")).map((el) => {
          let t = "";
          for (const n of Array.from(el.childNodes)) if (n.nodeType === 3) t += n.nodeValue;
          return t;
        });
      const pristineAttrs = attrNames(pristineHtml);
      const pristineTexts = ownTexts(pristineHtml);

      mountFullDocument(pristineHtml);
      for (const b of entries) {
        document.querySelectorAll<HTMLElement>(`[${b.marker}]`).forEach((el) => el.click());
      }
      // La foto se toma A PROPÓSITO dentro de la ventana de confirmación de
      // copy (su setTimeout(2000) de swap/restore sigue pendiente): un
      // guardado real puede caer exactamente ahí — el creador prueba su botón
      // y guarda — y eso es lo que este canary existe para cazar. NUNCA
      // adelantar el reloj aquí para "dejar que copy se auto-cure": eso fue
      // exactamente cómo este test estuvo doblado (revisión Fable, 2026-07-13)
      // mientras copy publicaba "¡Copiado!" como texto permanente del botón.

      const dirty = "<!doctype html>\n" + document.documentElement.outerHTML;
      const runtimeIntroduced = [...attrNames(dirty)].filter((name) => !pristineAttrs.has(name));
      const dirtyTexts = ownTexts(dirty);

      // Auto-chequeo: si estas listas salen vacías/sin cambios, el mount/click
      // de arriba dejó de disparar algo y el resto del test no estaría
      // probando nada — más vale un rojo aquí que un verde falso.
      expect(runtimeIntroduced, "el harness no disparó ninguna mutación real de ATRIBUTOS — este test no prueba nada").not.toHaveLength(0);
      expect(runtimeIntroduced).toEqual(expect.arrayContaining(["data-ol-filtered", "data-ol-lb-modal"]));
      expect(dirtyTexts, "el harness no disparó ninguna mutación real de TEXTO — este test no prueba nada").not.toEqual(pristineTexts);

      const saved = stripEditorInstrumentation(dirty);
      // attrNames (DOM real), no saved.includes(attr): filter/lightbox tienen
      // `css`, y el propio runtime lo inyecta en vivo como <style
      // data-ol-behaviors> (con marcador desde el Arreglo 2 de esta misma
      // revisión) — su texto de selector contiene literalmente
      // "[data-ol-hidden]" aunque ningún elemento ya lleve el atributo. Un
      // .toContain() de string confundiría ese CSS inerte con una receta sin
      // cubrir de verdad.
      const savedAttrs = attrNames(saved);
      for (const attr of runtimeIntroduced) {
        expect(
          savedAttrs.has(attr),
          `${attr}: lo introdujo el runtime en vivo y el strip NO lo limpió — receta nueva sin cubrir (ver strip-editor-instrumentation.ts)`,
        ).toBe(false);
      }
      expect(
        ownTexts(saved),
        "un texto que el runtime mutó en vivo sobrevivió al guardado — receta nueva (o renombrada) sin cubrir por el stash/strip de TEXTO (ver stashBehaviorsPristineState en use-behaviors-preview.ts)",
      ).toEqual(pristineTexts);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("stripEditorInstrumentation — sticky's data-ol-stuck (runtime-owned, siempre se limpia)", () => {
  trackDocumentListeners();

  beforeEach(() => {
    document.body.innerHTML = "";
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
  });

  it("un nav con data-ol-stuck (puesto por scroll en el preview) no sobrevive al guardado", () => {
    Object.defineProperty(window, "scrollY", { value: 100, configurable: true });
    mount(`<nav data-ol-sticky class="fixed top-0 w-full"><a href="/">Mi negocio</a></nav>`);
    const nav = document.querySelector("[data-ol-sticky]")!;
    expect(nav.hasAttribute("data-ol-stuck"), "sanity: sticky se aplica de inmediato al montar").toBe(true);

    const dirty = "<!doctype html>\n" + document.documentElement.outerHTML;
    const saved = stripEditorInstrumentation(dirty);
    expect(saved).not.toContain("data-ol-stuck");
  });
});
