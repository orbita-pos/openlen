import { test } from "node:test";
import { strict as assert } from "node:assert";

import {
  GeminiProvider,
  estimateTokens,
} from "../index.js";

// -- estimateTokens free function ------------------------------------------

test("estimateTokens returns 0 for empty string", () => {
  assert.equal(estimateTokens(""), 0);
});

test("estimateTokens rounds chars/4 up to integers", () => {
  assert.equal(estimateTokens("a"), 1); // 1/4 → 1
  assert.equal(estimateTokens("abcd"), 1); // 4/4 → 1
  assert.equal(estimateTokens("abcde"), 2); // 5/4 → 2
  assert.equal(estimateTokens("123456789"), 3); // 9/4 → 3
});

test("estimateTokens counts unicode scalars, not utf8 bytes", () => {
  // 4 emoji = 4 chars (Unicode) = 1 token, regardless of utf-8 byte length.
  assert.equal(estimateTokens("🦀🦀🦀🦀"), 1);
});

// -- GeminiProvider constructor + sync surface -----------------------------

test("GeminiProvider constructs without throwing on empty key", () => {
  const p = new GeminiProvider("");
  assert.ok(p, "expected a provider instance");
});

test("GeminiProvider accepts optional baseUrl", () => {
  const p = new GeminiProvider("k", "http://127.0.0.1:9999");
  assert.ok(p);
});

test("estimateInputTokens sums per-message estimates", () => {
  const p = new GeminiProvider("");
  const n = p.estimateInputTokens([
    { role: "system", content: "abcd" }, // 1
    { role: "user", content: "abcdefgh" }, // 2
    { role: "assistant", content: "" }, // 0
  ]);
  assert.equal(n, 3);
});

test("estimateInputTokens rejects unknown role with a helpful message", () => {
  const p = new GeminiProvider("");
  assert.throws(
    () =>
      p.estimateInputTokens([
        { role: "model", content: "hi" },
      ]),
    /invalid role/i,
  );
});

// -- stream() construction (no network yet) --------------------------------

test("stream() returns a GeminiStream instance immediately", () => {
  // No network — the stream is constructed but the POST hasn't fired.
  // cancel() before any next() is the synthesised-Done path.
  const p = new GeminiProvider("k", "http://127.0.0.1:1"); // unreachable on purpose
  const s = p.stream({
    model: "gemini-2.5-flash",
    messages: [{ role: "user", content: "hi" }],
  });
  assert.equal(typeof s.next, "function");
  assert.equal(typeof s.cancel, "function");
  // Cancel before any next() — drops the construction without hitting the network.
  s.cancel();
});

test("stream() rejects malformed messages eagerly", () => {
  const p = new GeminiProvider("");
  assert.throws(
    () =>
      p.stream({
        model: "gemini-2.5-flash",
        messages: [{ role: "robot", content: "hi" }],
      }),
    /invalid role/i,
  );
});
