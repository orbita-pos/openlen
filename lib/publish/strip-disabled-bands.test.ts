// Run: npx tsx --require ./scripts/test-node-server-only-shim.cjs --test lib/publish/strip-disabled-bands.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { stripBandByMarker, stripDisabledModuleBands } from "./strip-disabled-bands";
import { buildModuleSection } from "./module-sections";

const DOC = (inner: string) =>
  `<!doctype html><html lang="es"><head><title>x</title></head><body>
<header><nav><a href="/">Inicio</a></nav></header>
<section id="hero"><h1>Hola</h1></section>
${inner}
<footer><small>© X</small></footer>
</body></html>`;

describe("stripDisabledModuleBands", () => {
  it("removes a designed band (heading INCLUDED) when its module is off", () => {
    const html = DOC(buildModuleSection("bookings", { lang: "es" }));
    const out = stripDisabledModuleBands(html, { bookings: false, collections: false, comments: false, chat: false });
    assert.ok(!out.includes("data-ol-bookings-section"), "marker gone");
    assert.ok(!out.includes("Agenda una cita"), "band heading gone too");
    assert.ok(out.includes("Hola") && out.includes("© X"), "page content intact");
  });

  it("keeps the band when the module is ON", () => {
    const html = DOC(buildModuleSection("collections", { lang: "es" }));
    const out = stripDisabledModuleBands(html, { bookings: false, collections: true, comments: false, chat: false });
    assert.ok(out.includes("data-ol-collection-section"));
    assert.ok(out.includes("Lo que ofrecemos"));
  });

  it("removes a legacy dashed section (marker on the section itself)", () => {
    const html = DOC(
      '<section data-ol-collection-section style="border:1px dashed #c9c9d0;">Colección — tus elementos aparecen aquí al publicar</section>',
    );
    const out = stripDisabledModuleBands(html, { bookings: false, collections: false, comments: false, chat: false });
    assert.ok(!out.includes("data-ol-collection-section"));
    assert.ok(!out.includes("tus elementos aparecen"));
  });

  it("inside a CUSTOM section (AI-authored), removes only the marker element — sibling content survives", () => {
    const html = DOC(
      '<section class="mi-seccion"><h2>Reserva conmigo</h2><p>texto del usuario</p><div data-ol-bookings-section></div></section>',
    );
    const out = stripDisabledModuleBands(html, { bookings: false, collections: false, comments: false, chat: false });
    assert.ok(!out.includes("data-ol-bookings-section"), "marker gone");
    assert.ok(out.includes("Reserva conmigo") && out.includes("texto del usuario"), "user content survives");
  });

  it("handles several disabled bands in one pass and leaves enabled ones", () => {
    const html = DOC(
      buildModuleSection("bookings", { lang: "es" }) +
        buildModuleSection("comments", { lang: "es" }) +
        buildModuleSection("collections", { lang: "es" }),
    );
    const out = stripDisabledModuleBands(html, { bookings: false, collections: true, comments: false, chat: false });
    assert.ok(!out.includes("data-ol-bookings-section"));
    assert.ok(!out.includes("data-ol-comments-section"));
    assert.ok(out.includes("data-ol-collection-section"));
  });

  it("a band with USER content nested after the marker is removed WHOLE — no orphan closers", () => {
    // Chat-tab AI rewrites can nest content inside a band; the documented rule
    // is "customized band → removed whole", never a partial cut + stray tag.
    const band =
      '<section style="max-width:720px;margin:64px auto;padding:0 24px;box-sizing:border-box;">' +
      '<div data-ol-bookings-section></div>' +
      "<section><h2>USER STUFF</h2></section>" +
      "</section>";
    const html = DOC(band + "<p>after</p>");
    const out = stripDisabledModuleBands(html, { bookings: false, collections: false, comments: false, chat: false });
    assert.ok(!out.includes("data-ol-bookings-section"));
    assert.ok(!out.includes("USER STUFF"), "customized band removed whole (documented rule)");
    assert.ok(out.includes("<p>after</p>"), "content after the band survives");
    const opens = out.split("<section").length - 1;
    const closes = out.split("</section>").length - 1;
    assert.equal(opens, closes, "no orphan </section>");
  });

  it("a marker div with nested divs is removed completely — tail survives", () => {
    const html = DOC(
      '<section class="user"><div data-ol-bookings-section><div>guts</div></div><p>tail</p></section>',
    );
    const out = stripDisabledModuleBands(html, { bookings: false, collections: false, comments: false, chat: false });
    assert.ok(!out.includes("data-ol-bookings-section"));
    assert.ok(!out.includes("guts"), "nested guts removed with the marker element");
    assert.ok(out.includes("<p>tail</p>"), "tail sibling survives");
  });

  it("adversarial input (thousands of band-opener prefixes) stays fast — linear, not quadratic", () => {
    const junk = '<section style="max-width:1px;margin:64px auto;">x'.repeat(4000);
    const html = DOC(junk + '<div data-ol-bookings-section></div>');
    const t0 = performance.now();
    stripDisabledModuleBands(html, { bookings: false, collections: false, comments: false, chat: false });
    const ms = performance.now() - t0;
    assert.ok(ms < 1000, `tardó ${Math.round(ms)}ms — huele a O(n²)`);
  });

  it("el marcador dentro del valor de OTRO atributo no borra nada (gate de hasAttr)", () => {
    // La única función de esta rama que cambia el comportamiento de módulos
    // VIVOS al publicar: sin el tokenizador, el `indexOf` crudo tomaba el texto
    // del marcador dentro de un title/alt/data-* ajeno como si fuera la banda y
    // se llevaba por delante contenido del usuario.
    const html = DOC('<div title="ver data-ol-bookings-section docs">contenido</div>');
    const out = stripDisabledModuleBands(html, { bookings: false, collections: false, comments: false, chat: false });
    assert.equal(out, html, "documento intacto — no era una banda");
  });

  it("banda real + falso positivo en el mismo documento: se va solo la banda", () => {
    const html = DOC(
      '<div data-nota="lee data-ol-comments-section en los docs">glosario</div>' +
        buildModuleSection("comments", { lang: "es" }),
    );
    const out = stripDisabledModuleBands(html, { bookings: false, collections: false, comments: false, chat: false });
    assert.ok(!out.includes("Lo que opina la gente"), "la banda real se fue");
    assert.ok(out.includes("glosario"), "el falso positivo sobrevive");
    assert.ok(
      out.includes('data-nota="lee data-ol-comments-section en los docs"'),
      "el atributo ajeno queda intacto",
    );
  });

  it("no markers → document untouched (byte-identical)", () => {
    const html = DOC("<section><p>nada de módulos</p></section>");
    assert.equal(
      stripDisabledModuleBands(html, { bookings: false, collections: false, comments: false, chat: false }),
      html,
    );
  });
});

