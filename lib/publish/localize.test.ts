// Run: npx tsx --test lib/publish/localize.test.ts   (suite test:node)
//
// node:test, no vitest: localize.ts importa @/lib/html-engine (el binding
// nativo de Rust), que el entorno jsdom de vite no puede cargar.
//
// ESTE FICHERO NACE EL 2026-08-28, DESPUÉS DE QUE LA FEATURE SE MIDIERA ROTA.
//
// `Speak Every Language` traduce la página al publicar. Nunca había traducido
// una sola página en producción —0 filas en projectTranslations sobre 41
// páginas publicadas— y al probarla de verdad devolvía 0 de 3 idiomas.
//
// LA CAUSA: el contrato de SALIDA lo daba `responseSchema` (TRANSLATIONS_SCHEMA)
// cuando esto corría por Gemini. Al pasar a Fireworks el esquema se descarta a
// propósito —lo rechaza, está medido— y nadie lo sustituyó: quedó `jsonObject:
// true` y un prompt que pide «EXACTLY N translations» sin decir nunca DENTRO DE
// QUÉ. Medido contra la API real, el modelo devolvía:
//
//     {"type": "object"}
//
// Un trozo de esquema. En modo JSON sin forma declarada no sabe qué producir.
//
// POR QUÉ SOBREVIVIÓ TANTO: este fichero no existía, y el fallo es SILENCIOSO —
// `localizeForPublish` cae blando por idioma y `publishToDir` publica la raíz
// igual. El dueño pide 3 idiomas, la publicación dice que fue bien, y no hay
// ningún idioma. Sólo un console.warn que nadie lee.
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { buildTranslatePrompt } from "./localize";

const TEXTOS = ["Cómo funciona", "Solicitar acceso", "Precios"];

test("el prompt NOMBRA la clave de salida — el contrato que perdió el esquema", () => {
  const p = buildTranslatePrompt(TEXTOS, "en", "es");
  assert.match(
    p,
    /"translations"/,
    'el prompt no nombra la clave "translations": el parseo la exige y el modelo no puede adivinarla',
  );
});

test("y enseña la FORMA con un ejemplo, no sólo el nombre", () => {
  const p = buildTranslatePrompt(TEXTOS, "en", "es");
  // Nombrar la clave no basta: en modo JSON el modelo devolvió un fragmento de
  // esquema. Un ejemplo literal es lo que fija que el valor es un ARRAY DE
  // CADENAS y no un objeto, un mapa de índices, ni otro esquema.
  assert.match(p, /\{"translations":\s*\[/, "falta un ejemplo literal de la forma esperada");
});

test("pide exactamente tantas traducciones como cadenas hay", () => {
  const p = buildTranslatePrompt(TEXTOS, "en", "es");
  assert.match(p, /EXACTLY 3 translations/);
  assert.match(p, /array of 3 strings/);
  // Y con otra cantidad, cambia: un número cableado pasaría las dos de arriba.
  const p9 = buildTranslatePrompt([...TEXTOS, ...TEXTOS, ...TEXTOS], "en", "es");
  assert.match(p9, /EXACTLY 9 translations/);
  assert.match(p9, /array of 9 strings/);
});

test("nombra los idiomas en inglés, que es como los entiende el modelo", () => {
  const p = buildTranslatePrompt(TEXTOS, "ja", "es");
  assert.match(p, /from Spanish to Japanese/);
});

test("las cadenas viajan como JSON, no concatenadas", () => {
  // Una cadena con comillas o saltos rompería un formato a pelo y desalinearía
  // TODAS las traducciones siguientes — y el desalineo no da error, publica una
  // página con los textos cambiados de sitio.
  const p = buildTranslatePrompt(['Dice "hola"', "línea\nrota"], "en", "es");
  assert.ok(p.includes(JSON.stringify(['Dice "hola"', "línea\nrota"])));
});
