// Run: npx tsx --require ./scripts/test-node-server-only-shim.cjs --test lib/publish/strip-disabled-bands.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { stripDisabledModuleBands } from "./strip-disabled-bands";
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

  it("sin marcadores → documento intacto (byte-idéntico)", () => {
    const html = DOC("<section><p>nada de módulos</p></section>");
    assert.equal(
      stripDisabledModuleBands(html, { bookings: false, collections: false, comments: false, chat: false }),
      html,
    );
  });
});

// El bug que esto cierra: la banda se detectaba por la huella de su `style`
// inline, y el DOM del iframe del editor la re-serializa CON espacios
// (`margin: 64px auto`, `0` → `0px`). Tras el primer guardado la huella dejaba
// de casar y la página publicada se quedaba con el encabezado huérfano. Medido
// en navegador; afectaba a bookings/collections/comments/chat en producción.
describe("la banda estampada se detecta tras pasar por el DOM del editor", () => {
  const OFF = { bookings: false, collections: false, comments: false, chat: false };

  const asSavedByTheEditor = (marker: string) =>
    `<section data-ol-module-band style="max-width: 900px; margin: 64px auto; padding: 0px 24px; box-sizing: border-box;">` +
    `<div style="text-align: center;"><p>Reservas</p><h2>Agenda una cita</h2><p>Elige el día.</p></div>` +
    `<div ${marker}></div></section>`;

  it("borra la banda ENTERA con el estilo normalizado por el DOM", () => {
    const out = stripDisabledModuleBands(DOC(asSavedByTheEditor("data-ol-bookings-section")), OFF);
    assert.ok(!out.includes("data-ol-bookings-section"), "marcador fuera");
    assert.ok(!out.includes("Agenda una cita"), "encabezado fuera — era el huérfano");
    assert.ok(!out.includes("data-ol-module-band"), "envoltorio fuera");
    assert.ok(out.includes("Hola"), "el resto del documento sobrevive");
  });

  it("buildModuleSection estampa el envoltorio, y también se borra entero", () => {
    const html = DOC(buildModuleSection("collections", { lang: "es" }));
    assert.ok(html.includes("data-ol-module-band"), "estampa presente al emitir");
    assert.ok(!stripDisabledModuleBands(html, OFF).includes("Lo que ofrecemos"), "encabezado fuera");
  });

  // Respaldo: las bandas insertadas ANTES de que se estampara siguen
  // dependiendo de la huella de estilo. Comportamiento IDÉNTICO al de hoy —
  // este arreglo no lo ensancha, para no arriesgar borrar secciones del user.
  it("banda vieja sin estampa, estilo compacto: se sigue borrando entera", () => {
    const legacy =
      `<section style="max-width:720px;margin:64px auto;padding:0 24px;box-sizing:border-box;">` +
      `<h2>Lo que opina la gente</h2><div data-ol-comments-section></div></section>`;
    assert.ok(!stripDisabledModuleBands(DOC(legacy), OFF).includes("Lo que opina la gente"));
  });

  it("banda vieja sin estampa YA normalizada: solo el marcador (limitación conocida)", () => {
    const legacy =
      `<section style="max-width: 720px; margin: 64px auto;">` +
      `<h2>Lo que opina la gente</h2><div data-ol-comments-section></div></section>`;
    const out = stripDisabledModuleBands(DOC(legacy), OFF);
    assert.ok(!out.includes("data-ol-comments-section"), "el marcador sí se va");
    assert.ok(out.includes("Lo que opina la gente"), "el encabezado queda — estado de hoy, no una regresión");
  });

  // El riesgo caro es el inverso: tragarse una sección que escribió el user.
  it("NO se traga una sección del usuario que casualmente comparte el estilo", () => {
    const suya =
      `<section style="max-width: 900px; margin: 64px auto; box-sizing: border-box;">` +
      `<h2>Mi taller</h2><p>Texto que escribí yo</p><div data-ol-chat-section></div></section>`;
    const out = stripDisabledModuleBands(DOC(suya), OFF);
    assert.ok(!out.includes("data-ol-chat-section"), "el marcador se va");
    assert.ok(out.includes("Texto que escribí yo"), "mi contenido NO se borra");
  });
});
