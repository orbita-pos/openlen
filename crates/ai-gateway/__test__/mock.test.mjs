// Node-side mock tests for the GeminiStream binding. These mirror the
// high-value cases from `tests/mock.rs` (Rust-side) so the JS surface is
// exercised end-to-end: real Node, real `.node` binary, real HTTP, real
// CancellationToken plumbing through napi.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createServer } from "node:http";

import { GeminiProvider } from "../index.js";

// ─── Mock server helpers ───────────────────────────────────────────────────

/**
 * Spin up a one-shot HTTP server with a fixed response. The handler runs
 * synchronously, writes the SSE body in one or several chunks, and
 * optionally holds the connection open for `holdMs` ms before ending it.
 *
 * Returns `{ baseUrl, close }`. Always call `close()` in the test's
 * finally block.
 */
function serveOne({ status = 200, headers = {}, sseBody = "", chunks = null, holdMs = 0 }) {
  const server = createServer((req, res) => {
    const finalHeaders = {
      "Content-Type": "text/event-stream",
      ...headers,
    };
    res.writeHead(status, finalHeaders);
    if (chunks) {
      let i = 0;
      const tick = () => {
        if (i >= chunks.length) {
          if (holdMs > 0) setTimeout(() => res.end(), holdMs);
          else res.end();
          return;
        }
        res.write(chunks[i++]);
        setImmediate(tick);
      };
      tick();
    } else {
      res.write(sseBody);
      if (holdMs > 0) setTimeout(() => res.end(), holdMs);
      else res.end();
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise((res) => {
            server.closeAllConnections();
            server.close(() => res());
          }),
      });
    });
  });
}

function smallRequest() {
  return {
    model: "gemini-2.5-flash",
    messages: [{ role: "user", content: "hi" }],
  };
}

async function collectEvents(stream) {
  const events = [];
  for await (const ev of asyncIter(stream)) events.push(ev);
  return events;
}

// Wrap GeminiStream in a JS async-iterator so `for await` works.
async function* asyncIter(stream) {
  try {
    while (true) {
      const ev = await stream.next();
      if (ev === null) return;
      yield ev;
    }
  } finally {
    stream.cancel();
  }
}

function tryParseEnvelope(err) {
  try {
    const parsed = JSON.parse(err.message);
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    /* fall through */
  }
  return null;
}

// ─── Happy path ───────────────────────────────────────────────────────────

test("happy path: start → text_delta → usage → done", async () => {
  const sse =
    'data: {"candidates":[{"content":{"parts":[{"text":"Hel"}]}}]}\n\n' +
    'data: {"candidates":[{"content":{"parts":[{"text":"lo"}]}}]}\n\n' +
    'data: {"candidates":[{"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":3,"candidatesTokenCount":2,"thoughtsTokenCount":7}}\n\n';
  const server = await serveOne({ status: 200, sseBody: sse });
  try {
    const p = new GeminiProvider("k", server.baseUrl);
    const events = await collectEvents(p.stream(smallRequest()));

    const types = events.map((e) => e.type);
    assert.deepEqual(
      types.slice(0, 1),
      ["start"],
      "first event must be start",
    );
    assert.equal(types.at(-1), "done", "last event must be done");
    assert.ok(types.includes("usage"), "expected a usage event");

    const text = events
      .filter((e) => e.type === "text_delta")
      .map((e) => e.text)
      .join("");
    assert.equal(text, "Hello");

    const usage = events.find((e) => e.type === "usage");
    assert.equal(usage.inputTokens, 3);
    assert.equal(usage.outputTokens, 2);
    assert.equal(usage.thinkingTokens, 7);

    const done = events.find((e) => e.type === "done");
    assert.equal(done.stopReason.kind, "end_turn");
  } finally {
    await server.close();
  }
});

// ─── Error mapping ────────────────────────────────────────────────────────

test("401 maps to GatewayError-envelope with kind=auth, retryable=false", async () => {
  const server = await serveOne({
    status: 401,
    headers: { "Content-Type": "application/json" },
    sseBody: '{"error":"no key"}',
  });
  try {
    const p = new GeminiProvider("", server.baseUrl);
    await assert.rejects(collectEvents(p.stream(smallRequest())), (err) => {
      const env = tryParseEnvelope(err);
      assert.ok(env, `expected envelope error, got: ${err}`);
      assert.equal(env.kind, "auth");
      assert.equal(env.retryable, false);
      return true;
    });
  } finally {
    await server.close();
  }
});

test("429 carries retry-after envelope", async () => {
  const server = await serveOne({
    status: 429,
    headers: { "Retry-After": "30", "Content-Type": "application/json" },
    sseBody: '{"error":"slow down"}',
  });
  try {
    const p = new GeminiProvider("k", server.baseUrl);
    await assert.rejects(collectEvents(p.stream(smallRequest())), (err) => {
      const env = tryParseEnvelope(err);
      assert.ok(env, `expected envelope error, got: ${err}`);
      assert.equal(env.kind, "rate_limited");
      assert.equal(env.retryable, true);
      assert.equal(env.retryAfterMs, 30_000);
      return true;
    });
  } finally {
    await server.close();
  }
});

