// Unit tests de lib/agent/verify.ts — todo mockeado (sin puppeteer, sin red).
// provider + render se inyectan via `internals`, igual que en
// lib/ai/vision-critique.test.ts (mismo patrón, mismo runner).
//
// Corre via: npx tsx --test lib/agent/verify.test.ts  (suite test:node)

import { test } from "node:test";
import { strict as assert } from "node:assert";

import { parseVisualVerdict, verifyEditedPage } from "./verify";
import type { InlineImage, StreamEvent } from "../ai-gateway";

const PARAMS = {
  html: "<!doctype html><html><body><h1>Hola</h1></body></html>",
  userPrompt: "cambia el hero a rojo",
  model: "gemini-test",
  apiKey: "k",
};

const IMAGE: InlineImage = { mimeType: "image/jpeg", dataBase64: "aGk=" };

function providerReturning(raw: string) {
  return {
    stream: () =>
      (async function* (): AsyncGenerator<StreamEvent> {
        yield { type: "text_delta", text: raw };
        yield { type: "done", stopReason: { kind: "end_turn" } };
      })() as AsyncIterableIterator<StreamEvent>,
  };
}

// ── parseVisualVerdict ──────────────────────────────────────────────────────

test("parsea un veredicto de rotura", () => {
  const v = parseVisualVerdict('{"broken":true,"issues":["texto encimado en el hero"]}');
  assert.deepEqual(v, {
    broken: true,
    issues: ["texto encimado en el hero"],
    fallback: false,
  });
});

test("broken sin issues concretos NO dispara nada", () => {
  const v = parseVisualVerdict('{"broken":true,"issues":[]}');
  assert.equal(v?.broken, false);
});

test("recorta a 4 issues — más no es arreglo quirúrgico", () => {
  const v = parseVisualVerdict(
    JSON.stringify({ broken: true, issues: ["a", "b", "c", "d", "e", "f"] }),
  );
  assert.equal(v?.issues.length, 4);
});

test("sobrevive fences de markdown pese al JSON mode", () => {
  const v = parseVisualVerdict('```json\n{"broken":false,"issues":[]}\n```');
  assert.deepEqual(v, { broken: false, issues: [], fallback: false });
});

test("basura → null (el caller lo mapea a fallback)", () => {
  assert.equal(parseVisualVerdict("no soy json"), null);
  assert.equal(parseVisualVerdict('{"issues":[]}'), null); // sin broken
  assert.equal(parseVisualVerdict(""), null);
});

// ── contentMap ──────────────────────────────────────────────────────────────

test("contentMap lista el texto del body con su etiqueta", async () => {
  const { contentMap } = await import("./verify");
  const map = contentMap(
    '<html><head><title>No va</title><style>.x{color:red}</style></head><body><h1>Tacos El Buen Sabor</h1><p>Al carbón desde 1998</p><script>var s="tampoco va";</script></body></html>',
  );
  assert.ok(map.includes("<h1> Tacos El Buen Sabor"));
  assert.ok(map.includes("<p> Al carbón desde 1998"));
  assert.ok(!map.includes("No va")); // el <head> no cuenta
  assert.ok(!map.includes("tampoco va")); // script fuera
});

test("contentMap se acota a 30 bloques", async () => {
  const { contentMap } = await import("./verify");
  const many = Array.from({ length: 60 }, (_, i) => `<p>bloque número ${i}</p>`).join("");
  const map = contentMap(`<html><body>${many}</body></html>`);
  assert.equal(map.split("\n").length, 30);
});

// ── verifyEditedPage ────────────────────────────────────────────────────────

test("rotura real → broken=true con los issues", async () => {
  const v = await verifyEditedPage(PARAMS, {
    render: async () => IMAGE,
    provider: providerReturning('{"broken":true,"issues":["contraste ilegible en precios"]}'),
  });
  assert.equal(v.broken, true);
  assert.deepEqual(v.issues, ["contraste ilegible en precios"]);
  assert.equal(v.fallback, false);
});

test("página limpia → broken=false", async () => {
  const v = await verifyEditedPage(PARAMS, {
    render: async () => IMAGE,
    provider: providerReturning('{"broken":false,"issues":[]}'),
  });
  assert.equal(v.broken, false);
  assert.equal(v.fallback, false);
});

test("sin screenshot → fallback fail-open (jamás rompe el turno)", async () => {
  const v = await verifyEditedPage(PARAMS, {
    render: async () => null,
    provider: providerReturning('{"broken":true,"issues":["x"]}'),
  });
  assert.deepEqual(v, { broken: false, issues: [], fallback: true });
});

test("el provider revienta → fallback", async () => {
  const v = await verifyEditedPage(PARAMS, {
    render: async () => IMAGE,
    provider: {
      stream: () =>
        (async function* (): AsyncGenerator<StreamEvent> {
          throw new Error("503");
        })() as AsyncIterableIterator<StreamEvent>,
    },
  });
  assert.equal(v.fallback, true);
  assert.equal(v.broken, false);
});