// El `style` que emite band() sobrevive intacto solo mientras nadie toque la
// sección desde el DOM. En cuanto la banda pasa por el iframe del editor, el
// CSSOM re-serializa el atributo con un espacio tras cada ":" y ";" — y la
// comparación byte a byte de la huella fallaba en silencio, degradando el
// borrado a "solo el marcador" y dejando el encabezado huérfano sobre un hueco
// en la página PUBLICADA (verificado en navegador: task-11-browser-report-2).
describe("huella de la banda: forma emitida vs forma normalizada por el DOM", () => {
  /** Tag de apertura EXACTO con el que vuelve la banda tras pasar por el DOM —
   *  copiado del HTML real de la verificación en navegador
   *  (.superpowers/sdd/2026-08-02-mis-plataformas/task-11-browser-evidence-2/
   *  G1-4-data-html-tras-guardar.html y G3-2-html-publicado-RAW.html). Nótese
   *  `0 24px` → `0px 24px`: no es solo cuestión de espacios. */
  const domOpenTag = (maxWidth: number) =>
    `<section style="max-width: ${maxWidth}px; margin: 64px auto; padding: 0px 24px; box-sizing: border-box;">`;

  /** La banda tal cual la guarda el editor: el cuerpo se re-serializa literal
   *  (innerHTML conserva los bytes de los atributos), pero el tag de apertura
   *  de la sección — la única cuyo `style` se tocó vía CSSOM — vuelve normalizado,
   *  y los atributos booleanos vuelven con `=""`. */
  const asSavedByTheEditor = (module: "bookings" | "collections", maxWidth: number) => {
    const emitted = buildModuleSection(module, { lang: "es" });
    return (
      domOpenTag(maxWidth) +
      emitted.slice(emitted.indexOf(">") + 1).replace("-section></div>", '-section=""></div>')
    );
  };

  // Banda de plataformas COPIADA literal del data.html real del proyecto de
  // prueba (611 bytes). Plataformas no vive en MARKERS: su strip entra por
  // fillPlatformsBand → stripBandByMarker, así que se prueba por ahí.
  const PLATFORMS_BAND_FROM_BROWSER =
    '<section style="max-width: 900px; margin: 64px auto; padding: 0px 24px; box-sizing: border-box;">' +
    '<div style="text-align:center;max-width:620px;margin:0 auto 32px;">' +
    '<p style="margin:0 0 10px;font-size:13px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--ol-accent,#FF5A36);">Plataformas</p>' +
    '<h2 style="margin:0 0 12px;font-size:clamp(26px,4vw,40px);font-weight:800;letter-spacing:-.02em;line-height:1.12;color:inherit;">Encuéntrame en</h2>' +
    '<p style="margin:0;font-size:16px;line-height:1.6;opacity:.68;">Sígueme donde prefieras.</p>' +
    "</div>" +
    '<div data-ol-platforms-section=""></div></section>';

  it("plataformas, forma EMITIDA (compacta): se va la banda entera", () => {
    const html = DOC(buildModuleSection("platforms", { lang: "es" }));
    const out = stripBandByMarker(html, "data-ol-platforms-section");
    assert.ok(!out.includes("data-ol-platforms-section"), "marcador fuera");
    assert.ok(!out.includes("Encuéntrame en"), "encabezado fuera — nada de huérfanos");
    assert.ok(!out.includes("Plataformas"), "eyebrow fuera");
    assert.ok(out.includes("Hola") && out.includes("© X"), "el resto de la página intacto");
  });

  it("plataformas, forma NORMALIZADA por el DOM (la del navegador): se va la banda entera", () => {
    const html = DOC(PLATFORMS_BAND_FROM_BROWSER);
    const out = stripBandByMarker(html, "data-ol-platforms-section");
    assert.ok(!out.includes("data-ol-platforms-section"), "marcador fuera");
    assert.ok(!out.includes("Encuéntrame en"), "el encabezado huérfano del bug ya no sobrevive");
    assert.ok(!out.includes("Sígueme donde prefieras"), "el copy también se va");
    assert.ok(out.includes("Hola") && out.includes("© X"), "el resto de la página intacto");
    const opens = out.split("<section").length - 1;
    assert.equal(opens, out.split("</section>").length - 1, "sin </section> huérfano");
  });

  it("bookings normalizado por el DOM: la banda entera se va al publicar con el módulo apagado", () => {
    const html = DOC(asSavedByTheEditor("bookings", 720));
    const out = stripDisabledModuleBands(html, { bookings: false, collections: false, comments: false, chat: false });
    assert.ok(!out.includes("data-ol-bookings-section"), "marcador fuera");
    assert.ok(!out.includes("Agenda una cita"), "encabezado fuera");
    assert.ok(out.includes("Hola") && out.includes("© X"), "el resto de la página intacto");
  });

  it("collections normalizado por el DOM: idem, y una banda ENCENDIDA no se toca", () => {
    const html = DOC(asSavedByTheEditor("collections", 1100));
    const off = stripDisabledModuleBands(html, { bookings: false, collections: false, comments: false, chat: false });
    assert.ok(!off.includes("data-ol-collection-section"));
    assert.ok(!off.includes("Lo que ofrecemos"), "encabezado fuera");
    const on = stripDisabledModuleBands(html, { bookings: false, collections: true, comments: false, chat: false });
    assert.equal(on, html, "módulo encendido → documento intacto");
  });

  it("NO borra de más: una <section> del usuario con max-width propio solo pierde el marcador", () => {
    // Mismo formato normalizado por el DOM, pero NO es band(): el margin no es
    // el de la banda. La huella debe fallar y el corte quedarse en el marcador.
    const user =
      '<section style="max-width: 1200px; margin: 0 auto; padding: 0px 24px;">' +
      "<h2>Mi sección a mano</h2><p>texto del usuario</p>" +
      '<div data-ol-bookings-section=""></div></section>';
    const html = DOC(user);
    const out = stripDisabledModuleBands(html, { bookings: false, collections: false, comments: false, chat: false });
    assert.ok(!out.includes("data-ol-bookings-section"), "el marcador sí se va");
    assert.ok(out.includes("Mi sección a mano"), "el encabezado del usuario SOBREVIVE");
    assert.ok(out.includes("texto del usuario"), "el copy del usuario SOBREVIVE");
    assert.ok(out.includes('style="max-width: 1200px'), "su <section> sigue en pie");
  });

  it("el atributo `style` ya no tiene que ser el primero del tag", () => {
    // El editor le cuelga atributos a la sección (id/clase/data-ol-*); el
    // ancla vieja exigía `<section style="max-width:` pegado.
    const band =
      '<section id="plataformas" class="ol-band" style="max-width: 900px; margin: 64px auto; padding: 0px 24px;">' +
      "<h2>Encuéntrame en</h2>" +
      '<div data-ol-comments-section=""></div></section>';
    const out = stripDisabledModuleBands(DOC(band), {
      bookings: false, collections: false, comments: false, chat: false,
    });
    assert.ok(!out.includes("data-ol-comments-section"));
    assert.ok(!out.includes("Encuéntrame en"), "banda entera fuera");
  });

  it("input adversario en forma NORMALIZADA sigue siendo lineal", () => {
    const junk = domOpenTag(1).repeat(4000);
    const html = DOC(junk + '<div data-ol-bookings-section=""></div>');
    const t0 = performance.now();
    stripDisabledModuleBands(html, { bookings: false, collections: false, comments: false, chat: false });
    const ms = performance.now() - t0;
    assert.ok(ms < 1000, `tardó ${Math.round(ms)}ms — huele a O(n²)`);
  });
});
