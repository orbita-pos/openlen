// Tests for lib/ai-stream/generate.ts — exercises the streaming pipeline
// end-to-end against in-memory mocks for the GeminiProvider, HtmlStream,
// and the credit debit function.
//
// Run via: npx tsx --test lib/ai-stream/generate.test.ts
//
// The mocks are intentionally lightweight: a passthrough HtmlStream that
// returns input bytes verbatim, a scripted GeminiProvider that yields a
// pre-recorded sequence of StreamEvents, and a spy debit() that records
// calls. This isolates generate.ts's control flow from the underlying
// napi crates — which are exercised separately in their own __test__
// suites (crates/{ai-gateway,html-engine}/__test__/*.test.mjs).

import { test } from "node:test";
import { strict as assert } from "node:assert";

import {
  generateHtmlStream,
  type PageStreamProvider,
  type DebitFn,
  type HtmlStreamLike,
  type GenerateHtmlStreamSummary, pageWriterUsesDeepSeek } from "./generate";
import type { StreamEvent } from "../ai-gateway";
import type { HtmlStreamOpts, HtmlStreamResult } from "../html-engine";

// ─── Helpers ───────────────────────────────────────────────────────────────

interface DebitCall {
  userId: string;
  amount: number;
}

function spyDebit(): { fn: DebitFn; calls: DebitCall[] } {
  const calls: DebitCall[] = [];
  return {
    calls,
    fn: async (userId, amount) => {
      calls.push({ userId, amount });
    },
  };
}

/** Build a debit that fails N times then succeeds — for the
 *  "debit error doesn't break the stream" test. */
function failingDebit(times: number): { fn: DebitFn; calls: DebitCall[] } {
  const calls: DebitCall[] = [];
  let remaining = times;
  return {
    calls,
    fn: async (userId, amount) => {
      calls.push({ userId, amount });
      if (remaining > 0) {
        remaining -= 1;
        throw new Error("debit failed");
      }
    },
  };
}

class PassthroughHtmlStream implements HtmlStreamLike {
  private writes: string[] = [];
  private ended = false;
  constructor(_opts: HtmlStreamOpts | undefined) {
    void _opts;
  }
  write(chunk: string): string {
    if (this.ended) throw new Error("write after end");
    this.writes.push(chunk);
    return chunk;
  }
  end(): HtmlStreamResult {
    this.ended = true;
    const finalHtml = this.writes.join("");
    return {
      finalHtml,
      bytesIn: finalHtml.length,
      bytesOut: finalHtml.length,
      bytesFinal: finalHtml.length,
      opIdsAssigned: 0,
      sanitizeRemoved: {
        scripts: 0,
        eventHandlers: 0,
        dangerousUrls: 0,
        iframes: 0,
        metaRefresh: 0,
      },
    };
  }
}

class ThrowingHtmlStream implements HtmlStreamLike {
  write(_chunk: string): string {
    throw new Error("data-slot-path detected (literal at byte 0)");
  }
  end(): HtmlStreamResult {
    throw new Error("end after error");
  }
}

/** Build a GeminiProvider mock from a fixed event script. Honors the
 *  AbortSignal by yielding `done { kind: 'cancelled' }` and stopping.
 *  Use `awaitable()` entries to gate progress on an external promise so
 *  cancellation tests can interleave the abort. */
type ScriptEntry =
  | StreamEvent
  | { __wait: Promise<void> }
  | { __throw: Error };

function scriptedProvider(script: ScriptEntry[]): PageStreamProvider {
  return {
    stream(_request, opts) {
      return scriptedStream(script, opts.signal);
    },
  };
}

function awaitable(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function* scriptedStream(
  script: ScriptEntry[],
  signal: AbortSignal | undefined,
): AsyncIterableIterator<StreamEvent> {
  for (const entry of script) {
    if (signal?.aborted) {
      yield { type: "done", stopReason: { kind: "cancelled" } };
      return;
    }
    if ("__wait" in entry) {
      // Race the wait against the signal so cancellation interrupts.
      if (signal) {
        await new Promise<void>((resolve) => {
          let done = false;
          const onAbort = () => {
            if (!done) {
              done = true;
              resolve();
            }
          };
          entry.__wait.then(() => {
            if (!done) {
              done = true;
              resolve();
            }
          });
          signal.addEventListener("abort", onAbort, { once: true });
        });
      } else {
        await entry.__wait;
      }
      if (signal?.aborted) {
        yield { type: "done", stopReason: { kind: "cancelled" } };
        return;
      }
      continue;
    }
    if ("__throw" in entry) {
      throw entry.__throw;
    }
    yield entry;
  }
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  let out = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return out;
      if (value) out += decoder.decode(value, { stream: true });
    }
  } finally {
    out += decoder.decode();
    reader.releaseLock();
  }
}

