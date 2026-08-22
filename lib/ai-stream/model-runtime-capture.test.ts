// La captura del runtime del modelo, contra el HtmlStream DE VERDAD.
//
// No se inyecta `makeHtmlStream` a propósito: el mock de generate.test.ts es un
// passthrough y no sanitiza, así que con él la afirmación importante de esta
// etapa —que capturar NO debilita el sanitizador— pasaría en verde sin haberse
// comprobado. Aquí corre el crate real.
//
// Run: npx tsx --test lib/ai-stream/model-runtime-capture.test.ts
import { test } from "node:test";
import { strict as assert } from "node:assert";

import { generateHtmlStream, type GeminiProviderLike } from "./generate";
import type { StreamEvent } from "../ai-gateway";

const CODIGO = `document.querySelectorAll("[data-cuenta]").forEach(function(b){b.onclick=function(){b.textContent=String(Number(b.textContent||0)+1)}});`;

const DOC = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>contador</title></head>
<body><h1>Contador</h1><button data-cuenta>0</button>
<script data-openlen-model-runtime>${CODIGO}</script>
</body></html>`;

function proveedor(html: string): GeminiProviderLike {
  const eventos: StreamEvent[] = [
    { type: "start", id: "m1" },
    { type: "text_delta", text: html },
    { type: "usage", inputTokens: 10, outputTokens: 20, cachedTokens: 0, thinkingTokens: 0 },
    { type: "done", stopReason: { kind: "end_turn" } },
  ];
  return {
    stream() {
      return (async function* () {
        for (const e of eventos) yield e;
      })();
    },
  } as unknown as GeminiProviderLike;
}

const opciones = {
  apiKey: "k",
  messages: [{ role: "user" as const, content: "haz un contador" }],
  userId: "u1",
};

async function correr(env: Record<string, string | undefined>, wroteWith: "deepseek" | "gemini") {
  const previo = process.env.OPENLEN_MODEL_JS;
  if (env.OPENLEN_MODEL_JS === undefined) delete process.env.OPENLEN_MODEL_JS;
  else process.env.OPENLEN_MODEL_JS = env.OPENLEN_MODEL_JS;
  try {
    const { stream, done } = generateHtmlStream(opciones, {
      provider: proveedor(DOC),
      wroteWith,
      debit: (async () => {}) as never,
    });
    const reader = stream.getReader();
    for (;;) { const { done: d } = await reader.read(); if (d) break; }
    return await done;
  } finally {
    if (previo === undefined) delete process.env.OPENLEN_MODEL_JS;
    else process.env.OPENLEN_MODEL_JS = previo;
  }
}

test("con el interruptor en 1 y DeepSeek, el runtime se captura", async () => {
  const s = await correr({ OPENLEN_MODEL_JS: "1" }, "deepseek");
  assert.equal(s.wroteWith, "deepseek");
  assert.equal(s.modelRuntime, CODIGO, "los bytes tienen que llegar exactos");
});

/**
 * LA AFIRMACIÓN QUE SOSTIENE TODA LA ETAPA.
 *
 * Capturar el runtime NO es publicarlo. El HTML que sale sigue pasando por el
 * mismo sanitizador, y por eso `sanitize:false` no se toca en ningún momento:
 * ese interruptor no sólo suelta los scripts — también suelta manejadores `on*`,
 * URLs peligrosas e iframes.
 */
test("y aun así el HTML final sigue sin el script DEL MODELO", async () => {
  const s = await correr({ OPENLEN_MODEL_JS: "1" }, "deepseek");
  assert.ok(s.finalHtml, "debería haber documento");
  assert.ok(!s.finalHtml!.includes("data-openlen-model-runtime"), "el marcador sobrevivió");
  assert.ok(!s.finalHtml!.includes("data-cuenta]"), "el CÓDIGO del modelo sobrevivió");
  // Los scripts que SÍ quedan son nuestros —los portadores de tokens de diseño,
  // `data-ol-radius` y compañía—, inyectados después de sanitizar. Distinguirlo
  // importa: "cero scripts" sería una aserción falsa que se rompería el día que
  // alguien añada otro bake, sin que nada malo hubiera pasado.
  for (const m of s.finalHtml!.matchAll(/<script([^>]*)>/gi)) {
    assert.match(m[1]!, /data-ol-|src="https:\/\/cdn\.tailwindcss\.com/, `script ajeno: ${m[0]}`);
  }
  // Y la página en sí sobrevive entera: no se está tirando el documento.
  assert.match(s.finalHtml!, /Contador/);
  assert.match(s.finalHtml!, /data-cuenta/);
});

test("apagado, no se captura nada — y el documento sale igual", async () => {
  const off = await correr({ OPENLEN_MODEL_JS: undefined }, "deepseek");
  assert.equal(off.modelRuntime, null);
  const on = await correr({ OPENLEN_MODEL_JS: "1" }, "deepseek");
  assert.equal(off.finalHtml, on.finalHtml, "capturar no puede cambiar el HTML");
});

/**
 * La procedencia importa aunque hoy no se guarde nada. La Etapa 2 va a FIRMAR
 * estos bytes: firmar los de un proveedor creyéndolos de otro es justo la clase
 * de error que un hash no puede detectar después.
 */
test("si escribió Gemini, no se captura aunque el script esté ahí", async () => {
  const s = await correr({ OPENLEN_MODEL_JS: "1" }, "gemini");
  assert.equal(s.wroteWith, "gemini");
  assert.equal(s.modelRuntime, null);
});

test("un script SIN el marcador no es un runtime", async () => {
  const previo = process.env.OPENLEN_MODEL_JS;
  process.env.OPENLEN_MODEL_JS = "1";
  try {
    const { stream, done } = generateHtmlStream(opciones, {
      provider: proveedor(DOC.replace(" data-openlen-model-runtime", "")),
      wroteWith: "deepseek",
      debit: (async () => {}) as never,
    });
    const reader = stream.getReader();
    for (;;) { const { done: d } = await reader.read(); if (d) break; }
    assert.equal((await done).modelRuntime, null);
  } finally {
    if (previo === undefined) delete process.env.OPENLEN_MODEL_JS;
    else process.env.OPENLEN_MODEL_JS = previo;
  }
});
