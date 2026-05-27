// Tests for lib/shadow-soak.ts — mode resolution, divergence detection,
// logger override, error-shape handling.
//
// Run via: npx tsx --test lib/shadow-soak.test.ts
//
// Each test snapshots + restores the relevant env vars so they don't leak.

import { test } from "node:test";
import { strict as assert } from "node:assert";

import {
  shadowCompare,
  setShadowLogger,
  type ShadowDivergenceRecord,
} from "./shadow-soak";

function makeRecordingLogger() {
  const records: ShadowDivergenceRecord[] = [];
  return {
    records,
    logger: {
      onDivergence(r: ShadowDivergenceRecord) {
        records.push(r);
      },
    },
  };
}

function withEnv<T>(
  vars: Record<string, string | undefined>,
  fn: () => T,
): T {
  const prior: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) {
    prior[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  try {
    return fn();
  } finally {
    for (const k of Object.keys(prior)) {
      if (prior[k] === undefined) delete process.env[k];
      else process.env[k] = prior[k];
    }
  }
}

// ─── Mode selection ────────────────────────────────────────────────────────

test("ts mode: only TS runs, rust impl not called", () => {
  let rustCalled = false;
  const r = shadowCompare(
    "test-ts-only",
    "",
    () => "ts-result",
    () => {
      rustCalled = true;
      return "rust-result";
    },
    { fallbackMode: "ts" },
  );
  assert.equal(r, "ts-result");
  assert.equal(rustCalled, false);
});

test("rust mode: only Rust runs, ts impl not called", () => {
  let tsCalled = false;
  const r = shadowCompare(
    "test-rust-only",
    "",
    () => {
      tsCalled = true;
      return "ts-result";
    },
    () => "rust-result",
    { fallbackMode: "rust" },
  );
  assert.equal(r, "rust-result");
  assert.equal(tsCalled, false);
});

test("shadow-prefer-ts: both run, TS returned, no log when equal", () => {
  const { records, logger } = makeRecordingLogger();
  const r = shadowCompare(
    "test-shadow-ts-match",
    "",
    () => "same",
    () => "same",
    { fallbackMode: "shadow-prefer-ts", logger },
  );
  assert.equal(r, "same");
  assert.equal(records.length, 0, "no log on match");
});

test("shadow-prefer-rust: both run, Rust returned, no log when equal", () => {
  const { records, logger } = makeRecordingLogger();
  const r = shadowCompare(
    "test-shadow-rust-match",
    "",
    () => ({ a: 1 }),
    () => ({ a: 1 }),
    { fallbackMode: "shadow-prefer-rust", logger },
  );
  assert.deepEqual(r, { a: 1 });
  assert.equal(records.length, 0);
});

// ─── Divergence logging ────────────────────────────────────────────────────

test("logs once on string divergence, returns TS in prefer-ts mode", () => {
  const { records, logger } = makeRecordingLogger();
  const r = shadowCompare(
    "test-string-diverge",
    "args=foo",
    () => "from-ts",
    () => "from-rust",
    { fallbackMode: "shadow-prefer-ts", logger },
  );
  assert.equal(r, "from-ts");
  assert.equal(records.length, 1);
  const rec = records[0];
  assert.equal(rec.name, "test-string-diverge");
  assert.equal(rec.argsSummary, "args=foo");
  assert.ok(rec.tsValuePreview.includes("from-ts"));
  assert.ok(rec.rustValuePreview.includes("from-rust"));
  assert.equal(rec.errorShapeMismatch, false);
  assert.equal(rec.tsBytes, "from-ts".length);
  assert.equal(rec.rustBytes, "from-rust".length);
});

test("logs once on object divergence, returns Rust in prefer-rust mode", () => {
  const { records, logger } = makeRecordingLogger();
  const r = shadowCompare(
    "test-obj-diverge",
    "",
    () => ({ html: "a", count: 1 }),
    () => ({ html: "a", count: 2 }),
    { fallbackMode: "shadow-prefer-rust", logger },
  );
  assert.deepEqual(r, { html: "a", count: 2 });
  assert.equal(records.length, 1);
});

test("deep-equal handles nested arrays + null + undefined", () => {
  const { records, logger } = makeRecordingLogger();
  shadowCompare(
    "test-deep-equal",
    "",
    () => ({ list: [1, { x: null }], opt: undefined }),
    () => ({ list: [1, { x: null }], opt: undefined }),
    { fallbackMode: "shadow-prefer-ts", logger },
  );
  assert.equal(records.length, 0);
});

test("deep-equal sees null vs undefined as different", () => {
  const { records, logger } = makeRecordingLogger();
  shadowCompare<{ html: null | undefined }>(
    "test-null-vs-undef",
    "",
    () => ({ html: null }),
    () => ({ html: undefined }),
    { fallbackMode: "shadow-prefer-ts", logger },
  );
  assert.equal(records.length, 1);
});

// ─── Error-shape handling ──────────────────────────────────────────────────

test("error in TS only → divergence + errorShapeMismatch + propagates TS error", () => {
  const { records, logger } = makeRecordingLogger();
  assert.throws(() => {
    shadowCompare(
      "test-ts-throws",
      "",
      () => {
        throw new Error("ts boom");
      },
      () => "rust-ok",
      { fallbackMode: "shadow-prefer-ts", logger },
    );
  }, /ts boom/);
  assert.equal(records.length, 1);
  assert.equal(records[0].errorShapeMismatch, true);
});

test("error in Rust only → divergence + errorShapeMismatch + propagates TS value", () => {
  const { records, logger } = makeRecordingLogger();
  const r = shadowCompare(
    "test-rust-throws",
    "",
    () => "ts-ok",
    () => {
      throw new Error("rust boom");
    },
    { fallbackMode: "shadow-prefer-ts", logger },
  );
  assert.equal(r, "ts-ok");
  assert.equal(records.length, 1);
  assert.equal(records[0].errorShapeMismatch, true);
});

test("both throw same message → no divergence", () => {
  const { records, logger } = makeRecordingLogger();
  assert.throws(() => {
    shadowCompare(
      "test-both-throw-same",
      "",
      () => {
        throw new Error("forbidden");
      },
      () => {
        throw new Error("forbidden");
      },
      { fallbackMode: "shadow-prefer-ts", logger },
    );
  }, /forbidden/);
  assert.equal(records.length, 0, "matching errors should not log");
});

test("both throw different messages → divergence with errorShapeMismatch=true", () => {
  const { records, logger } = makeRecordingLogger();
  assert.throws(() => {
    shadowCompare(
      "test-both-throw-diff",
      "",
      () => {
        throw new Error("ts msg");
      },
      () => {
        throw new Error("rust msg");
      },
      { fallbackMode: "shadow-prefer-ts", logger },
    );
  }, /ts msg/);
  assert.equal(records.length, 1);
  assert.equal(records[0].errorShapeMismatch, true);
});

test("shadow-prefer-rust propagates Rust error", () => {
  const { records, logger } = makeRecordingLogger();
  assert.throws(() => {
    shadowCompare(
      "test-prefer-rust-error",
      "",
      () => "ts-ok",
      () => {
        throw new Error("rust boom");
      },
      { fallbackMode: "shadow-prefer-rust", logger },
    );
  }, /rust boom/);
  assert.equal(records.length, 1);
});

// ─── Env var resolution ────────────────────────────────────────────────────

test("OPENLEN_SHADOW_MODE env overrides fallback", () => {
  let rustCalled = false;
  withEnv({ OPENLEN_SHADOW_MODE: "ts" }, () => {
    shadowCompare(
      "env-global",
      "",
      () => "ts",
      () => {
        rustCalled = true;
        return "rust";
      },
      { fallbackMode: "shadow-prefer-rust" }, // global env should win
    );
  });
  assert.equal(rustCalled, false, "ts mode should skip rust impl");
});

test("OPENLEN_SHADOW_<NAME> per-call env overrides global env", () => {
  let tsCalled = false;
  withEnv(
    {
      OPENLEN_SHADOW_MODE: "ts",
      OPENLEN_SHADOW_PER_CALL: "rust",
    },
    () => {
      shadowCompare(
        "per-call",
        "",
        () => {
          tsCalled = true;
          return "ts";
        },
        () => "rust",
        { fallbackMode: "shadow-prefer-ts" },
      );
    },
  );
  assert.equal(tsCalled, false, "per-call rust override should win over global ts");
});

test("name kebab-case maps to env var with underscores", () => {
  let tsCalled = false;
  withEnv({ OPENLEN_SHADOW_SANITIZE_FILLED_HTML: "rust" }, () => {
    shadowCompare(
      "sanitize-filled-html",
      "",
      () => {
        tsCalled = true;
        return "ts";
      },
      () => "rust",
      { fallbackMode: "shadow-prefer-ts" },
    );
  });
  assert.equal(tsCalled, false, "kebab-name → underscore env var should resolve");
});

test("invalid env value falls through to next layer", () => {
  let tsCalled = false;
  withEnv(
    {
      OPENLEN_SHADOW_MODE: "garbage",
      OPENLEN_SHADOW_WHATEVER: "alsobad",
    },
    () => {
      shadowCompare(
        "whatever",
        "",
        () => {
          tsCalled = true;
          return "ts";
        },
        () => "rust",
        { fallbackMode: "rust" },
      );
    },
  );
  assert.equal(tsCalled, false, "fallback rust used when env values are invalid");
});

// ─── Custom equality + logger ──────────────────────────────────────────────

test("custom equalityFn can mark equivalent payloads as matching", () => {
  // Sanitize's TS bundles meta-refresh into scripts; Rust splits it out.
  // A real consumer would want to ignore that single-field difference.
  const { records, logger } = makeRecordingLogger();
  shadowCompare(
    "test-custom-eq",
    "",
    () => ({ scripts: 2, eventHandlers: 0 }),
    () => ({ scripts: 1, eventHandlers: 0, metaRefresh: 1 }),
    {
      fallbackMode: "shadow-prefer-ts",
      logger,
      equalityFn: (ts, rust) => {
        const t = ts as { scripts: number; eventHandlers: number };
        const r = rust as { scripts: number; eventHandlers: number; metaRefresh: number };
        return t.scripts === r.scripts + r.metaRefresh && t.eventHandlers === r.eventHandlers;
      },
    },
  );
  assert.equal(records.length, 0, "custom equality should suppress logging");
});

test("module-level setShadowLogger applies when options.logger is omitted", () => {
  const { records, logger } = makeRecordingLogger();
  setShadowLogger(logger);
  try {
    shadowCompare(
      "test-module-logger",
      "",
      () => "a",
      () => "b",
      { fallbackMode: "shadow-prefer-ts" },
    );
    assert.equal(records.length, 1);
  } finally {
    setShadowLogger(null);
  }
});

test("setShadowLogger(null) restores default (no-throw smoke)", () => {
  setShadowLogger(null);
  // The default logger writes to console.warn; we don't validate console output,
  // just that calling shadowCompare doesn't blow up after the reset.
  shadowCompare(
    "test-default-logger",
    "",
    () => "a",
    () => "a",
    { fallbackMode: "shadow-prefer-ts" },
  );
});