/** Read until N bytes have arrived OR the stream closes. */
async function readUntilBytes(
  stream: ReadableStream<Uint8Array>,
  minBytes: number,
): Promise<{ buffer: string; reader: ReadableStreamDefaultReader<Uint8Array> }> {
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  let buffer = "";
  while (buffer.length < minBytes) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) buffer += decoder.decode(value, { stream: true });
  }
  return { buffer, reader };
}

const baseOpts = (overrides: Partial<{ userId: string; model: "gemini-pro" | "gemini-flash" }> = {}) => ({
  apiKey: "TEST-KEY",
  messages: [{ role: "user" as const, content: "hi" }],
  userId: overrides.userId ?? "user-1",
  model: overrides.model,
});

// ─── Happy path ────────────────────────────────────────────────────────────

test("happy path: 3 text_deltas → 3 enqueued chunks, 1 usage → 1 debit", async () => {
  const debit = spyDebit();
  const provider = scriptedProvider([
    { type: "start", id: "msg-1" },
    { type: "text_delta", text: "<!doctype html>" },
    { type: "text_delta", text: "<html><body>" },
    { type: "text_delta", text: "<h1>Hi</h1></body></html>" },
    { type: "usage", inputTokens: 12, outputTokens: 34, cachedTokens: 0, thinkingTokens: 0 },
    { type: "done", stopReason: { kind: "end_turn" } },
  ]);

  const { stream, done } = generateHtmlStream(baseOpts(), {
    provider,
    debit: debit.fn,
    makeHtmlStream: (o) => new PassthroughHtmlStream(o),
  });

  const out = await readAll(stream);
  const summary = await done;

  assert.equal(
    out,
    "<!doctype html><html><body><h1>Hi</h1></body></html>",
    "stream concatenation should match the sum of text_deltas",
  );
  assert.equal(summary.stopKind, "end_turn");
  assert.equal(summary.error, null);
  assert.equal(summary.finalHtml, out, "passthrough end() returns concat");
  assert.deepEqual(summary.usage, { inputTokens: 12, outputTokens: 34 });
  assert.equal(debit.calls.length, 1, "debit called exactly once");
  assert.equal(debit.calls[0].userId, "user-1");
  assert.ok(
    debit.calls[0].amount >= 1,
    `expected non-zero credit amount, got ${debit.calls[0].amount}`,
  );
  assert.equal(summary.creditsDebited, debit.calls[0].amount);
});

test("happy path with model=gemini-flash routes credit rate accordingly", async () => {
  const debit = spyDebit();
  const provider = scriptedProvider([
    { type: "text_delta", text: "<p>x</p>" },
    { type: "usage", inputTokens: 1000, outputTokens: 1000, cachedTokens: 0, thinkingTokens: 0 },
    { type: "done", stopReason: { kind: "end_turn" } },
  ]);

  const { stream, done } = generateHtmlStream(
    baseOpts({ model: "gemini-flash" }),
    {
      provider,
      debit: debit.fn,
      makeHtmlStream: (o) => new PassthroughHtmlStream(o),
    },
  );
  await readAll(stream);
  const summary = await done;

  assert.equal(summary.stopKind, "end_turn");
  assert.equal(debit.calls.length, 1);
  // Flash sale más barato que Pro con el mismo consumo. Con 1k de entrada y 1k
  // de salida a la tarifa flash (0,22 / 0,66 por millón): $0,00088, que son
  // 9 centicréditos — 0,09 créditos.
  //
  // ⬇️ EN CENTICRÉDITOS desde el 2026-08-30 (`b0038638`). Antes esto cobraba
  // 1 crédito, el `Math.ceil` de 0,088. O sea ONCE VECES lo que cuesta, y es
  // el ejemplo más crudo de por qué el redondeo se llevaba por delante los
  // turnos pequeños: cuanto más barato el turno, mayor el recargo.
  //
  // 🔴 ESTA PRUEBA SE QUEDÓ EN ROJO UN RATO, y merece la pena decir por qué:
  // corre en `test:node`, que NO está entre las puertas del deploy —esas son
  // fable-parity, visual-engine-assets, page-engine, typecheck y publish-host,
  // todas vitest— y tras el cambio de unidad corrí vitest y las suites de
  // créditos, pero no ésta. La puerta del deploy cazó a su gemela de vitest
  // (`image-edit-core.test.ts`) y a ésta no la mira nadie.
  assert.equal(debit.calls[0].amount, 9, "la tarifa flash da 0,09 créditos");
});

