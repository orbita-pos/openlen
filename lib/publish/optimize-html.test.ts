// Tests for the migrated lib/publish/optimize-html.ts — the public contract
// `optimizeHtmlForProduction` is preserved under default `shadow-prefer-ts`,
// the Rust adapter normalises to the TS shape, and forced-mode flips work
// end-to-end across the parity matrix.
//
// Run via: npx tsx --test lib/publish/optimize-html.test.ts
//
// Prerequisites:
//   cd crates/html-engine && npm install && npm run build      (.node binding)
//   npm install                                                (workspace symlink)
//
// ─── F1 S8 — Tailwind-bake-gap framing ────────────────────────────────────────
// TS does Tailwind CDN strip + PostCSS bake; Rust does HTML/CSS minify only
// (S4 Option C). The two arms do *orthogonal* work, so every default-mode
// call against HTML with the CDN script logs a divergence by deep-equal.
// We accept that: the records carry tsBytes/rustBytes for Sem 8.5 planning,
// and the actionable signal is `errorShapeMismatch: true` (one arm throws,
// e.g. Rust's slot-path gate catches an input TS would pass through).
//
// These tests prove:
//   - Dev-mode passthrough preserved (NODE_ENV !== "production").
//   - Default mode (shadow-prefer-ts) returns the TS value verbatim.
//   - Forced-TS mode is byte-equal to default behaviour.
//   - Forced-Rust mode returns the adapted Rust result; the bake-gap is
//     visible (baked=false, cssBytes=0) but the HTML is minified.
//   - Slot-path inputs throw in forced-Rust + log errorShapeMismatch=true
//     in default mode.

import { test } from "node:test";
import { strict as assert } from "node:assert";

import {
  setShadowLogger,
  type ShadowDivergenceRecord,
} from "@/lib/shadow-soak";

