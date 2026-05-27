// Live tests against real Gemini. Skipped unless GEMINI_API_KEY is set;
// each run spends roughly $0.0005 of Flash quota total. Mirrors the
// Rust-side `tests/gemini_live.rs` gates.

import { test } from "node:test";
import { strict as assert } from "node:assert";

import { GeminiProvider } from "../index.js";

const API_KEY = process.env.GEMINI_API_KEY;

test("live: mini prompt completes with text + usage + done", { skip: !API_KEY }, async () => {
  const p = new GeminiProvider(API_KEY);
  const events = [];
  // 256-token output budget — the F3 S1 post-fix proved that anything
  // below ~128 is unsafe with 2.5 Flash's internal thinking budget;
  // we use 256 to stay well clear.
  for await (const ev of asyncIter(
    p.stream({
      model: "gemini-2.5-flash",
      messages: [
        { role: "user", content: "Reply with exactly the word ack and nothing else." },
      ],
      maxOutputTokens: 256,
      temperature: 0,
    }),
  )) {
    events.push(ev);
  }

  const text = events
    .filter((e) => e.type === "text_delta")
    .map((e) => e.text)
    .join("");
  assert.ok(text.length > 0, `expected non-empty output, got: ${JSON.stringify(text)}`);

  const usage = events.find((e) => e.type === "usage");
  assert.ok(usage, "expected a usage event");
  assert.ok(usage.inputTokens > 0);
  assert.ok(usage.outputTokens > 0);

  const done = events.find((e) => e.type === "done");
  assert.ok(done);
  assert.ok(
    ["end_turn", "max_tokens"].includes(done.stopReason.kind),
    `unexpected stopReason ${JSON.stringify(done.stopReason)}`,
  );
});

test("live: cancel mid-stream via AbortSignal kills the upstream <500ms", { skip: !API_KEY }, async () => {
  const p = new GeminiProvider(API_KEY);
  const stream = p.stream({
    model: "gemini-2.5-flash",
    // Longish prompt so we definitely see at least one text_delta
    // before the model finishes its budget.
    messages: [
      { role: "user", content: "Write a 100-word paragraph about the sea." },
    ],
    maxOutputTokens: 512,
    temperature: 0.7,
  });
  const controller = new AbortController();
  controller.signal.addEventListener("abort", () => stream.cancel(), {
    once: true,
  });

  const events = [];
  let abortAt = 0;
  let doneAt = 0;
  for await (const ev of asyncIter(stream)) {
    events.push(ev);
    if (ev.type === "text_delta" && abortAt === 0) {
      abortAt = Date.now();
      controller.abort();
    }
    if (ev.type === "done") doneAt = Date.now();
  }
  const done = events.find((e) => e.type === "done");
  assert.ok(done, "expected a done event");
  assert.equal(done.stopReason.kind, "cancelled");
  const elapsed = doneAt - abortAt;
  assert.ok(
    elapsed < 500,
    `cancel propagation must be <500ms against live Gemini (was ${elapsed}ms)`,
  );
});

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