test("max_tokens stop reason still calls end() and resolves with final HTML", async () => {
  const debit = spyDebit();
  const provider = scriptedProvider([
    { type: "text_delta", text: "<div>truncated" },
    { type: "usage", inputTokens: 50, outputTokens: 200, cachedTokens: 0, thinkingTokens: 0 },
    { type: "done", stopReason: { kind: "max_tokens" } },
  ]);

  const { stream, done } = generateHtmlStream(baseOpts(), {
    provider,
    debit: debit.fn,
    makeHtmlStream: (o) => new PassthroughHtmlStream(o),
  });
  const out = await readAll(stream);
  const summary = await done;

  assert.equal(summary.stopKind, "max_tokens");
  assert.equal(summary.finalHtml, "<div>truncated");
  assert.equal(out, "<div>truncated");
  assert.equal(debit.calls.length, 1);
});

// ─── Cancellation ──────────────────────────────────────────────────────────

test("cancel mid-stream: stream closes <500ms; debit NOT called", async () => {
  const debit = spyDebit();
  const gate = awaitable(); // never resolves on its own
  const provider = scriptedProvider([
    { type: "text_delta", text: "<p>first" },
    { __wait: gate.promise },
    { type: "text_delta", text: "<p>after-cancel" }, // never reached
    { type: "usage", inputTokens: 10, outputTokens: 20, cachedTokens: 0, thinkingTokens: 0 }, // never reached
    { type: "done", stopReason: { kind: "end_turn" } },
  ]);

  const controller = new AbortController();
  const { stream, done } = generateHtmlStream(
    { ...baseOpts(), signal: controller.signal },
    {
      provider,
      debit: debit.fn,
      makeHtmlStream: (o) => new PassthroughHtmlStream(o),
    },
  );

  // Wait for first chunk to land, then cancel.
  const { buffer, reader } = await readUntilBytes(stream, "<p>first".length);
  assert.equal(buffer, "<p>first");

  const t0 = performance.now();
  controller.abort();

  // Drain remaining chunks (should be none) until close.
  let tail = "";
  const decoder = new TextDecoder();
  while (true) {
    const { value, done: streamDone } = await reader.read();
    if (streamDone) break;
    if (value) tail += decoder.decode(value, { stream: true });
  }
  tail += decoder.decode();
  reader.releaseLock();
  const elapsed = performance.now() - t0;

  const summary = await done;

  assert.ok(elapsed < 500, `expected stream close < 500ms, got ${elapsed}ms`);
  assert.equal(tail, "", "no further chunks after cancel");
  assert.equal(summary.stopKind, "cancelled");
  assert.equal(summary.finalHtml, null, "no canonical HTML on cancellation");
  assert.equal(summary.result, null, "no end() result on cancellation");
  assert.equal(summary.creditsDebited, 0, "no debit when usage didn't arrive");
  assert.equal(debit.calls.length, 0, "debit was never called");
  assert.equal(summary.error, null);

  // Release the dangling gate so the generator can exit cleanly.
  gate.resolve();
});

test("cancel BEFORE first event yields no chunks and no debit", async () => {
  const debit = spyDebit();
  const gate = awaitable();
  const provider = scriptedProvider([
    { __wait: gate.promise },
    { type: "text_delta", text: "<p>x" },
    { type: "usage", inputTokens: 10, outputTokens: 20, cachedTokens: 0, thinkingTokens: 0 },
    { type: "done", stopReason: { kind: "end_turn" } },
  ]);

  const controller = new AbortController();
  controller.abort(); // pre-flight cancel

  const { stream, done } = generateHtmlStream(
    { ...baseOpts(), signal: controller.signal },
    {
      provider,
      debit: debit.fn,
      makeHtmlStream: (o) => new PassthroughHtmlStream(o),
    },
  );
  const out = await readAll(stream);
  const summary = await done;

  assert.equal(out, "", "pre-flight cancel yields no chunks");
  assert.equal(summary.stopKind, "cancelled");
  assert.equal(debit.calls.length, 0);

  gate.resolve();
});

test("cancel via stream.cancel() (consumer side) forwards to upstream", async () => {
  const debit = spyDebit();
  const gate = awaitable();
  const provider = scriptedProvider([
    { type: "text_delta", text: "<p>seen" },
    { __wait: gate.promise },
    { type: "usage", inputTokens: 1, outputTokens: 2, cachedTokens: 0, thinkingTokens: 0 },
    { type: "done", stopReason: { kind: "end_turn" } },
  ]);

  const { stream, done } = generateHtmlStream(baseOpts(), {
    provider,
    debit: debit.fn,
    makeHtmlStream: (o) => new PassthroughHtmlStream(o),
  });

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let firstChunk = "";
  while (firstChunk.length < "<p>seen".length) {
    const { value, done: streamDone } = await reader.read();
    if (streamDone) break;
    if (value) firstChunk += decoder.decode(value, { stream: true });
  }
  assert.equal(firstChunk, "<p>seen");

  await reader.cancel();
  const summary = await done;

  assert.equal(summary.stopKind, "cancelled");
  assert.equal(debit.calls.length, 0);

  gate.resolve();
});

