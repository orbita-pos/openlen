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
import { creditsForUsage } from "@/lib/credits";
import { creditRateForRole, roleForOperation } from "@/lib/generation/model-policy";
import { buildTranslatePrompt, translateStrings, translationLedgerEntry, type TranslationUsage } from "./localize";

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

// EL LIBRO DE GASTO (spec local 2026-10-16-credit-ledger): cada idioma traducido
// deja una fila a nombre del dueño, con 0 cobrado (lo paga OpenLen).
test("ledger: each translated locale is one publish_translation row", () => {
  const entry = translationLedgerEntry("p1", "en", { inputTokens: 1_200, cachedTokens: 0, outputTokens: 300 });
  assert.equal(entry.surface, "publish_translation");
  assert.equal(entry.outcome, "ok");
  assert.equal(entry.projectId, "p1");
  assert.equal(entry.refId, "en");
  assert.equal(entry.uses?.length, 1);
  assert.equal(entry.uses?.[0]?.provider, "fireworks");
  assert.equal(entry.uses?.[0]?.inputTokens, 1_200);
  assert.equal(entry.uses?.[0]?.outputTokens, 300);
  // Lo que valía a la tarifa de cobro: es lo que OpenLen regala.
  assert.equal(entry.listCenticredits, creditsForUsage(1_200, 300, creditRateForRole(roleForOperation("copy")), 0));
});

// El razonador corre en DeepInfra desde el 15/11: la fila dice quién tradujo, y con eso el coste es el suyo.
test("ledger: the row names the provider that translated, not always Fireworks", () => {
  const entry = translationLedgerEntry("p1", "en", {
    inputTokens: 1_200,
    cachedTokens: 0,
    outputTokens: 300,
    provider: "deepinfra",
    model: "deepseek-ai/DeepSeek-V4.1-Flash-1017",
  });
  assert.equal(entry.uses?.[0]?.provider, "deepinfra");
  assert.equal(entry.uses?.[0]?.model, "deepseek-ai/DeepSeek-V4.1-Flash-1017");
  // Lo que se cobra (nada, aquí; lo que vale) sigue a la tarifa de cobro, sea quien sea el proveedor.
  assert.equal(entry.listCenticredits, creditsForUsage(1_200, 300, creditRateForRole(roleForOperation("copy")), 0));
});

// Y LO QUE LLEGA A ESA FILA: `onUsage` dice quién tradujo. Aquí se perdía — la fila ya sabía escribir el proveedor,
// pero la traducción le entregaba sólo los tokens, y todo salía como Fireworks.
test("translating: onUsage says DeepInfra served it, with its model id", async () => {
  const before = { fetch: globalThis.fetch, fw: process.env.FIREWORKS_API_KEY, di: process.env.DEEPINFRA_API_KEY, order: process.env.OPENLEN_AGENT_PROVIDERS };
  const urls: string[] = [];
  process.env.FIREWORKS_API_KEY = "fw-key";
  process.env.DEEPINFRA_API_KEY = "di-key";
  delete process.env.OPENLEN_AGENT_PROVIDERS;
  globalThis.fetch = (async (url: string | URL | Request) => {
    urls.push(String(url));
    const sse =
      `data: ${JSON.stringify({ choices: [{ delta: { content: '{"translations":["How it works"]}' }, finish_reason: "stop" }] })}\n\n` +
      `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 120, completion_tokens: 9, total_tokens: 129 } })}\n\n` +
      "data: [DONE]\n\n";
    return new Response(sse, { status: 200 });
  }) as typeof fetch;
  try {
    const usages: TranslationUsage[] = [];
    const out = await translateStrings(["Cómo funciona"], "en", "es", (u) => usages.push(u));
    assert.deepEqual(out, ["How it works"]);
    assert.deepEqual(urls, ["https://api.deepinfra.com/v1/openai/chat/completions"]);
    assert.equal(usages.length, 1);
    assert.equal(usages[0]?.provider, "deepinfra");
    assert.equal(usages[0]?.model, "deepseek-ai/DeepSeek-V4.1-Flash-1017");
    assert.equal(translationLedgerEntry("p1", "en", usages[0]!).uses?.[0]?.provider, "deepinfra");
  } finally {
    globalThis.fetch = before.fetch;
    for (const [k, v] of [["FIREWORKS_API_KEY", before.fw], ["DEEPINFRA_API_KEY", before.di], ["OPENLEN_AGENT_PROVIDERS", before.order]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});
