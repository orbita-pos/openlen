// Run via: npx tsx --test lib/ai/librerias-acuerdo.test.ts
// (node:test, no vitest: el oráculo es el sanitizador REAL, que entra por el
// binding nativo y vite no sabe cargar.)
//
// LA INVARIANTE, en una frase: **lo que el prompt OFRECE, la puerta tiene que
// dejarlo pasar y la cabecera tiene que aceptarlo.**
//
// Tres listas deciden si una página puede usar Chart.js, y no se hablan:
//
//   1. LA PUERTA — `crates/html-engine/src/sanitize/scripts.rs`. ¿Sobrevive la
//      etiqueta al publicar? Está en Rust, o sea que su copia del host es
//      forzosamente aparte de la de TypeScript.
//   2. LA CABECERA — `nodoDeCabezaPermitido` en `lib/ai-stream/document-ops.ts`.
//      ¿Puede el modelo AÑADIRLA a una página que no nació con ella?
//   3. EL PROMPT — `bloqueDeLibrerias()` en `lib/librerias.ts`, en las cinco
//      superficies. Que las otras dos estén abiertas no sirve de nada si el
//      modelo no sabe que existen.
//
// Cada desacuerdo tiene su propio síntoma, y ninguno se ve en verde:
//
//   · prompt SÍ / puerta NO  → el modelo escribe la etiqueta, el saneador la
//     borra, y la página se publica con la gráfica muerta. Es exactamente lo
//     que pasaba con las conductas antes de retirarlas.
//   · prompt SÍ / cabecera NO → funciona al CREAR y falla al EDITAR. Len dice
//     «te he añadido la gráfica», la op se rechaza con `no_permitido`, y la
//     página se queda como estaba.
//   · puerta SÍ / prompt NO  → la capacidad existe y nadie la usa nunca.

import { test } from "node:test";
import { strict as assert } from "node:assert";

import { sanitizeForPublish } from "../html-engine";
import { HEAD_OP_TARGET, splitDocumentOps } from "../ai-stream/document-ops";
import {
  LIBRERIAS,
  LIBRERIAS_HOST,
  ORIGEN_MANDA_CORS,
  bloqueDeLibrerias,
  esUrlDeLibreria,
} from "../librerias";

/** ¿Sobrevive el `<script>` de este documento al saneador REAL? */
function sobreviveAlPublicar(html: string): boolean {
  const r = sanitizeForPublish(html);
  assert.notEqual(r.html, null, "el documento no debía ser rechazado entero");
  return /<script\b/i.test(r.html as string);
}

/** ¿Acepta la cabecera este fragmento por la ruta REAL (no `applyHeadOp` a pelo)? */
function laCabeceraAcepta(fragmento: string): boolean {
  const r = splitDocumentOps([
    { target: HEAD_OP_TARGET, type: "insert_after", newHtml: fragmento } as never,
  ]);
  return r.head.kind === "nodos";
}

const doc = (cuerpo: string) =>
  `<!doctype html><html><head>${cuerpo}</head><body><p>x</p></body></html>`;

test("hay catálogo, y no está vacío", () => {
  assert.ok(LIBRERIAS.length > 0, "sin librerías no hay nada que acordar");
});

test("lo que el prompt ofrece, la puerta lo deja pasar", () => {
  const bloque = bloqueDeLibrerias();
  for (const l of LIBRERIAS) {
    for (const sc of l.scripts) {
      assert.ok(bloque.includes(sc.url), `${l.nombre}: el prompt no nombra ${sc.url}`);
      assert.equal(
        sobreviveAlPublicar(doc(`<script src="${sc.url}"></script>`)),
        true,
        `${l.nombre}: el prompt lo ofrece y el saneador lo borra — la página nacería con la función muerta`,
      );
    }
  }
});

test("lo que el prompt ofrece, la cabecera lo acepta", () => {
  for (const l of LIBRERIAS) {
    for (const sc of l.scripts) {
      // CON los atributos a propósito, aunque hoy el prompt no los reparta: hay
      // páginas ya escritas que los llevan, y la cabecera tiene que seguir
      // aceptándolas para que Len pueda editarlas.
      const etiqueta = `<script src="${sc.url}" integrity="${sc.sri}" crossorigin="anonymous"></script>`;
      assert.equal(
        laCabeceraAcepta(etiqueta),
        true,
        `${l.nombre}: Len no puede añadirla a una página que no nació con ella`,
      );
    }
    if (l.css !== null) {
      const hoja = `<link rel="stylesheet" href="${l.css}" integrity="${l.cssSri}" crossorigin="anonymous">`;
      assert.ok(bloqueDeLibrerias().includes(l.css), `${l.nombre}: el prompt no nombra su CSS`);
      assert.equal(laCabeceraAcepta(hoja), true, `${l.nombre}: su hoja no entra en la cabecera`);
    }
  }
});