// ─── Cancel POST-usage: debit happened once, no double debit ──────────────

test("cancel AFTER usage: one debit recorded, no refund, stopKind=cancelled", async () => {
  const debit = spyDebit();
  const gate = awaitable();
  const provider = scriptedProvider([
    { type: "text_delta", text: "<p>warm" },
    { type: "usage", inputTokens: 50, outputTokens: 100, cachedTokens: 0, thinkingTokens: 0 },
    { __wait: gate.promise },
    { type: "done", stopReason: { kind: "end_turn" } },
  ]);

  const controller = new AbortController();
  const { stream, done } = generateHtmlStream(
    { ...baseOpts(), signal: controller.signal },
    {
      provider,
      debit: debit.fn,
      makeHtmlStream: (o) => new PassthroughHtmlStream(o),
    },
  );

  // Wait for the debit to land (it happens on the usage event, which
  // arrives before the gated wait). We don't have a debit-fired hook,
  // so poll briefly. The provider yields usage immediately after the
  // first text_delta, so a tiny wait is enough.
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (buf.length < "<p>warm".length) {
    const r = await reader.read();
    if (r.done) break;
    if (r.value) buf += decoder.decode(r.value, { stream: true });
  }
  // Yield to let the generator advance past `usage` and into the gate.
  await new Promise<void>((resolve) => setTimeout(resolve, 20));

  assert.equal(
    debit.calls.length,
    1,
    `expected 1 debit before cancel, got ${debit.calls.length}`,
  );

  controller.abort();

  // Drain.
  while (true) {
    const r = await reader.read();
    if (r.done) break;
  }
  reader.releaseLock();
  const summary = await done;

  assert.equal(summary.stopKind, "cancelled");
  assert.equal(debit.calls.length, 1, "no double debit on cancel");
  assert.equal(
    summary.creditsDebited,
    debit.calls[0].amount,
    "summary credit count matches the single debit",
  );
  assert.deepEqual(summary.usage, { inputTokens: 50, outputTokens: 100 });

  gate.resolve();
});

// ─── Error paths ───────────────────────────────────────────────────────────

test("auth error: provider throws → stream errors, no debit", async () => {
  const debit = spyDebit();
  const provider: PageStreamProvider = {
    stream() {
      return (async function* (): AsyncIterableIterator<StreamEvent> {
        throw new Error("401: auth failed");
        // eslint-disable-next-line no-unreachable
        yield { type: "done", stopReason: { kind: "end_turn" } };
      })();
    },
  };

  const { stream, done } = generateHtmlStream(baseOpts(), {
    provider,
    debit: debit.fn,
    makeHtmlStream: (o) => new PassthroughHtmlStream(o),
  });

  let streamErr: unknown = null;
  try {
    await readAll(stream);
  } catch (e) {
    streamErr = e;
  }
  const summary = await done;

  assert.ok(streamErr instanceof Error, "stream surfaces the auth error");
  assert.match((streamErr as Error).message, /auth failed/);
  assert.equal(summary.stopKind, "error");
  assert.equal(summary.error?.message, "401: auth failed");
  assert.equal(summary.finalHtml, null);
  assert.equal(debit.calls.length, 0, "no debit on auth error");
  assert.equal(summary.creditsDebited, 0);
});

test("done { kind: 'error' }: stream errors with provider message, no debit", async () => {
  const debit = spyDebit();
  const provider = scriptedProvider([
    { type: "text_delta", text: "<p>partial" },
    { type: "done", stopReason: { kind: "error", error: "SSE malformed" } },
  ]);

  const { stream, done } = generateHtmlStream(baseOpts(), {
    provider,
    debit: debit.fn,
    makeHtmlStream: (o) => new PassthroughHtmlStream(o),
  });

  let streamErr: unknown = null;
  try {
    await readAll(stream);
  } catch (e) {
    streamErr = e;
  }
  const summary = await done;

  assert.ok(streamErr instanceof Error);
  assert.match((streamErr as Error).message, /SSE malformed/);
  assert.equal(summary.stopKind, "error");
  assert.equal(debit.calls.length, 0);
});

