// Unit tests de lib/agent/redesign.ts — todo mockeado (sin red). El transporte
// se inyecta via internals, mismo patrón que verify.test.ts / vision-critique.
//
// Corre via: npx tsx --test lib/agent/redesign.test.ts  (suite test:node)

import { test } from "node:test";
import { strict as assert } from "node:assert";

import {
  buildRedesignPrompt,
  extractRedesignedDocument,
  redesignPage,
} from "./redesign";
import type { StreamEvent } from "../ai-gateway";

const INPUT = {
  html: '<!doctype html><html lang="es"><body><h1>Tacos El Güero</h1><div data-ol-bookings-section></div></body></html>',
  direccion: "más moderna y oscura",
  brief: "siempre háblame de tú",
};

const BIG_DOC = `<!doctype html><html lang="es"><head><title>X</title></head><body><h1>Nuevo</h1>${"<p>sección</p>".repeat(200)}</body></html>`;

function providerReturning(raw: string) {
  return {
    stream: () =>
      (async function* (): AsyncGenerator<StreamEvent> {
        yield { type: "text_delta", text: raw };
        yield { type: "usage", inputTokens: 9000, outputTokens: 7000, cachedTokens: 100, thinkingTokens: 0 };
        yield { type: "done", stopReason: { kind: "end_turn" } };
      })() as AsyncIterableIterator<StreamEvent>,
  };
}

// ── buildRedesignPrompt ─────────────────────────────────────────────────────

test("el prompt lleva dirección, brief, documento y las reglas duras", () => {
  const p = buildRedesignPrompt(INPUT);
  assert.ok(p.includes("más moderna y oscura"));
  assert.ok(p.includes("siempre háblame de tú"));
  assert.ok(p.includes("data-ol-bookings-section")); // el doc actual viaja entero
  assert.ok(/data-ol-\*/.test(p)); // regla de conservación de marcadores
  assert.ok(/NADA de JavaScript/i.test(p));
  assert.ok(/data-slot-path/.test(p));
});

// ⚰️ El bloque «DATOS REALES DEL NEGOCIO» ya no existe: se fue con el perfil
// el 2026-08-31. Lo que era «sin negocio no aparece su bloque» es ahora
// «NUNCA aparece», y el brief conserva su mitad de la prueba.
test("el prompt ya no lleva un bloque de negocio, y sin brief tampoco el suyo", () => {
  const p = buildRedesignPrompt({ ...INPUT, brief: null });
  assert.ok(!p.includes("DATOS REALES DEL NEGOCIO"));
  assert.ok(!p.includes("BRIEF PERSISTENTE"));
});

// ── extractRedesignedDocument ───────────────────────────────────────────────

test("extrae el documento aunque venga con fences y prosa alrededor", () => {
  const doc = extractRedesignedDocument("Claro, aquí está:\n```html\n" + BIG_DOC + "\n```\n¡Listo!");
  assert.ok(doc?.startsWith("<!doctype html"));
  assert.ok(doc?.endsWith("</html>"));
  assert.ok(!doc?.includes("¡Listo!"));
});

test("un documento diminuto (truncado) se rechaza", () => {
  assert.equal(extractRedesignedDocument("<!doctype html><html><body>x</body></html>"), null);
});

test("sin </html> de cierre se rechaza", () => {
  assert.equal(extractRedesignedDocument("<!doctype html><html><body>" + "x".repeat(3000)), null);
});

// ── redesignPage ──────────────────────────────────────────────────────

