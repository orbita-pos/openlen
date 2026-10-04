// Unit tests for the single save-path funnel (Phase 8.1, added during the
// Editor V5 adversarial-review pass). Locks the V5-marker fix: the backstop
// must remove the overlay, UNWRAP run-wrappers (preserving text), and strip
// the editable/edit-hidden/edit-noedit attrs — so a save from ANY co-injected
// editor surface (props/reorder/replace/insert) never ships them to the
// published page. jsdom provides DOMParser.

import { describe, it, expect } from "vitest";
import { stripEditorInstrumentation } from "./strip-editor-instrumentation";

// ⚰️ SE FUERON el 2026-08-31 CUATRO BLOQUES (~430 líneas): el del carrusel de
// preview, el «CRITICAL: preview mutations must not reach the saved document»
// con su `mountFullDocument`, el del stash condicional de copy y el canario de
// auditoría. Los cuatro probaban el inyector del taller
// (`use-behaviors-preview.ts`) y su danza de stash/restore — y ese inyector se
// borró con ellos, porque horneaba conductas y carrusel que la página
// publicada ya no tiene desde el 2026-08-26.
//
// ⚰️ Y EL 2026-10-04, LO QUE QUEDABA DE ELLOS: los scripts horneados de las
// conductas, el `data-ol-stuck` del sticky y los restos de la animación. El
// limpiador ya no los quita porque nada los produce (ver la lápida en
// strip-editor-instrumentation.ts), y las conductas se borraron ese día.

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

  it("PRESERVES the curated font-pair link (data-ol-fonts, Task 13)", () => {
    // Same model as temáticas' font link: applyFonts() (use-element-inspect.ts)
    // stamps <link data-ol-fonts> IN the document by design — the backstop
    // must never confuse it with editor chrome and strip it.
    const out = stripEditorInstrumentation(
      `<!doctype html><html style="--ol-font-display:&quot;Playfair Display&quot;, Georgia, serif"><head>` +
        `<link rel="stylesheet" data-ol-fonts href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@500;700&family=Source+Sans+3:wght@400;600&display=swap">` +
        `</head><body data-openlen-edit-mode><h1 data-openlen-editable>Hero</h1></body></html>`,
    );
    expect(out).toContain('<link rel="stylesheet" data-ol-fonts');
    expect(out).toContain("fonts.googleapis.com");
    expect(out).toContain("--ol-font-display");
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


// CRITICAL (revisión final de rama) — data-ol-hidden NO es un marker
// runtime-owned de NINGUNA receta: es el atributo de use-element-inspect.ts's
// applyHide(), la acción deliberada del creador "Ocultar elemento" (toggle en
// properties-panel.tsx), persistida a propósito en el HTML guardado — ver su
// propio ensureHiddenStyle() ahí, que inyecta la regla CSS persistente
// `body:not([data-openlen-edit-mode]) [data-ol-hidden]{display:none!important}`.
// filter.ts solía reclamar ESE MISMO nombre para su propio estado de runtime
// (luego `data-ol-filtered`; las conductas se retiraron el 2026-10-04) y la lista
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


describe("stripEditorInstrumentation — data-ol-was (stash de originales del inspector)", () => {
  it("preserva data-ol-was — la memoria de originales del inspector es estado del documento, no instrumentación", () => {
    const html =
      "<!doctype html>\n<html><head></head><body>" +
      '<section data-ol-was="{&quot;color&quot;:&quot;&quot;}" style="color:red" data-openlen-inspect-hover><p>Hola</p></section>' +
      "</body></html>";
    const out = stripEditorInstrumentation(html);
    expect(out).toContain("data-ol-was=");
    expect(out).not.toContain("data-openlen-inspect-hover");
  });
});