test("HtmlStream.write throws (slot-path) → stream errors, no further chunks", async () => {
  const debit = spyDebit();
  const provider = scriptedProvider([
    { type: "text_delta", text: '<div data-slot-path="x">' },
    { type: "text_delta", text: "more" },
    { type: "usage", inputTokens: 1, outputTokens: 1, cachedTokens: 0, thinkingTokens: 0 },
    { type: "done", stopReason: { kind: "end_turn" } },
  ]);

  const { stream, done } = generateHtmlStream(baseOpts(), {
    provider,
    debit: debit.fn,
    makeHtmlStream: () => new ThrowingHtmlStream(),
  });

  let streamErr: unknown = null;
  try {
    await readAll(stream);
  } catch (e) {
    streamErr = e;
  }
  const summary = await done;

  assert.ok(streamErr instanceof Error);
  assert.match((streamErr as Error).message, /data-slot-path/);
  assert.equal(summary.stopKind, "error");
  assert.equal(summary.finalHtml, null);
  assert.equal(debit.calls.length, 0);
});

// ─── Best-effort credit accounting ────────────────────────────────────────

test("un blip en el débito se reintenta y el crédito SÍ se cobra", async () => {
  // Antes, un solo rechazo del UPDATE dejaba la página entregada y el cargo
  // en cero, con un log que prometía reconciliarlo «via the ledger» — un
  // ledger que nunca existió. Se reintenta una vez: es una fila, no hay
  // estado que reconciliar.
  const debit = failingDebit(1);
  const provider = scriptedProvider([
    { type: "text_delta", text: "<p>x</p>" },
    { type: "usage", inputTokens: 10, outputTokens: 10, cachedTokens: 0, thinkingTokens: 0 },
    { type: "text_delta", text: "<p>y</p>" },
    { type: "done", stopReason: { kind: "end_turn" } },
  ]);

  // Silence the expected console.error so test output stays clean.
  const origErr = console.error;
  const logged: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    logged.push(args);
  };

  try {
    const { stream, done } = generateHtmlStream(baseOpts(), {
      provider,
      debit: debit.fn,
      makeHtmlStream: (o) => new PassthroughHtmlStream(o),
    });
    const out = await readAll(stream);
    const summary = await done;

    assert.equal(out, "<p>x</p><p>y</p>", "stream completes despite debit failure");
    assert.equal(summary.stopKind, "end_turn");
    assert.equal(summary.error, null);
    assert.equal(debit.calls.length, 2, "se reintenta exactamente una vez");
    assert.ok(summary.creditsDebited >= 1, "el segundo intento SÍ cobra");
    assert.equal(logged.length, 0, "un blip que se recupera no ensucia el log");
  } finally {
    console.error = origErr;
  }
});

test("un débito que falla SIEMPRE se registra y no rompe el stream", async () => {
  const debit = failingDebit(99);
  const provider = scriptedProvider([
    { type: "text_delta", text: "<p>x</p>" },
    { type: "usage", inputTokens: 10, outputTokens: 10, cachedTokens: 0, thinkingTokens: 0 },
    { type: "done", stopReason: { kind: "end_turn" } },
  ]);

  const origErr = console.error;
  const logged: unknown[][] = [];
  console.error = (...args: unknown[]) => { logged.push(args); };

  try {
    const { stream, done } = generateHtmlStream(baseOpts(), {
      provider,
      debit: debit.fn,
      makeHtmlStream: (o) => new PassthroughHtmlStream(o),
    });
    const out = await readAll(stream);
    const summary = await done;

    // La página ya está a medio dibujar en la pantalla del usuario: tumbarla
    // por la contabilidad sería peor que servirla.
    assert.equal(out, "<p>x</p>");
    assert.equal(summary.error, null);
    assert.equal(debit.calls.length, 2, "dos intentos, no más");
    assert.equal(summary.creditsDebited, 0);
    assert.ok(
      logged.some((args) =>
        args.some((a) => typeof a === "string" && a.includes("débito fallido tras 2 intentos")),
      ),
      "el fallo definitivo tiene que quedar registrado",
    );
  } finally {
    console.error = origErr;
  }
});

// ─── Una página entregada NUNCA sale a cero ───────────────────────────────
// 🔴 EL DEFECTO QUE ESTO CIERRA (hallazgo 16). El cargo colgaba entero del
// evento `usage`, que el contrato del adaptador trata como OPCIONAL. Un
// proveedor que cierra sin mandarlo entregaba el documento COMPLETO con
// creditsDebited: 0 y sin rastro.