test("camino feliz: devuelve el documento + usage y cobra por tokens medidos", async () => {
  let debited = 0;
  const r = await redesignPage(INPUT, {
    provider: providerReturning(BIG_DOC),
    debit: async (c) => { debited = c; },
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.ok(r.html.includes("Nuevo"));
    assert.equal(r.usage.inputTokens, 9000);
  }
  assert.ok(debited >= 1);
});

test("respuesta sin documento completo → ok:false, sin cobro", async () => {
  let debited = 0;
  const r = await redesignPage(INPUT, {
    provider: providerReturning("no tengo un documento para ti"),
    debit: async (c) => { debited = c; },
  });
  assert.equal(r.ok, false);
  assert.equal(debited, 0);
});

test("stream truncado por max_tokens → ok:false con motivo claro", async () => {
  const r = await redesignPage(INPUT, {
    provider: {
      stream: () =>
        (async function* (): AsyncGenerator<StreamEvent> {
          yield { type: "text_delta", text: BIG_DOC.slice(0, 500) };
          yield { type: "done", stopReason: { kind: "max_tokens" } };
        })() as AsyncIterableIterator<StreamEvent>,
    },
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /truncó/);
});

test("el provider revienta → ok:false, nunca lanza", async () => {
  const r = await redesignPage(INPUT, {
    provider: {
      stream: () =>
        (async function* (): AsyncGenerator<StreamEvent> {
          throw new Error("boom");
        })() as AsyncIterableIterator<StreamEvent>,
    },
  });
  assert.equal(r.ok, false);
});

test("timeout → ok:false, nunca cuelga", async () => {
  const r = await redesignPage(INPUT, {
    provider: {
      stream: () =>
        (async function* (): AsyncGenerator<StreamEvent> {
          await new Promise((s) => setTimeout(s, 5_000));
          yield { type: "text_delta", text: BIG_DOC };
        })() as AsyncIterableIterator<StreamEvent>,
    },
    timeoutMs: 100,
  });
  assert.equal(r.ok, false);
});

// ── El JavaScript del modelo ────────────────────────────────────────────────
//
// El rediseño es la TERCERA superficie que produce un documento entero, así que
// es la tercera que puede capturar un script. Estuvo bloqueada hasta el
// 2026-08-21 por PROCEDENCIA: corría en Gemini y la cápsula se llama
// "deepseek-generate-v1". Al mover el rediseño a DeepSeek se destrabó.

const CON_SCRIPT =
  BIG_DOC.replace("</body>", `<script data-openlen-model-runtime>window.__X__=1;</script></body>`);

function conInterruptor<T>(valor: string | undefined, fn: () => Promise<T>): Promise<T> {
  const previo = process.env.OPENLEN_MODEL_JS;
  if (valor === undefined) delete process.env.OPENLEN_MODEL_JS;
  else process.env.OPENLEN_MODEL_JS = valor;
  return fn().finally(() => {
    if (previo === undefined) delete process.env.OPENLEN_MODEL_JS;
    else process.env.OPENLEN_MODEL_JS = previo;
  });
}

// ⚰️ RETIRADAS LAS DOS PRUEBAS DE LA CAPTURA DE RUNTIME (2026-09-04).
//
// Fijaban que el rediseño sacara el `<script>` del modelo del texto CRUDO
// «antes de que el saneado lo borrara». Las dos mitades de esa frase eran
// falsas, y la prueba no podía verlo porque su fixture mentía:
//
//   · LA CAPTURA NO PODÍA SALIR en producción. `extractModelRuntime` cuenta
//     CUALQUIER `<script>`, y el contrato obliga al de Tailwind por CDN en
//     todas las páginas: con el del modelo son dos y devuelve «varios». Esta
//     prueba pasaba porque `BIG_DOC` NO trae el de Tailwind — o sea, fijaba el
//     comportamiento sobre un documento que no existe.
//   · Y EL SANEADO NO LO BORRA. `preparePage` usa `gateReservedMarker`, que
//     sólo mira `data-slot-path`. El `<script>` viaja dentro del documento.
//
// El límite queda fijado donde le toca, en `lib/ai-stream/model-runtime.test.ts`
// («el límite: esto lee un PAYLOAD, no una página»), con una página de verdad.
// Y que el JavaScript del modelo sobrevive de punta a punta ya lo vigila
// `lib/publish/model-runtime-e2e.test.ts`.
