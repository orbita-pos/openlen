// Run: npx tsx --require ./scripts/test-node-server-only-shim.cjs --test lib/publish/preview-bake.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bakeModulesForPreviewHtml } from "./preview-bake";
import { buildModuleSection } from "./module-sections";

const HOME = `<!doctype html><html lang="es"><head><title>Mi Negocio</title></head>
<body>
<header><nav><a href="/">Inicio</a></nav></header>
<section><h1>Bienvenido</h1><p>contenido</p></section>
<footer><small>© Mi Negocio</small></footer>
</body></html>`;

const baseCtx = {
  projectId: "p1",
  title: "Mi Negocio",
  sub: null,
  page: null as string | null,
  settings: {} as Record<string, unknown>,
  collectionsItems: null,
};


describe("bakeModulesForPreviewHtml", () => {
  it("leaves the document untouched when no module is enabled", () => {
    const out = bakeModulesForPreviewHtml(HOME, { ...baseCtx });
    assert.equal(out, HOME);
  });

  it("bakes the chat widget when chat is on", () => {
    const out = bakeModulesForPreviewHtml(HOME, {
      ...baseCtx,
      settings: { chat: { enabled: true } },
    });
    assert.ok(out.includes("data-ol-chat"), "chat markup present");
  });



  it("bakes the assistant widget when the assistant is on", () => {
    const out = bakeModulesForPreviewHtml(HOME, {
      ...baseCtx,
      settings: { assistant: { enabled: true } },
    });
    assert.ok(out.includes("data-openlen-assistant"), "assistant markup present");
  });

  // INVERTIDA el 2026-08-29. Fijaba que la vista previa pintara los items del
  // catálogo en su placeholder. El horneado se fue con el módulo: un catálogo
  // es ahora un almacén de `lectura`, y sus filas las mete `horneaLectura` en
  // el publicador — la vista previa las verá cuando ese horneado se cablee
  // también aquí, no antes.
  it("ya no pinta items de catálogo: ese horneado se retiró", () => {
    const withPlaceholder = HOME.replace(
      "<footer",
      '<div data-ol-collection-section></div><footer',
    );
    const out = bakeModulesForPreviewHtml(withPlaceholder, { ...baseCtx });
    assert.ok(!out.includes("Producto Uno"), "no debe pintar items");
  });
});

describe("preview mirrors publish's FAB stacking", () => {
  it("lifts an unmergeable chat one slot above the assistant", () => {
    const out = bakeModulesForPreviewHtml(HOME, {
      ...baseCtx,
      settings: {
        assistant: { enabled: true },
        chat: { enabled: true, mount: "fab", identityMode: "account" },
      },
    });
    assert.ok(out.includes('"bottom":86'), "chat above the assistant");
  });

  // RETIRADA el 2026-08-26 con los horneados de vídeo y mapas. Existían para
  // devolver el `<iframe>` que el saneador acababa de quitar; ahora el modelo
  // escribe el embebido y nadie se lo borra.

  // RETIRADA el 2026-08-26 con los horneados de vídeo y mapas. Existían para
  // devolver el `<iframe>` que el saneador acababa de quitar; ahora el modelo
  // escribe el embebido y nadie se lo borra.

  it("un documento sin módulos sale intacto", () => {
    assert.equal(bakeModulesForPreviewHtml(HOME, { ...baseCtx }), HOME);
  });
});

// ⚰️ AQUÍ VIVÍAN CUATRO PRUEBAS DE LA BANDA «MIS PLATAFORMAS», y las cuatro
// medían un camino que ya no se puede recorrer.
//
// La banda se llenaba con los enlaces del PERFIL DE NEGOCIO, retirado el
// 2026-08-31. Desde entonces `previewBakeForProject` fija `platforms = null`
// (`preview-bake.ts`) y NADIE pasa otra cosa en todo el repo — el parámetro
// sigue en la firma, señalado como fontanería muerta.
//
// Una salió ROJA (pedía el href de Twitch dentro de la banda) y las otras TRES
// SEGUÍAN VERDES, que es lo peor de las dos cosas: comprobaban que el marcador
// NO estuviera, y eso hoy es cierto POR VACÍO. Verde sin medir nada.
//
// Queda una, que es la que sí dice algo: el camino está cerrado. Y ya ni
// siquiera se puede PEDIR — `platforms` salió de `PreviewBakeCtx` cuando cayó
// la tabla del perfil (paso 5, 2026-08-31), así que pasarlo no compila.
describe("la banda «Mis plataformas» ya no se hornea", () => {
  it("un documento con la banda estampada sale sin marcador de plataformas", () => {
    const BAND = buildModuleSection("chat", { lang: "es" });
    const DOC = HOME.replace("<footer", `${BAND}<footer`);
    const out = bakeModulesForPreviewHtml(DOC, { ...baseCtx });
    assert.ok(!out.includes("data-ol-platforms-section"), "no hay banda que llenar");
    assert.ok(out.includes("<h1>Bienvenido</h1>"), "el resto de la página intacto");
  });
});
