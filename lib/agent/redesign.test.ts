// Unit tests de lib/agent/redesign.ts — todo mockeado (sin red). El transporte
// se inyecta via internals, mismo patrón que verify.test.ts / vision-critique.
//
// Corre via: npx tsx --test lib/agent/redesign.test.ts  (suite test:node)

import { test } from "node:test";
import { strict as assert } from "node:assert";

import {
  buildRedesignPrompt,
  extractRedesignedDocument,
  redesignWithGemini,
} from "./redesign";
import type { StreamEvent } from "../ai-gateway";

const INPUT = {
  html: '<!doctype html><html lang="es"><body><h1>Tacos El Güero</h1><div data-ol-bookings-section></div></body></html>',
  direccion: "más moderna y oscura",
  negocio: { nombre: "Tacos El Güero", contacto: { whatsapp: "6671234567" } },
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

test("el prompt lleva dirección, negocio, brief, documento y las reglas duras", () => {
  const p = buildRedesignPrompt(INPUT);
  assert.ok(p.includes("más moderna y oscura"));
  assert.ok(p.includes("Tacos El Güero"));
  assert.ok(p.includes("6671234567"));
  assert.ok(p.includes("siempre háblame de tú"));
  assert.ok(p.includes("data-ol-bookings-section")); // el doc actual viaja entero
  assert.ok(/data-ol-\*/.test(p)); // regla de conservación de marcadores
  assert.ok(/NADA de JavaScript/i.test(p));
  assert.ok(/data-slot-path/.test(p));
});

test("sin negocio ni brief, sus bloques no aparecen", () => {
  const p = buildRedesignPrompt({ ...INPUT, negocio: null, brief: null });
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

// ── redesignWithGemini ──────────────────────────────────────────────────────

test("camino feliz: devuelve el documento + usage y cobra por tokens medidos", async () => {
  let debited = 0;
  const r = await redesignWithGemini(INPUT, "gemini-test", "k", {
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
  const r = await redesignWithGemini(INPUT, "gemini-test", "k", {
    provider: providerReturning("no tengo un documento para ti"),
    debit: async (c) => { debited = c; },
  });
  assert.equal(r.ok, false);
  assert.equal(debited, 0);
});

test("stream truncado por max_tokens → ok:false con motivo claro", async () => {
  const r = await redesignWithGemini(INPUT, "gemini-test", "k", {
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
  const r = await redesignWithGemini(INPUT, "gemini-test", "k", {
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
  const r = await redesignWithGemini(INPUT, "gemini-test", "k", {
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
