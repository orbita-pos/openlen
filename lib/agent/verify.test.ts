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