import {
  optimizeHtmlForProduction,
  optimizeHtmlForProductionRust,
  optimizeHtmlForProductionTs,
} from "./optimize-html";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function withEnv<T>(
  vars: Record<string, string | undefined>,
  fn: () => Promise<T>,
): Promise<T>;
function withEnv<T>(
  vars: Record<string, string | undefined>,
  fn: () => T,
): T;
function withEnv<T>(
  vars: Record<string, string | undefined>,
  fn: () => T | Promise<T>,
): T | Promise<T> {
  const prior: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) {
    prior[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  const restore = () => {
    for (const k of Object.keys(prior)) {
      if (prior[k] === undefined) delete process.env[k];
      else process.env[k] = prior[k];
    }
  };
  let out: T | Promise<T>;
  try {
    out = fn();
  } catch (err) {
    restore();
    throw err;
  }
  if (out && typeof (out as Promise<T>).then === "function") {
    return (out as Promise<T>).then(
      (v) => {
        restore();
        return v;
      },
      (err) => {
        restore();
        throw err;
      },
    );
  }
  restore();
  return out;
}

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

async function withRecordingLogger<T>(
  fn: (records: ShadowDivergenceRecord[]) => Promise<T>,
): Promise<T> {
  const { records, logger } = makeRecordingLogger();
  setShadowLogger(logger);
  try {
    return await fn(records);
  } finally {
    setShadowLogger(null);
  }
}

const TINY_DOC = "<!doctype html><html><body><p>hi</p></body></html>";
const DOC_WITH_CDN =
  '<!doctype html><html><head><script src="https://cdn.tailwindcss.com"></script></head><body><div class="p-4 text-lg">hello</div></body></html>';
const DOC_WITH_SLOT_PATH =
  '<!doctype html><html><body><div data-slot-path="hero.title">x</div></body></html>';

// ─── Dev-mode passthrough (NODE_ENV !== "production") ────────────────────────

test("dev mode: passthrough — html unchanged, baked false, cssBytes 0", async () => {
  await withEnv({ NODE_ENV: "development" }, async () => {
    const r = await optimizeHtmlForProduction(DOC_WITH_CDN);
    assert.equal(r.html, DOC_WITH_CDN);
    assert.equal(r.baked, false);
    assert.equal(r.cssBytes, 0);
  });
});

test("dev mode: passthrough — slot-path input is NOT gated here (upstream's job)", async () => {
  await withEnv({ NODE_ENV: "development" }, async () => {
    const r = await optimizeHtmlForProduction(DOC_WITH_SLOT_PATH);
    assert.equal(r.html, DOC_WITH_SLOT_PATH);
    assert.equal(r.baked, false);
  });
});

// ─── Default mode (NODE_ENV=production, shadow-prefer-ts) ─────────────────────

test("default mode: empty input → TS returns empty passthrough", async () => {
  await withRecordingLogger(async () => {
    await withEnv({ NODE_ENV: "production" }, async () => {
      const r = await optimizeHtmlForProduction("");
      assert.equal(r.html, "");
      assert.equal(r.baked, false);
      assert.equal(r.cssBytes, 0);
    });
  });
});

test("default mode: no-CDN HTML → TS passthrough; Rust minifies in shadow; log fires", async () => {
  await withRecordingLogger(async (records) => {
    await withEnv({ NODE_ENV: "production" }, async () => {
      const r = await optimizeHtmlForProduction(TINY_DOC);
      // Caller sees the TS arm's passthrough — the published HTML is
      // byte-equal to the input.
      assert.equal(r.html, TINY_DOC);
      assert.equal(r.baked, false);
      assert.equal(r.cssBytes, 0);
      // Rust ran in shadow. Its minify output differs from TS's passthrough
      // (whitespace stripped), so a divergence record was emitted.
      assert.ok(
        records.length >= 1,
        "expected a divergence record for no-CDN input (Rust minified, TS passthrough)",
      );
      const rec = records.find(
        (r) => r.name === "optimize-html-for-production",
      );
      assert.ok(rec, "expected a record under the optimize-html name");
      assert.equal(rec.errorShapeMismatch, false);
      assert.equal(typeof rec.tsBytes, "number");
      assert.equal(typeof rec.rustBytes, "number");
      assert.ok(rec.tsMillis >= 0);
      assert.ok(rec.rustMillis >= 0);
    });
  });
});

test("default mode: slot-path input → log fires with errorShapeMismatch=true (Rust gate, TS missed it)", async () => {
  await withRecordingLogger(async (records) => {
    await withEnv({ NODE_ENV: "production" }, async () => {
      const r = await optimizeHtmlForProduction(DOC_WITH_SLOT_PATH);
      // Public return is the TS arm — slot-path HTML passes through TS
      // unchanged (no CDN to bake, no gate to fire). In prod the upstream
      // filesystem.ts `detectSlotPath` gate catches this BEFORE optimize
      // runs (per F1 S7), but here we exercise the defense-in-depth: Rust
      // throws because its slot-path gate is the same `sanitize_for_publish`
      // gate, and the shadow log surfaces the asymmetry.
      assert.equal(r.html, DOC_WITH_SLOT_PATH);
      const rec = records.find(
        (r) => r.name === "optimize-html-for-production",
      );
      assert.ok(rec, "expected a divergence record");
      assert.equal(
        rec.errorShapeMismatch,
        true,
        "Rust threw on slot-path while TS passed through",
      );
    });
  });
});

// ─── Forced TS mode (OPENLEN_SHADOW_OPTIMIZE_HTML_FOR_PRODUCTION=ts) ─────────

test("forced ts mode: no-CDN input → passthrough, no shadow log", async () => {
  await withRecordingLogger(async (records) => {
    await withEnv(
      {
        NODE_ENV: "production",
        OPENLEN_SHADOW_OPTIMIZE_HTML_FOR_PRODUCTION: "ts",
      },
      async () => {
        const r = await optimizeHtmlForProduction(TINY_DOC);
        assert.equal(r.html, TINY_DOC);
        assert.equal(r.baked, false);
        assert.equal(r.cssBytes, 0);
        assert.equal(
          records.length,
          0,
          "ts-only mode must not invoke the shadow harness",
        );
      },
    );
  });
});

test("forced ts mode: slot-path input → passthrough (TS has no gate)", async () => {
  await withEnv(
    {
      NODE_ENV: "production",
      OPENLEN_SHADOW_OPTIMIZE_HTML_FOR_PRODUCTION: "ts",
    },
    async () => {
      const r = await optimizeHtmlForProduction(DOC_WITH_SLOT_PATH);
      assert.equal(r.html, DOC_WITH_SLOT_PATH);
      assert.equal(r.baked, false);
    },
  );
});

// ─── Forced Rust mode (OPENLEN_SHADOW_OPTIMIZE_HTML_FOR_PRODUCTION=rust) ─────

test("forced rust mode: no-CDN input → adapter returns minified html, baked false, cssBytes 0", async () => {
  await withEnv(
    {
      NODE_ENV: "production",
      OPENLEN_SHADOW_OPTIMIZE_HTML_FOR_PRODUCTION: "rust",
    },
    async () => {
      const r = await optimizeHtmlForProduction(TINY_DOC);
      assert.equal(typeof r.html, "string");
      assert.ok(r.html.length > 0, "Rust output should be non-empty");
      assert.ok(
        r.html.length <= TINY_DOC.length,
        `expected Rust output (${r.html.length}) <= input (${TINY_DOC.length}) post-minify`,
      );
      assert.equal(r.baked, false, "Rust arm doesn't bake — Option C");
      assert.equal(r.cssBytes, 0);
    },
  );
});

test("forced rust mode: slot-path input throws via adapter (gate fired)", async () => {
  await withEnv(
    {
      NODE_ENV: "production",
      OPENLEN_SHADOW_OPTIMIZE_HTML_FOR_PRODUCTION: "rust",
    },
    async () => {
      await assert.rejects(
        () => optimizeHtmlForProduction(DOC_WITH_SLOT_PATH),
        /optimize gate fired \(slot-path detected\)/,
      );
    },
  );
});

test("forced rust mode: adversarial mixed-case slot-path also throws (Rust gate stronger than includes)", async () => {
  const evil =
    '<!doctype html><html><body><div Data-Slot-Path="hero.title">x</div></body></html>';
  await withEnv(
    {
      NODE_ENV: "production",
      OPENLEN_SHADOW_OPTIMIZE_HTML_FOR_PRODUCTION: "rust",
    },
    async () => {
      await assert.rejects(
        () => optimizeHtmlForProduction(evil),
        /optimize gate fired/,
      );
    },
  );
});

test("forced rust mode: empty input → adapter returns empty/near-empty html, no throw", async () => {
  await withEnv(
    {
      NODE_ENV: "production",
      OPENLEN_SHADOW_OPTIMIZE_HTML_FOR_PRODUCTION: "rust",
    },
    async () => {
      const r = await optimizeHtmlForProduction("");
      assert.equal(typeof r.html, "string");
      assert.equal(r.baked, false);
      assert.equal(r.cssBytes, 0);
    },
  );
});

test("forced rust mode: idempotence — running twice byte-equal", async () => {
  await withEnv(
    {
      NODE_ENV: "production",
      OPENLEN_SHADOW_OPTIMIZE_HTML_FOR_PRODUCTION: "rust",
    },
    async () => {
      const once = await optimizeHtmlForProduction(TINY_DOC);
      const twice = await optimizeHtmlForProduction(once.html);
      assert.equal(once.html, twice.html);
    },
  );
});

// ─── Shadow-prefer-rust mode ──────────────────────────────────────────────────

test("shadow-prefer-rust: visible behaviour is Rust output", async () => {
  await withRecordingLogger(async () => {
    await withEnv(
      {
        NODE_ENV: "production",
        OPENLEN_SHADOW_OPTIMIZE_HTML_FOR_PRODUCTION: "shadow-prefer-rust",
      },
      async () => {
        const visible = await optimizeHtmlForProduction(TINY_DOC);
        const rustOnly = await withEnv(
          {
            OPENLEN_SHADOW_OPTIMIZE_HTML_FOR_PRODUCTION: "rust",
          },
          () => optimizeHtmlForProduction(TINY_DOC),
        );
        assert.equal(visible.html, rustOnly.html);
        assert.equal(visible.baked, rustOnly.baked);
        assert.equal(visible.cssBytes, rustOnly.cssBytes);
      },
    );
  });
});

test("shadow-prefer-rust: slot-path input → Rust arm throws, propagates out", async () => {
  await withRecordingLogger(async () => {
    await withEnv(
      {
        NODE_ENV: "production",
        OPENLEN_SHADOW_OPTIMIZE_HTML_FOR_PRODUCTION: "shadow-prefer-rust",
      },
      async () => {
        await assert.rejects(
          () => optimizeHtmlForProduction(DOC_WITH_SLOT_PATH),
          /optimize gate fired/,
        );
      },
    );
  });
});

// ─── Direct-arm exports (regression net for the rename refactor) ─────────────

test("direct TS arm: no-CDN input → passthrough", async () => {
  const r = await optimizeHtmlForProductionTs(TINY_DOC);
  assert.equal(r.html, TINY_DOC);
  assert.equal(r.baked, false);
  assert.equal(r.cssBytes, 0);
});

test("direct Rust arm: no-CDN input → minified output, baked false", () => {
  const r = optimizeHtmlForProductionRust(TINY_DOC);
  assert.equal(typeof r.html, "string");
  assert.equal(r.baked, false);
  assert.equal(r.cssBytes, 0);
});

test("direct Rust arm: slot-path input throws synchronously", () => {
  assert.throws(
    () => optimizeHtmlForProductionRust(DOC_WITH_SLOT_PATH),
    /optimize gate fired \(slot-path detected\)/,
  );
});

// ─── Default-mode resilience smoke ───────────────────────────────────────────

test("default mode: identical inputs across two calls produce identical visible output (no state leak)", async () => {
  await withRecordingLogger(async () => {
    await withEnv({ NODE_ENV: "production" }, async () => {
      const a = await optimizeHtmlForProduction(TINY_DOC);
      const b = await optimizeHtmlForProduction(TINY_DOC);
      assert.equal(a.html, b.html);
      assert.equal(a.baked, b.baked);
      assert.equal(a.cssBytes, b.cssBytes);
    });
  });
});