// ─── LA CUARTA LISTA: EL ORIGEN ─────────────────────────────────────────────
//
// Las tres de arriba contestan todas a la misma pregunta: «¿sobrevive la
// etiqueta?». NINGUNA contesta a «¿la ejecuta un navegador?». El 2026-09-04 la
// respuesta era NO para las tres librerías, en toda página publicada y en el
// render que las mide, con las tres listas en verde y de acuerdo entre sí.
//
// La causa: `libs.openlen.com` no manda `Access-Control-Allow-Origin`, y tanto
// `integrity` (el SRI sobre un origen ajeno EXIGE CORS) como
// `crossorigin="anonymous"` convierten la petición en CORS. Medido en un
// navegador real desde `https://example.com`: con los atributos NO carga
// (`typeof Chart === "undefined"`), sin ellos SÍ (`"function"`). Aguas abajo,
// crear tiraba la página del usuario y la reescribía entera para nada, porque
// ningún reparador puede arreglar una cabecera que no es suya.
//
// `librerias:subir` tampoco lo veía: comprueba la ruta con `fetch` desde Node,
// que no tiene origen y por tanto no hace CORS NUNCA.
//
// Esta prueba no toca la red — de la red se ocupa `npm run librerias:comprobar`.
// Lo que sujeta es la COHERENCIA entre el prompt y lo que el origen sabe hacer.
test("el prompt no reparte atributos que EXIJAN CORS si el origen no lo manda", () => {
  const bloque = bloqueDeLibrerias();
  if (ORIGEN_MANDA_CORS) {
    // Con CORS puesto, el SRI vuelve — y tiene que llegar al modelo.
    for (const l of LIBRERIAS) {
      for (const sc of l.scripts) {
        assert.ok(bloque.includes(sc.sri), `${l.nombre}: el prompt no da el SRI de ${sc.url}`);
      }
      if (l.cssSri !== null) {
        assert.ok(bloque.includes(l.cssSri), `${l.nombre}: el prompt no da el SRI de su hoja`);
      }
    }
    return;
  }
  // La forma de ATRIBUTO (`x="`), no la palabra suelta: la regla del propio
  // bloque los nombra para prohibirlos, y eso tiene que seguir permitido.
  for (const atributo of ['integrity="', 'crossorigin="']) {
    assert.equal(
      bloque.includes(atributo),
      false,
      `el prompt reparte ${atributo} y el origen no manda CORS: la librería nace BLOQUEADA`,
    );
  }
  // Y ninguna etiqueta del bloque puede llevarlos, se escriban como se escriban.
  for (const linea of bloque.split("\n")) {
    if (!/^\s*(Script|CSS):/.test(linea)) continue;
    assert.match(
      linea,
      /^\s*(Script|CSS):\s+<(script src|link rel="stylesheet" href)="[^"]+"\s*>(<\/script>)?$/,
      `etiqueta con atributos de más: ${linea.trim()}`,
    );
  }
});

test("el script y su hoja pueden entrar en la MISMA op", () => {
  // Es como el modelo las va a mandar, y era el caso que el partidor rompía.
  const swiper = LIBRERIAS.find((l) => l.css !== null);
  assert.ok(swiper, "el catálogo ya no tiene ninguna librería con CSS — actualiza esta prueba");
  const tanda =
    `<link rel="stylesheet" href="${swiper.css}" integrity="${swiper.cssSri}" crossorigin="anonymous">` +
    `<script src="${swiper.scripts[0].url}" integrity="${swiper.scripts[0].sri}" crossorigin="anonymous"></script>`;
  assert.equal(laCabeceraAcepta(tanda), true);
});

test("un <script> con CUERPO no entra por la cabecera", () => {
  // El código tiene su propia puerta (`target="runtime"`). Una segunda vía con
  // otras reglas es como se abren los agujeros.
  const conCuerpo = `<script src="https://${LIBRERIAS_HOST}/chart.js/4.5.0/chart.umd.min.js">alert(1)</script>`;
  assert.equal(laCabeceraAcepta(conCuerpo), false);
  assert.equal(laCabeceraAcepta(`<script>alert(1)</script>`), false);
});

test("ningún otro CDN entra por ninguna de las dos", () => {
  const ajenos = [
    "https://cdn.jsdelivr.net/npm/chart.js@4.5.0/dist/chart.umd.min.js",
    "https://unpkg.com/swiper@12/swiper-bundle.min.js",
    "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.5.0/chart.umd.min.js",
    // Nuestros, pero los llena el USUARIO: no son un origen de código.
    "https://uploads.openlen.com/x.js",
    "https://templates.openlen.com/x.js",
  ];
  for (const src of ajenos) {
    assert.equal(esUrlDeLibreria(src), false, `${src} no es una librería nuestra`);
    assert.equal(
      laCabeceraAcepta(`<script src="${src}"></script>`),
      false,
      `${src}: la cabecera no puede aceptarlo`,
    );
    assert.equal(
      sobreviveAlPublicar(doc(`<script src="${src}"></script>`)),
      false,
      `${src}: el saneador no puede dejarlo pasar`,
    );
  }
});

test("el <title> vuelve a pasar por la ruta real", () => {
  // No es una librería: es el defecto que salió al abrir esta puerta. El
  // partidor cortaba por CUALQUIER `>`, así que `<title>Hola</title>` llegaba
  // al validador en dos mitades y las dos fallaban. El encabezado de
  // document-ops.ts lleva desde el 2026-08-22 diciendo que el <title> se
  // acepta, y por la ruta real no se aceptó nunca.
  assert.equal(laCabeceraAcepta(`<title>Clínica Ríos</title>`), true);
  assert.equal(laCabeceraAcepta(`<title></title>`), true);
});

test("y el texto suelto sigue tumbando la tanda entera", () => {
  // El partidor nuevo salta de `<` en `<`; si tirara el texto de en medio,
  // aceptaría en silencio una tanda que el modelo escribió con algo más dentro.
  assert.equal(laCabeceraAcepta(`<title>Hola</title> y además esto`), false);
  assert.equal(laCabeceraAcepta(`basura<title>Hola</title>`), false);
});