test("página entregada sin evento `usage` cobra el suelo de 1 crédito", async () => {
  const debit = spyDebit();
  const provider = scriptedProvider([
    { type: "text_delta", text: "<p>una página entera</p>" },
    { type: "done", stopReason: { kind: "end_turn" } },
  ]);

  const origWarn = console.warn;
  console.warn = () => {};
  try {
    const { stream, done } = generateHtmlStream(baseOpts(), {
      provider,
      debit: debit.fn,
      makeHtmlStream: (o) => new PassthroughHtmlStream(o),
    });
    await readAll(stream);
    const summary = await done;

    assert.equal(summary.usage, null, "el proveedor nunca mandó usage");
    assert.ok(summary.finalHtml, "y aun así se entregó la página");
    assert.equal(debit.calls.length, 1);
    assert.equal(debit.calls[0].amount, 1, "el suelo: lo que cuesta una página");
    assert.equal(summary.creditsDebited, 1);
  } finally {
    console.warn = origWarn;
  }
});

test("con `usage`, el suelo NO se cobra encima — se cobra lo medido y ya", async () => {
  const debit = spyDebit();
  const provider = scriptedProvider([
    { type: "text_delta", text: "<p>x</p>" },
    { type: "usage", inputTokens: 12, outputTokens: 34, cachedTokens: 0, thinkingTokens: 0 },
    { type: "done", stopReason: { kind: "end_turn" } },
  ]);

  const { stream, done } = generateHtmlStream(baseOpts(), {
    provider,
    debit: debit.fn,
    makeHtmlStream: (o) => new PassthroughHtmlStream(o),
  });
  await readAll(stream);
  const summary = await done;

  assert.equal(debit.calls.length, 1, "un solo cargo, el de siempre");
  assert.equal(summary.creditsDebited, debit.calls[0].amount);
});

test("cancelar antes de `usage` sigue siendo GRATIS — el suelo no lo toca", async () => {
  // Política deliberada y sin cambios: sin página no hay cargo.
  const debit = spyDebit();
  const provider = scriptedProvider([
    { type: "text_delta", text: "<p>a medias</p>" },
    { type: "done", stopReason: { kind: "cancelled" } },
  ]);

  const { stream, done } = generateHtmlStream(baseOpts(), {
    provider,
    debit: debit.fn,
    makeHtmlStream: (o) => new PassthroughHtmlStream(o),
  });
  await readAll(stream);
  const summary = await done;

  assert.equal(summary.stopKind, "cancelled");
  assert.equal(summary.finalHtml, null);
  assert.equal(debit.calls.length, 0, "sin página, sin cargo");
  assert.equal(summary.creditsDebited, 0);
});

// ─── Done promise never rejects ───────────────────────────────────────────

test("done promise resolves (never rejects) even on errors", async () => {
  const provider: PageStreamProvider = {
    stream() {
      return (async function* (): AsyncIterableIterator<StreamEvent> {
        throw new Error("boom");
      })();
    },
  };

  const { stream, done } = generateHtmlStream(baseOpts(), {
    provider,
    debit: spyDebit().fn,
    makeHtmlStream: (o) => new PassthroughHtmlStream(o),
  });

  // Trigger the stream to consume the iterator.
  await readAll(stream).catch(() => {});

  // `done` must resolve, not reject.
  const summary: GenerateHtmlStreamSummary = await done;
  assert.equal(summary.stopKind, "error");
  assert.equal(summary.error?.message, "boom");
});

// ── Bypass de /api/generate (bug 2026-07-29) ────────────────────────────────
// El pipeline de streaming sanitiza para el PREVIEW con dos huecos frente a
// la puerta síncrona: borra el <script>tailwind.config…</script> del modelo
// (la paleta muere antes de extractTwConfig) y whitelistea CUALQUIER
// <script data-ol-*> por prefijo (prompt-injection → DB → iframe del editor).
// done.finalHtml debe salir con el MISMO contrato que las demás puertas.
// Estos tests usan el HtmlStream REAL (binding napi); solo provider y debit
// son fakes.

const REAL_DOC_OPEN =
  '<!doctype html><html><head><meta charset="utf-8"><title>t</title><script src="https://cdn.tailwindcss.com"></script>';

