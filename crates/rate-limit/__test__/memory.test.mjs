// Node smoke tests for the memory backend of the @openlen/rate-limit
// napi class. Mirrors the high-value cases from `bucket::tests` so the
// JS surface is exercised end-to-end: real `.node` binary, real
// napi-rs marshalling, real DashMap.

import { test } from "node:test";
import { strict as assert } from "node:assert";

import { RateLimiter } from "../index.js";

function newMemoryOnly() {
  // Short GC interval so the background task ticks during tests.
  return new RateLimiter({ gcIntervalMs: 50, idleEvictionMs: 100 });
}

test("memory-only constructor accepts no options", () => {
  const lim = new RateLimiter();
  assert.equal(lim.memorySize(), 0);
});

test("memory-only constructor accepts empty options object", () => {
  const lim = new RateLimiter({});
  assert.equal(lim.memorySize(), 0);
});

test("tryConsume cold path returns allowed with limit-1 remaining", () => {
  const lim = newMemoryOnly();
  const out = lim.tryConsume("u:cold", 10, 60_000);
  assert.equal(out.allowed, true);
  assert.equal(out.remaining, 9);
  assert.equal(out.retryAfterMs, 0);
  assert.equal(out.limit, 10);
  assert.equal(lim.memorySize(), 1);
});

test("tryConsume exhausts bucket and reports retry_after", () => {
  const lim = newMemoryOnly();
  for (let i = 0; i < 5; i++) {
    const out = lim.tryConsume("u:burn", 5, 60_000);
    assert.equal(out.allowed, true, `consume #${i} should pass`);
  }
  const blocked = lim.tryConsume("u:burn", 5, 60_000);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.remaining, 0);
  assert.ok(blocked.retryAfterMs > 0, "retryAfterMs must be > 0 when blocked");
});

test("tryConsume keys are isolated", () => {
  const lim = newMemoryOnly();
  for (let i = 0; i < 2; i++) {
    assert.equal(lim.tryConsume("u:a", 2, 60_000).allowed, true);
  }
  assert.equal(lim.tryConsume("u:a", 2, 60_000).allowed, false);
  // Brand-new key gets its own bucket.
  assert.equal(lim.tryConsume("u:b", 2, 60_000).allowed, true);
});

test("tryConsume fails open on zero windowMs", () => {
  const lim = newMemoryOnly();
  const out = lim.tryConsume("u:zero-window", 5, 0);
  assert.equal(out.allowed, true);
});

test("tryConsume fails open on zero limit", () => {
  const lim = newMemoryOnly();
  const out = lim.tryConsume("u:zero-limit", 0, 60_000);
  assert.equal(out.allowed, true);
});

test("gcNow drops idle buckets past TTL", async () => {
  const lim = new RateLimiter({ idleEvictionMs: 50 });
  lim.tryConsume("u:idle", 1, 1_000);
  assert.equal(lim.memorySize(), 1);
  // Wait past the eviction TTL, then sweep.
  await new Promise((r) => setTimeout(r, 100));
  lim.gcNow();
  assert.equal(lim.memorySize(), 0);
});

test("checkAndConsume without databaseUrl throws not_configured envelope", async () => {
  const lim = new RateLimiter(); // no databaseUrl
  await assert.rejects(
    lim.checkAndConsume("u:noop", [
      { windowMs: 60_000, max: 5, label: "minute" },
    ]),
    (err) => {
      const parsed = JSON.parse(err.message);
      assert.equal(parsed.kind, "not_configured");
      assert.equal(parsed.retryable, false);
      return true;
    },
  );
});

test("getUsage without databaseUrl throws not_configured envelope", async () => {
  const lim = new RateLimiter();
  await assert.rejects(
    lim.getUsage("u:noop", [
      { windowMs: 60_000, max: 5, label: "minute" },
    ]),
    (err) => {
      const parsed = JSON.parse(err.message);
      assert.equal(parsed.kind, "not_configured");
      return true;
    },
  );
});

test("checkAndConsume rejects zero windowMs with invalid_window envelope", async () => {
  const lim = new RateLimiter({ databaseUrl: "postgresql://invalid:invalid@invalid/invalid" });
  await assert.rejects(
    lim.checkAndConsume("u:bad", [
      { windowMs: 0, max: 5, label: "bad" },
    ]),
    (err) => {
      const parsed = JSON.parse(err.message);
      assert.equal(parsed.kind, "invalid_window");
      assert.equal(parsed.retryable, false);
      return true;
    },
  );
});

test("checkAndConsume rejects zero max with invalid_max envelope", async () => {
  const lim = new RateLimiter({ databaseUrl: "postgresql://invalid:invalid@invalid/invalid" });
  await assert.rejects(
    lim.checkAndConsume("u:bad", [
      { windowMs: 60_000, max: 0, label: "bad" },
    ]),
    (err) => {
      const parsed = JSON.parse(err.message);
      assert.equal(parsed.kind, "invalid_max");
      return true;
    },
  );
});