test("500 maps to retryable api error", async () => {
  const server = await serveOne({
    status: 500,
    headers: { "Content-Type": "text/plain" },
    sseBody: "boom",
  });
  try {
    const p = new GeminiProvider("k", server.baseUrl);
    await assert.rejects(collectEvents(p.stream(smallRequest())), (err) => {
      const env = tryParseEnvelope(err);
      assert.ok(env);
      assert.equal(env.kind, "api");
      assert.equal(env.retryable, true);
      return true;
    });
  } finally {
    await server.close();
  }
});

// ─── Cancellation timing ─────────────────────────────────────────────────

test("cancel mid-stream yields Done{cancelled} within 500ms", async () => {
  // Send the first delta, then hold the connection for 30s (effectively
  // forever for this test). The cancel must propagate well under that.
  const chunks = [
    'data: {"candidates":[{"content":{"parts":[{"text":"Hi"}]}}]}\n\n',
  ];
  const server = await serveOne({
    status: 200,
    sseBody: "",
    chunks,
    holdMs: 30_000,
  });
  try {
    const p = new GeminiProvider("k", server.baseUrl);
    const stream = p.stream(smallRequest());

    // Pull events until we see the first text_delta, then fire cancel
    // and time the wait for the terminal Done event.
    const collected = [];
    let firstDeltaAt = 0;
    let cancelAt = 0;
    let doneAt = 0;
    for await (const ev of asyncIter(stream)) {
      collected.push(ev);
      if (ev.type === "text_delta" && cancelAt === 0) {
        firstDeltaAt = Date.now();
        cancelAt = Date.now();
        stream.cancel();
      }
      if (ev.type === "done") {
        doneAt = Date.now();
      }
    }

    assert.ok(firstDeltaAt > 0, "must have received at least one delta");
    const done = collected.find((e) => e.type === "done");
    assert.ok(done, "must have received a done event");
    assert.equal(done.stopReason.kind, "cancelled");
    const elapsedMs = doneAt - cancelAt;
    assert.ok(
      elapsedMs < 500,
      `cancel propagation must be < 500ms (was ${elapsedMs}ms)`,
    );
  } finally {
    await server.close();
  }
});

test("cancel before first next() yields synthetic Done{cancelled}", async () => {
  // Mock server is never even hit — cancel is fired before the iterator
  // starts. The binding synthesises a single Done event.
  const server = await serveOne({
    status: 200,
    sseBody: "",
    holdMs: 30_000,
  });
  try {
    const p = new GeminiProvider("k", server.baseUrl);
    const stream = p.stream(smallRequest());
    stream.cancel();

    const t0 = Date.now();
    const events = await collectEvents(stream);
    const elapsed = Date.now() - t0;

    assert.equal(events.length, 1, "expected exactly one terminal event");
    assert.equal(events[0].type, "done");
    assert.equal(events[0].stopReason.kind, "cancelled");
    assert.ok(elapsed < 500, `pre-start cancel must complete < 500ms (was ${elapsed}ms)`);
  } finally {
    await server.close();
  }
});

test("AbortSignal aborts the stream (web-standard cancel path)", async () => {
  const chunks = [
    'data: {"candidates":[{"content":{"parts":[{"text":"Hi"}]}}]}\n\n',
  ];
  const server = await serveOne({
    status: 200,
    chunks,
    holdMs: 30_000,
  });
  try {
    const p = new GeminiProvider("k", server.baseUrl);
    const stream = p.stream(smallRequest());
    const controller = new AbortController();
    controller.signal.addEventListener("abort", () => stream.cancel(), {
      once: true,
    });

    const collected = [];
    let abortAt = 0;
    let doneAt = 0;
    for await (const ev of asyncIter(stream)) {
      collected.push(ev);
      if (ev.type === "text_delta" && abortAt === 0) {
        abortAt = Date.now();
        controller.abort();
      }
      if (ev.type === "done") doneAt = Date.now();
    }
    const done = collected.find((e) => e.type === "done");
    assert.ok(done);
    assert.equal(done.stopReason.kind, "cancelled");
    assert.ok(doneAt - abortAt < 500, `abort → done was ${doneAt - abortAt}ms`);
  } finally {
    await server.close();
  }
});

// ─── Finish reason mapping ────────────────────────────────────────────────

test("MAX_TOKENS finishReason maps to stopReason=max_tokens", async () => {
  const sse =
    'data: {"candidates":[{"content":{"parts":[{"text":"abc"}]}},{"finishReason":"MAX_TOKENS"}]}\n\n';
  const server = await serveOne({ status: 200, sseBody: sse });
  try {
    const p = new GeminiProvider("k", server.baseUrl);
    const events = await collectEvents(p.stream(smallRequest()));
    const done = events.find((e) => e.type === "done");
    assert.equal(done.stopReason.kind, "max_tokens");
  } finally {
    await server.close();
  }
});

test("SAFETY finishReason maps to stopReason=error with payload", async () => {
  const sse =
    'data: {"candidates":[{"finishReason":"SAFETY"}]}\n\n';
  const server = await serveOne({ status: 200, sseBody: sse });
  try {
    const p = new GeminiProvider("k", server.baseUrl);
    const events = await collectEvents(p.stream(smallRequest()));
    const done = events.find((e) => e.type === "done");
    assert.equal(done.stopReason.kind, "error");
    assert.match(done.stopReason.error, /SAFETY/);
  } finally {
    await server.close();
  }
});