// INVERTIDA el 2026-08-26. Fijaba que la paleta sobreviviera **como carrier
// nuestro**: el saneador mataba el `<script>tailwind.config…</script>` del
// modelo y nosotros extraíamos la paleta antes y la re-inyectábamos después.
// Tres pasos para deshacer un cuarto.
//
// Lo que había que clavar era el OBJETIVO —que la paleta no se pierda—, no el
// mecanismo. Ahora `/api/generate` corre con `sanitize: false` (es nuestro
// generador) y el script del modelo sobrevive tal cual, que es como funciona
// Tailwind en cualquier página del mundo. Misma promesa, sin la maquinaria.
test("la paleta del modelo sobrevive — en SU propio script, sin carrier", async () => {
  const debit = spyDebit();
  const provider = scriptedProvider([
    { type: "text_delta", text: REAL_DOC_OPEN },
    {
      type: "text_delta",
      text: "<script>tailwind.config = {theme:{extend:{colors:{blood:{400:'#f87171',500:'#ef4444'}}}}}</script>",
    },
    {
      type: "text_delta",
      text: '</head><body><span class="text-blood-500">x</span></body></html>',
    },
    { type: "usage", inputTokens: 10, outputTokens: 20, cachedTokens: 0, thinkingTokens: 0 },
    { type: "done", stopReason: { kind: "end_turn" } },
  ]);
  const { stream, done } = generateHtmlStream(
    {
      messages: [{ role: "user", content: "b" }],
      userId: "u",
      // Lo MISMO que manda app/api/generate/route.ts. Sin esto la prueba mide
      // un camino que producción ya no recorre.
      htmlOpts: { sanitize: false },
    },
    { provider, debit: debit.fn },
  );
  await readAll(stream);
  const summary = await done;
  assert.equal(summary.stopKind, "end_turn");
  assert.ok(summary.finalHtml, "finalHtml presente");
  assert.ok(summary.finalHtml!.includes("blood"), "la paleta se perdió");
  assert.ok(
    /tailwind\s*\.\s*config/.test(summary.finalHtml!),
    "el script de config del modelo NO sobrevivió",
  );
  // Y no hay DOS configs: el carrier sólo se injerta cuando no hay ninguna.
  assert.ok(
    !summary.finalHtml!.includes("data-ol-tw"),
    "se injertó el carrier encima de la config del modelo — dos configs",
  );
});

test("bypass: un <script data-ol-*> forjado por el modelo NO llega al finalHtml", async () => {
  const debit = spyDebit();
  const provider = scriptedProvider([
    { type: "text_delta", text: REAL_DOC_OPEN },
    {
      type: "text_delta",
      text: '<script data-ol-pwn>window.__pwn=1</script></head><body><p class="p-4">x</p></body></html>',
    },
    { type: "usage", inputTokens: 10, outputTokens: 20, cachedTokens: 0, thinkingTokens: 0 },
    { type: "done", stopReason: { kind: "end_turn" } },
  ]);
  const { stream, done } = generateHtmlStream(
    { messages: [{ role: "user", content: "b" }], userId: "u" },
    { provider, debit: debit.fn },
  );
  await readAll(stream);
  const summary = await done;
  assert.equal(summary.stopKind, "end_turn");
  assert.ok(summary.finalHtml);
  assert.ok(!summary.finalHtml!.includes("__pwn"), "script forjado muerto");
  assert.ok(
    summary.finalHtml!.includes("<script data-ol-radius>"),
    "los scripts CANÓNICOS del tema siguen (reparados por el wrapper)",
  );
  assert.ok(summary.finalHtml!.includes("cdn.tailwindcss.com"), "CDN intacto");
});

test("bypass: sin config del modelo no se inventa carrier y el doc queda canónico", async () => {
  const debit = spyDebit();
  const provider = scriptedProvider([
    { type: "text_delta", text: REAL_DOC_OPEN },
    { type: "text_delta", text: '</head><body><p class="p-4">x</p></body></html>' },
    { type: "usage", inputTokens: 5, outputTokens: 5, cachedTokens: 0, thinkingTokens: 0 },
    { type: "done", stopReason: { kind: "end_turn" } },
  ]);
  const { stream, done } = generateHtmlStream(
    { messages: [{ role: "user", content: "b" }], userId: "u" },
    { provider, debit: debit.fn },
  );
  await readAll(stream);
  const summary = await done;
  assert.ok(summary.finalHtml);
  assert.ok(!summary.finalHtml!.includes("data-ol-tw"), "sin carrier fantasma");
});

// Quién escribe la página. La medición que motivó el cambio está en el
// comentario de `pageWriterUsesDeepSeek`; esto sólo fija las reglas.
test("el escritor por defecto es el razonador", () => {
  assert.equal(pageWriterUsesDeepSeek(false), true);
});

// El papel que razona en Fireworks no tiene visión: una referencia que el
// modelo no ve es peor que no haberla pedido. La lleva Qwen.
test("una imagen de referencia saca el turno del razonador", () => {
  assert.equal(pageWriterUsesDeepSeek(true), false);
});