test("timeout → fallback", async () => {
  const v = await verifyEditedPage(PARAMS, {
    render: async () => IMAGE,
    provider: {
      stream: () =>
        (async function* (): AsyncGenerator<StreamEvent> {
          await new Promise((r) => setTimeout(r, 5_000));
          yield { type: "text_delta", text: '{"broken":false,"issues":[]}' };
        })() as AsyncIterableIterator<StreamEvent>,
    },
    timeoutMs: 100,
  });
  assert.equal(v.fallback, true);
});

test("veredicto malformado → fallback", async () => {
  const v = await verifyEditedPage(PARAMS, {
    render: async () => IMAGE,
    provider: providerReturning("esto no es JSON"),
  });
  assert.equal(v.fallback, true);
});

// ── lo que el navegador GRITA ───────────────────────────────────────────────
// La captura de una pagina cuyo JavaScript murio pesa EXACTAMENTE lo mismo que
// la de una sana (medido con tres paginas: 12908 bytes las tres). Asi que este
// hecho no puede pasar por el juicio del critico visual — el ojo no lo ve.

test("un grito del navegador rompe el veredicto aunque el critico diga que esta bien", async () => {
  const v = await verifyEditedPage(PARAMS, {
    render: async (_html, opts?: { onErrors?: (e: readonly string[]) => void }) => {
      opts?.onErrors?.(["TypeError: Cannot read properties of undefined"]);
      return IMAGE;
    },
    provider: providerReturning('{"broken":false,"issues":[]}'),
  });
  assert.equal(v.broken, true);
  // Va PRIMERO: es lo mas accionable que el turno puede darle al modelo.
  assert.match(v.issues[0]!, /Cannot read properties of undefined/);
});

test("la frase no promete «al cargar» — tambien se pulsan los controles", async () => {
  const v = await verifyEditedPage(PARAMS, {
    render: async (_html, opts?: { onErrors?: (e: readonly string[]) => void }) => {
      opts?.onErrors?.(["boom"]);
      return IMAGE;
    },
    provider: providerReturning('{"broken":false,"issues":[]}'),
  });
  // Decir «al cargar» sobre un fallo que aparece al pulsar manda al modelo a
  // buscar el bug al sitio equivocado.
  assert.match(v.issues[0]!, /al cargarla o al usar sus controles/);
});

// ── EL TEXTO QUE NADIE PUEDE LEER ───────────────────────────────────────────
// MEDIDO el 2026-08-22: a «pon el boton de acento en #f5e050 con el texto en
// blanco» el Agente obedece y entrega 1.34:1. El usuario pidio los colores, asi
// que cambiar_tema (que camina el contraste hasta cumplir WCAG) ni entra. Por
// el camino determinista el peor de 12 fue 4.88:1; a mano, la mitad quedo bajo
// 4.5. El detector ya existia y ya lo cazaba — solo no llegaba al Agente.

test("un texto ilegible rompe el veredicto aunque el critico lo vea bonito", async () => {
  const v = await verifyEditedPage(PARAMS, {
    render: async () => IMAGE,
    medir: async () => ({ unreadableText: [{ contrast: 1.34 }] }),
    provider: providerReturning('{"broken":false,"issues":[]}'),
  });
  assert.equal(v.broken, true);
  assert.match(v.issues[0]!, /1\.34:1/);
  // Y el caso REAL: si el usuario pidio esos colores, decirselo en vez de
  // pisarlo en silencio.
  assert.match(v.issues[0]!, /si el usuario pidió ESOS colores/);
});

test("un contraste sano no dice nada", async () => {
  const v = await verifyEditedPage(PARAMS, {
    render: async () => IMAGE,
    medir: async () => ({ unreadableText: [] }),
    provider: providerReturning('{"broken":false,"issues":[]}'),
  });
  assert.equal(v.broken, false);
});

// Fail-open, como TODO en este archivo: el medidor solo puede mejorar un turno.
test("si el medidor revienta, el turno sigue igual", async () => {
  const v = await verifyEditedPage(PARAMS, {
    render: async () => IMAGE,
    medir: async () => { throw new Error("chrome murio"); },
    provider: providerReturning('{"broken":true,"issues":["texto encimado"]}'),
  });
  assert.equal(v.broken, true);
  assert.deepEqual(v.issues, ["texto encimado"]);
});

test("sin gritos, el veredicto del critico manda", async () => {
  const v = await verifyEditedPage(PARAMS, {
    render: async () => IMAGE,
    medir: async () => ({ unreadableText: [] }),
    provider: providerReturning('{"broken":false,"issues":[]}'),
  });
  assert.equal(v.broken, false);
  assert.deepEqual(v.issues, []);
});
