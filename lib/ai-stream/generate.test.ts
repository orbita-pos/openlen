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
  type GeminiProviderLike,
  type DebitFn,
  type HtmlStreamLike,
  type GenerateHtmlStreamSummary,
} from "./generate";
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

function scriptedProvider(script: ScriptEntry[]): GeminiProviderLike {
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
    { type: "usage", inputTokens: 12, outputTokens: 34 },
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
    { type: "usage", inputTokens: 1000, outputTokens: 1000 },
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
  // Flash is cheaper than Pro: same usage → fewer credits. Pro at
  // (1k input + 1k output) tokens = ~$0.01125 = ~2 credits;
  // Flash at the same volume = ~$0.0028 = 1 credit.
  assert.equal(debit.calls[0].amount, 1, "Flash rate produces 1 credit");
});

test("max_tokens stop reason still calls end() and resolves with final HTML", async () => {
  const debit = spyDebit();
  const provider = scriptedProvider([
    { type: "text_delta", text: "<div>truncated" },
    { type: "usage", inputTokens: 50, outputTokens: 200 },
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
    { type: "usage", inputTokens: 10, outputTokens: 20 }, // never reached
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
    { type: "usage", inputTokens: 10, outputTokens: 20 },
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
    { type: "usage", inputTokens: 1, outputTokens: 2 },
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
    { type: "usage", inputTokens: 50, outputTokens: 100 },
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
  const provider: GeminiProviderLike = {
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
    { type: "usage", inputTokens: 1, outputTokens: 1 },
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

test("debit failure logs but does NOT break the stream", async () => {
  const debit = failingDebit(1);
  const provider = scriptedProvider([
    { type: "text_delta", text: "<p>x</p>" },
    { type: "usage", inputTokens: 10, outputTokens: 10 },
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
    assert.equal(summary.creditsDebited, 0, "no credits recorded when debit threw");
    assert.equal(debit.calls.length, 1, "debit was attempted once");
    assert.ok(
      logged.some((args) =>
        args.some(
          (a) => typeof a === "string" && a.includes("credit debit failed"),
        ),
      ),
      "debit failure must be logged",
    );
  } finally {
    console.error = origErr;
  }
});

// ─── Done promise never rejects ───────────────────────────────────────────

test("done promise resolves (never rejects) even on errors", async () => {
  const provider: GeminiProviderLike = {
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