// LA LÁPIDA DEL INTERRUPTOR. Aquí había un caso
// —«OPENLEN_GENERATE_PROVIDER=gemini vuelve atrás»— que pasaba el entorno como
// primer argumento. Hoy `pageWriterUsesDeepSeek` sólo pregunta si el turno
// lleva imágenes.
//
// Se comprueba por COMPORTAMIENTO, no por aridad. Lo primero que escribí aquí
// fue `assert.equal(pageWriterUsesDeepSeek.length, 1)` y salió rojo: un
// parámetro CON valor por defecto no cuenta para `Function.length`, así que la
// prueba medía un número que no significaba lo que yo creía. Poner el valor que
// antes desviaba el turno y ver que no pasa nada sí lo significa.
test("ninguna variable de entorno puede desviar el turno", () => {
  const previo = process.env.OPENLEN_GENERATE_PROVIDER;
  process.env.OPENLEN_GENERATE_PROVIDER = "gemini";
  try {
    assert.equal(pageWriterUsesDeepSeek(false), true);
    assert.equal(pageWriterUsesDeepSeek(true), false);
  } finally {
    if (previo === undefined) delete process.env.OPENLEN_GENERATE_PROVIDER;
    else process.env.OPENLEN_GENERATE_PROVIDER = previo;
  }
});

// ── El código del modelo ES el código (2026-08-26) ──────────────────────────
//
// Hasta hoy `canonicalizeFinalHtml` pasaba la salida del modelo por
// `sanitizeForPublish` — el MISMO contrato que el HTML que pega un
// desconocido. Le borraba sus `<script>`, sus `on*` y sus iframes, y de ahí
// salió toda la maquinaria posterior: la cápsula con hash para devolverle el
// JavaScript por una puerta lateral, el interruptor, y los módulos que
// reimplementaban a mano lo que hace un `<script>`.
//
// Ahora sólo se le aplica la puerta que vale para TODO el mundo, nosotros
// incluidos: `data-slot-path`, que es un marcador reservado del editor y no
// puede llegar al disco venga de donde venga.

test("el <script> que escribe el modelo SOBREVIVE hasta el HTML guardado", async () => {
  const debit = spyDebit();
  const CODIGO = 'document.getElementById("b").addEventListener("click",function(){window.__VIVO__=1});';
  const provider = scriptedProvider([
    { type: "start", id: "msg-1" },
    { type: "text_delta", text: "<!doctype html><html><body><button id=b>x</button>" },
    { type: "text_delta", text: `<script>${CODIGO}</script></body></html>` },
    { type: "usage", inputTokens: 1, outputTokens: 1, cachedTokens: 0, thinkingTokens: 0 },
    { type: "done", stopReason: { kind: "end_turn" } },
  ]);

  const { stream, done } = generateHtmlStream(baseOpts(), {
    provider,
    debit: debit.fn,
    makeHtmlStream: (o) => new PassthroughHtmlStream(o),
  });
  await readAll(stream);
  const summary = await done;

  assert.ok(
    summary.finalHtml?.includes(CODIGO),
    "el generador se saneó a sí mismo y le borró el script al modelo",
  );
});

test("y también sus manejadores on* — el contrato es el documento entero", async () => {
  const debit = spyDebit();
  const provider = scriptedProvider([
    { type: "start", id: "msg-1" },
    { type: "text_delta", text: '<!doctype html><html><body><button onclick="abrir()">x</button></body></html>' },
    { type: "usage", inputTokens: 1, outputTokens: 1, cachedTokens: 0, thinkingTokens: 0 },
    { type: "done", stopReason: { kind: "end_turn" } },
  ]);

  const { stream, done } = generateHtmlStream(baseOpts(), {
    provider,
    debit: debit.fn,
    makeHtmlStream: (o) => new PassthroughHtmlStream(o),
  });
  await readAll(stream);
  const summary = await done;

  assert.ok(summary.finalHtml?.includes("onclick"), "se le borró el manejador");
});

// PERO LA PUERTA QUE IMPORTA SIGUE PUESTA. `data-slot-path=` es un marcador
// reservado del modo editor: si llega al disco o a la base, el documento
// publicado lleva instrumentación del editor dentro. Es invariante de
// arquitectura y no admite excepción por procedencia — ni la nuestra.
test("CONTRA-PRUEBA: data-slot-path en la salida del modelo TUMBA la generación", async () => {
  const debit = spyDebit();
  const provider = scriptedProvider([
    { type: "start", id: "msg-1" },
    { type: "text_delta", text: '<!doctype html><html><body><div data-slot-path="hero.title">x</div></body></html>' },
    { type: "usage", inputTokens: 1, outputTokens: 1, cachedTokens: 0, thinkingTokens: 0 },
    { type: "done", stopReason: { kind: "end_turn" } },
  ]);

  const { stream, done } = generateHtmlStream(baseOpts(), {
    provider,
    debit: debit.fn,
    makeHtmlStream: (o) => new PassthroughHtmlStream(o),
  });
  await readAll(stream);
  const summary = await done;

  assert.equal(summary.finalHtml, null, "el marcador reservado se coló");
  assert.ok(
    String(summary.error ?? "").includes("data-slot-path"),
    `el error no dice por qué: ${String(summary.error)}`,
  );
});
