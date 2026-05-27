// Tests for the migrated lib/normalize.ts — verify the public contract
// `normalizeBornCanonical` is preserved at default `shadow-prefer-ts`, AND
// that flipping to `rust` mode produces output that matches the TS chain
// byte-equal on the starter templates (the cutover dry-run).
//
// Run via: npx tsx --test lib/normalize.test.ts
//
// Prerequisites:
//   cd crates/html-engine && npm install && npm run build      (.node binding)
//   npm install                                                (workspace symlink)

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { strict as assert } from "node:assert";

import { normalizeBornCanonical } from "./normalize";

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

function quiet<T>(fn: () => T): T {
  const orig = console.warn;
  console.warn = () => {};
  try {
    return fn();
  } finally {
    console.warn = orig;
  }
}

const STARTER_DIR = join(process.cwd(), "templates", "starter");
const TEMPLATES = ["mirror.html", "counter.html", "manuscript.html"];

function readStarter(name: string): string {
  return readFileSync(join(STARTER_DIR, name), "utf8");
}

// ─── Default mode — output is what the TS chain has always produced ───────

test("default mode: empty string passes through unchanged", () => {
  const r = quiet(() => normalizeBornCanonical(""));
  assert.equal(r, "");
});

test("default mode: HTML with no markers gets canonicalised (mirror)", () => {
  const html = readStarter("mirror.html");
  const r = quiet(() => normalizeBornCanonical(html));
  assert.ok(r.length > 0);
  // The normalize chain injects design-axis CSS custom properties; at
  // least one of the axes should leave a marker in the output.
  const hasMarker =
    r.includes("--openlen-radius") ||
    r.includes("--openlen-accent") ||
    r.includes("data-ol-radius") ||
    r.includes("data-ol-accent") ||
    r.includes(":root") ||
    r !== html;
  assert.ok(hasMarker, "normalize should leave at least one visible mark");
});

test("default mode: idempotent (running twice == once) on mirror", () => {
  const html = readStarter("mirror.html");
  const once = quiet(() => normalizeBornCanonical(html));
  const twice = quiet(() => normalizeBornCanonical(once));
  assert.equal(once, twice);
});

test("default mode: idempotent on counter", () => {
  const html = readStarter("counter.html");
  const once = quiet(() => normalizeBornCanonical(html));
  const twice = quiet(() => normalizeBornCanonical(once));
  assert.equal(once, twice);
});

test("default mode: idempotent on manuscript", () => {
  const html = readStarter("manuscript.html");
  const once = quiet(() => normalizeBornCanonical(html));
  const twice = quiet(() => normalizeBornCanonical(once));
  assert.equal(once, twice);
});

// ─── Forced TS mode === default ──────────────────────────────────────────

test("ts-forced: matches default on mirror", () => {
  const html = readStarter("mirror.html");
  const tsForced = withEnv(
    { OPENLEN_SHADOW_NORMALIZE_BORN_CANONICAL: "ts" },
    () => normalizeBornCanonical(html),
  );
  const def = quiet(() => normalizeBornCanonical(html));
  assert.equal(tsForced, def);
});

test("ts-forced: matches default on counter", () => {
  const html = readStarter("counter.html");
  const tsForced = withEnv(
    { OPENLEN_SHADOW_NORMALIZE_BORN_CANONICAL: "ts" },
    () => normalizeBornCanonical(html),
  );
  const def = quiet(() => normalizeBornCanonical(html));
  assert.equal(tsForced, def);
});

test("ts-forced: matches default on manuscript", () => {
  const html = readStarter("manuscript.html");
  const tsForced = withEnv(
    { OPENLEN_SHADOW_NORMALIZE_BORN_CANONICAL: "ts" },
    () => normalizeBornCanonical(html),
  );
  const def = quiet(() => normalizeBornCanonical(html));
  assert.equal(tsForced, def);
});

// ─── Forced Rust mode === byte-equal to TS on starters ────────────────────
//
// The Rust engine ports the seven-pass chain (`normalize::*`) to native
// code; S2 acceptance was "byte-equal on the 3 starter templates" so the
// cutover dry-run here should produce identical strings.

for (const name of TEMPLATES) {
  test(`rust-forced: byte-equal to TS on ${name}`, () => {
    const html = readStarter(name);
    const ts = withEnv(
      { OPENLEN_SHADOW_NORMALIZE_BORN_CANONICAL: "ts" },
      () => normalizeBornCanonical(html),
    );
    const rust = withEnv(
      { OPENLEN_SHADOW_NORMALIZE_BORN_CANONICAL: "rust" },
      () => normalizeBornCanonical(html),
    );
    assert.equal(rust, ts);
  });
}

test("rust-forced: idempotent on mirror", () => {
  const html = readStarter("mirror.html");
  const once = withEnv(
    { OPENLEN_SHADOW_NORMALIZE_BORN_CANONICAL: "rust" },
    () => normalizeBornCanonical(html),
  );
  const twice = withEnv(
    { OPENLEN_SHADOW_NORMALIZE_BORN_CANONICAL: "rust" },
    () => normalizeBornCanonical(once),
  );
  assert.equal(once, twice);
});

test("rust-forced: empty input → empty output", () => {
  const r = withEnv(
    { OPENLEN_SHADOW_NORMALIZE_BORN_CANONICAL: "rust" },
    () => normalizeBornCanonical(""),
  );
  assert.equal(r, "");
});

// ─── Adversarial — small inline-style fixtures the regex chain touches ───

test("default mode: tiny doc with a single inline color rule is preserved or transformed deterministically", () => {
  const html =
    '<!doctype html><html><head><style>:root{--accent:#3366ff}</style></head><body><div>hi</div></body></html>';
  const r = quiet(() => normalizeBornCanonical(html));
  assert.ok(r.length > 0);
  assert.ok(r.includes("<div>hi</div>"));
});

test("rust-forced: tiny doc matches TS byte-equal", () => {
  const html =
    '<!doctype html><html><head><style>:root{--accent:#3366ff}</style></head><body><div>hi</div></body></html>';
  const ts = withEnv(
    { OPENLEN_SHADOW_NORMALIZE_BORN_CANONICAL: "ts" },
    () => normalizeBornCanonical(html),
  );
  const rust = withEnv(
    { OPENLEN_SHADOW_NORMALIZE_BORN_CANONICAL: "rust" },
    () => normalizeBornCanonical(html),
  );
  assert.equal(rust, ts);
});

test("shadow-prefer-ts (default): visible behaviour is TS regardless of Rust divergence", () => {
  const html = readStarter("mirror.html");
  const visible = quiet(() => normalizeBornCanonical(html));
  const tsOnly = withEnv(
    { OPENLEN_SHADOW_NORMALIZE_BORN_CANONICAL: "ts" },
    () => normalizeBornCanonical(html),
  );
  assert.equal(visible, tsOnly);
});

test("shadow-prefer-rust: visible behaviour is Rust", () => {
  const html = readStarter("counter.html");
  const visible = withEnv(
    { OPENLEN_SHADOW_NORMALIZE_BORN_CANONICAL: "shadow-prefer-rust" },
    () => quiet(() => normalizeBornCanonical(html)),
  );
  const rustOnly = withEnv(
    { OPENLEN_SHADOW_NORMALIZE_BORN_CANONICAL: "rust" },
    () => normalizeBornCanonical(html),
  );
  assert.equal(visible, rustOnly);
});
