// Tests for the migrated lib/html-ops.ts — verify the public contract for
// each of the six shadowCompare-routed exports is preserved at default
// `shadow-prefer-ts`, AND that flipping to `rust` mode produces a
// TS-shape-compatible result (the cutover dry-run).
//
// Run via: npx tsx --test lib/html-ops.test.ts
//
// Prerequisites:
//   cd crates/html-engine && npm install && npm run build      (.node binding)
//   npm install                                                (workspace symlink)

import { test } from "node:test";
import { strict as assert } from "node:assert";

import {
  applyOps,
  buildScopedView,
  parseOps,
  resolveOpIdByPath,
  stripOpIds,
  tagWithOpIds,
} from "./html-ops";

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

// Silence shadow-soak warnings during parity tests. The harness tests own
// the log-format coverage.
function quiet<T>(fn: () => T): T {
  const orig = console.warn;
  console.warn = () => {};
  try {
    return fn();
  } finally {
    console.warn = orig;
  }
}

// ─── tagWithOpIds ──────────────────────────────────────────────────────────

test("tagWithOpIds default: empty input → 0 count", () => {
  const r = quiet(() => tagWithOpIds(""));
  assert.equal(r.taggedCount, 0);
});

test("tagWithOpIds default: tags every non-skipped element in a full doc", () => {
  // cheerio wraps fragments with <html><head></head><body>…</body></html>;
  // SKIP_TAGS excludes html/head but NOT body, so body itself gets tagged.
  // Use a full doc here so the count is deterministic across cheerio's
  // wrap behaviour.
  const html = "<html><body><div><p>hi</p></div></body></html>";
  const r = quiet(() => tagWithOpIds(html));
  assert.ok(r.taggedHtml.includes("data-op-id"));
  // body + div + p = 3
  assert.equal(r.taggedCount, 3);
});

test("tagWithOpIds default: skip script/style/meta/etc", () => {
  const html =
    "<html><head><meta charset=\"utf-8\"><title>t</title><style>x{}</style></head><body><div>x</div><script>1</script></body></html>";
  const r = quiet(() => tagWithOpIds(html));
  // body + div should be tagged (head/meta/title/style/script/html skipped)
  assert.equal(r.taggedCount, 2);
  assert.ok(!/<head[^>]*data-op-id/.test(r.taggedHtml));
  assert.ok(!/<script[^>]*data-op-id/.test(r.taggedHtml));
  assert.ok(!/<style[^>]*data-op-id/.test(r.taggedHtml));
});

test("tagWithOpIds default: base36 monotonic ids — first 10 are numeric", () => {
  // toString(36) maps 0..9 → "0".."9" and 10..35 → "a".."z". With body
  // + div + span + span = 4 elements, ids are "0".."3".
  const html =
    "<html><body><div><span></span><span></span></div></body></html>";
  const r = quiet(() => tagWithOpIds(html));
  assert.equal(r.taggedCount, 4);
  for (const id of ["0", "1", "2", "3"]) {
    assert.ok(r.taggedHtml.includes(`data-op-id="${id}"`));
  }
});

test("tagWithOpIds default: preserves existing data-op-id", () => {
  const html =
    '<html><body><div data-op-id="preset"><span>x</span></div></body></html>';
  const r = quiet(() => tagWithOpIds(html));
  assert.ok(r.taggedHtml.includes('data-op-id="preset"'));
});

test("tagWithOpIds ts-forced: matches default", () => {
  const html =
    "<html><body><section><h1>Hi</h1><p>body</p></section></body></html>";
  const tsForced = withEnv({ OPENLEN_SHADOW_TAG_WITH_OP_IDS: "ts" }, () =>
    tagWithOpIds(html),
  );
  const defaultMode = quiet(() => tagWithOpIds(html));
  assert.equal(tsForced.taggedCount, defaultMode.taggedCount);
  assert.equal(tsForced.taggedHtml, defaultMode.taggedHtml);
});

test("tagWithOpIds rust-forced on a full doc: same taggedCount as TS", () => {
  // Both TS (cheerio) and Rust (lol-html) walk the same set of elements
  // when given a full <html><body>…</body></html> doc — body + section +
  // h1 + p = 4 tagged.
  const html =
    "<html><body><section><h1>Hi</h1><p>body</p></section></body></html>";
  const r = withEnv({ OPENLEN_SHADOW_TAG_WITH_OP_IDS: "rust" }, () =>
    tagWithOpIds(html),
  );
  assert.equal(r.taggedCount, 4);
  const matches = r.taggedHtml.match(/data-op-id="[^"]+"/g) ?? [];
  assert.equal(matches.length, 4);
});

test("tagWithOpIds: fragment input diverges between TS and Rust (documented gap)", () => {
  // cheerio wraps fragments → tags `<body>` too. lol-html keeps fragments
  // unwrapped → no body tag. This is the documented divergence from
  // S6/S7 — shadow-soak logs it; production paths (chat / publish) pass
  // full HTML docs so it doesn't affect them.
  const fragment = "<div><p>hi</p></div>";
  const tsCount = withEnv({ OPENLEN_SHADOW_TAG_WITH_OP_IDS: "ts" }, () =>
    tagWithOpIds(fragment),
  ).taggedCount;
  const rustCount = withEnv({ OPENLEN_SHADOW_TAG_WITH_OP_IDS: "rust" }, () =>
    tagWithOpIds(fragment),
  ).taggedCount;
  // TS adds body; Rust doesn't.
  assert.equal(tsCount, 3);
  assert.equal(rustCount, 2);
});

// ─── stripOpIds ────────────────────────────────────────────────────────────

test("stripOpIds default: empty input → empty", () => {
  assert.equal(quiet(() => stripOpIds("")), "");
});

test("stripOpIds default: strips data-op-id everywhere", () => {
  const html = '<div data-op-id="a"><span data-op-id="b">x</span></div>';
  const r = quiet(() => stripOpIds(html));
  assert.ok(!r.includes("data-op-id"));
  assert.ok(r.includes("<span>x</span>"));
});

test("stripOpIds default: leaves unrelated attributes intact", () => {
  const html = '<a data-op-id="x" href="/h" data-foo="bar">x</a>';
  const r = quiet(() => stripOpIds(html));
  assert.ok(!r.includes("data-op-id"));
  assert.ok(r.includes('href="/h"'));
  assert.ok(r.includes('data-foo="bar"'));
});

test("stripOpIds rust-forced: parity with TS on common shapes", () => {
  const html = '<div data-op-id="a"><span data-op-id="ab">x</span></div>';
  const ts = withEnv({ OPENLEN_SHADOW_STRIP_OP_IDS: "ts" }, () =>
    stripOpIds(html),
  );
  const rust = withEnv({ OPENLEN_SHADOW_STRIP_OP_IDS: "rust" }, () =>
    stripOpIds(html),
  );
  assert.equal(ts, rust);
});

// ─── parseOps ──────────────────────────────────────────────────────────────

test("parseOps default: empty body → error", () => {
  const r = quiet(() => parseOps(""));
  assert.equal(r.ops.length, 0);
  assert.equal(r.errors.length, 1);
});

test("parseOps default: no <edits> envelope → error", () => {
  const r = quiet(() => parseOps("<p>just html, no envelope</p>"));
  assert.equal(r.ops.length, 0);
  assert.equal(r.errors.length, 1);
});

test("parseOps default: self-closing delete", () => {
  const raw = '<edits><edit op="delete" target="a" /></edits>';
  const r = quiet(() => parseOps(raw));
  assert.equal(r.errors.length, 0);
  assert.equal(r.ops.length, 1);
  assert.equal(r.ops[0].type, "delete");
  assert.equal(r.ops[0].target, "a");
  assert.equal(r.ops[0].newHtml, undefined);
});

test("parseOps default: open-close replace with <new> wrapper", () => {
  const raw =
    '<edits><edit op="replace" target="a"><new><p>new</p></new></edit></edits>';
  const r = quiet(() => parseOps(raw));
  assert.equal(r.errors.length, 0);
  assert.equal(r.ops.length, 1);
  assert.equal(r.ops[0].type, "replace");
  assert.equal(r.ops[0].target, "a");
  assert.equal(r.ops[0].newHtml, "<p>new</p>");
});

test("parseOps default: natural form (no <new> wrapper)", () => {
  const raw =
    '<edits><edit op="replace" target="b"><p>direct</p></edit></edits>';
  const r = quiet(() => parseOps(raw));
  assert.equal(r.errors.length, 0);
  assert.equal(r.ops.length, 1);
  assert.equal(r.ops[0].type, "replace");
  assert.equal(r.ops[0].newHtml, "<p>direct</p>");
});

test("parseOps default: unknown op type → error", () => {
  const raw = '<edits><edit op="nukeit" target="x">y</edit></edits>';
  const r = quiet(() => parseOps(raw));
  assert.equal(r.ops.length, 0);
  assert.ok(r.errors.length >= 1);
});

test("parseOps rust-forced: same ops on natural-form replace", () => {
  const raw =
    '<edits><edit op="replace" target="abc"><h1>NEW</h1></edit></edits>';
  const ts = withEnv({ OPENLEN_SHADOW_PARSE_OPS: "ts" }, () => parseOps(raw));
  const rust = withEnv({ OPENLEN_SHADOW_PARSE_OPS: "rust" }, () =>
    parseOps(raw),
  );
  assert.equal(rust.ops.length, ts.ops.length);
  assert.equal(rust.ops[0].type, ts.ops[0].type);
  assert.equal(rust.ops[0].target, ts.ops[0].target);
  assert.equal(rust.ops[0].newHtml, ts.ops[0].newHtml);
});

test("parseOps rust-forced: open-close delete + open-close replace", () => {
  // NB: self-closing + open-close ops in the same envelope trip the
  // open-close regex (`<edit ...>.*?</edit>`), causing it to span both —
  // a known quirk shared by both impls. Use open-close everywhere here.
  const raw =
    '<edits><edit op="delete" target="x"></edit><edit op="replace" target="y"><p>p</p></edit></edits>';
  const r = withEnv({ OPENLEN_SHADOW_PARSE_OPS: "rust" }, () => parseOps(raw));
  assert.equal(r.ops.length, 2);
  assert.equal(r.ops[0].type, "delete");
  assert.equal(r.ops[0].target, "x");
  assert.equal(r.ops[1].type, "replace");
  assert.equal(r.ops[1].target, "y");
});

// ─── applyOps ──────────────────────────────────────────────────────────────

test("applyOps default: empty ops → html null, no errors", () => {
  const r = quiet(() =>
    applyOps('<div data-op-id="a">x</div>', []),
  );
  assert.equal(r.html, null);
  assert.equal(r.errors.length, 0);
  assert.equal(r.appliedCount, 0);
});

test("applyOps default: replace works + ids stripped from output", () => {
  const tagged = '<div data-op-id="a"><p data-op-id="b">old</p></div>';
  const r = quiet(() =>
    applyOps(tagged, [{ type: "replace", target: "b", newHtml: "<p>new</p>" }]),
  );
  assert.ok(r.html !== null);
  assert.ok(r.html!.includes("new"));
  assert.ok(!r.html!.includes("old"));
  assert.ok(!r.html!.includes("data-op-id"));
  assert.equal(r.appliedCount, 1);
});

test("applyOps default: insert_before adds sibling", () => {
  const tagged = '<div data-op-id="a"><p data-op-id="b">old</p></div>';
  const r = quiet(() =>
    applyOps(tagged, [
      { type: "insert_before", target: "b", newHtml: "<h1>head</h1>" },
    ]),
  );
  assert.ok(r.html !== null);
  assert.ok(r.html!.includes("<h1>head</h1>"));
  assert.equal(r.appliedCount, 1);
});

test("applyOps default: insert_after adds sibling", () => {
  const tagged = '<div data-op-id="a"><p data-op-id="b">old</p></div>';
  const r = quiet(() =>
    applyOps(tagged, [
      { type: "insert_after", target: "b", newHtml: "<aside>x</aside>" },
    ]),
  );
  assert.ok(r.html !== null);
  assert.ok(r.html!.includes("<aside>x</aside>"));
  assert.equal(r.appliedCount, 1);
});

test("applyOps default: delete removes target", () => {
  const tagged = '<div data-op-id="a"><p data-op-id="b">gone</p></div>';
  const r = quiet(() =>
    applyOps(tagged, [{ type: "delete", target: "b" }]),
  );
  assert.ok(r.html !== null);
  assert.ok(!r.html!.includes("gone"));
  assert.equal(r.appliedCount, 1);
});

test("applyOps default: missing target → html null + error", () => {
  const tagged = '<div data-op-id="a">x</div>';
  const r = quiet(() =>
    applyOps(tagged, [
      { type: "replace", target: "ghost", newHtml: "<p>nope</p>" },
    ]),
  );
  assert.equal(r.html, null);
  assert.equal(r.appliedCount, 0);
  assert.ok(r.errors.length >= 1);
});

test("applyOps default: non-delete op without newHtml → error", () => {
  const tagged = '<div data-op-id="a">x</div>';
  const r = quiet(() =>
    applyOps(tagged, [{ type: "replace", target: "a" }]),
  );
  assert.equal(r.html, null);
  assert.ok(r.errors.length >= 1);
});

test("applyOps rust-forced: replace produces html with ids stripped", () => {
  const tagged = '<div data-op-id="a"><p data-op-id="b">old</p></div>';
  const r = withEnv({ OPENLEN_SHADOW_APPLY_OPS: "rust" }, () =>
    applyOps(tagged, [
      { type: "replace", target: "b", newHtml: "<p>new</p>" },
    ]),
  );
  assert.ok(r.html !== null);
  assert.ok(r.html!.includes("new"));
  assert.ok(!r.html!.includes("data-op-id"));
});

test("applyOps rust-forced: delete removes target", () => {
  const tagged = '<div data-op-id="a"><p data-op-id="b">gone</p></div>';
  const r = withEnv({ OPENLEN_SHADOW_APPLY_OPS: "rust" }, () =>
    applyOps(tagged, [{ type: "delete", target: "b" }]),
  );
  assert.ok(r.html !== null);
  assert.ok(!r.html!.includes("gone"));
});

test("applyOps rust-forced: missing target reported as error", () => {
  const tagged = '<div data-op-id="a">x</div>';
  const r = withEnv({ OPENLEN_SHADOW_APPLY_OPS: "rust" }, () =>
    applyOps(tagged, [
      { type: "replace", target: "ghost", newHtml: "<p>nope</p>" },
    ]),
  );
  assert.equal(r.html, null);
  assert.ok(r.errors.length >= 1);
});

test("applyOps shadow-prefer-ts: cascade (parent delete + child target) returns TS html with cascade error noted", () => {
  // Parent <section data-op-id="s"> contains child <p data-op-id="p">.
  // Op 1 deletes the section; op 2 tries to replace the now-orphan child.
  // TS phase-2 cascade detection: child unreachable → error logged,
  // visible HTML loses both. Rust's apply_ops handles the same scenario
  // but may report a different `appliedCount` (S1 carry-over). The
  // equalityFn ignores that gap; the test asserts the public contract
  // (HTML lost both, errors recorded).
  const tagged =
    '<section data-op-id="s"><p data-op-id="p">x</p></section>';
  const r = quiet(() =>
    applyOps(tagged, [
      { type: "delete", target: "s" },
      { type: "replace", target: "p", newHtml: "<p>new</p>" },
    ]),
  );
  assert.ok(r.html !== null);
  assert.ok(!r.html!.includes("<section"));
  // At least one error recorded (the cascade miss).
  assert.ok(r.errors.length >= 1);
});

// ─── resolveOpIdByPath ─────────────────────────────────────────────────────

test("resolveOpIdByPath default: empty path → null", () => {
  const r = quiet(() => resolveOpIdByPath('<div data-op-id="a"></div>', ""));
  assert.equal(r, null);
});

test("resolveOpIdByPath default: matches body-level descendant", () => {
  const tagged =
    '<html><body><main data-op-id="m"><section data-op-id="s"><p data-op-id="p">x</p></section></main></body></html>';
  const r = quiet(() =>
    resolveOpIdByPath(tagged, "main > section > p"),
  );
  assert.equal(r, "p");
});

test("resolveOpIdByPath default: no match → null", () => {
  const tagged = '<html><body><div data-op-id="a">x</div></body></html>';
  const r = quiet(() => resolveOpIdByPath(tagged, "main > section"));
  assert.equal(r, null);
});

test("resolveOpIdByPath rust-forced: parity on body-level match", () => {
  const tagged =
    '<html><body><main data-op-id="m"><section data-op-id="s"><p data-op-id="p">x</p></section></main></body></html>';
  const ts = withEnv(
    { OPENLEN_SHADOW_RESOLVE_OP_ID_BY_PATH: "ts" },
    () => resolveOpIdByPath(tagged, "main > section"),
  );
  const rust = withEnv(
    { OPENLEN_SHADOW_RESOLVE_OP_ID_BY_PATH: "rust" },
    () => resolveOpIdByPath(tagged, "main > section"),
  );
  assert.equal(rust, ts);
  assert.equal(rust, "s");
});

// ─── buildScopedView ───────────────────────────────────────────────────────

test("buildScopedView default: missing pin → null", () => {
  const tagged =
    '<html><body><section data-op-id="s"><p data-op-id="p">x</p></section></body></html>';
  const r = quiet(() => buildScopedView(tagged, "ghost"));
  assert.equal(r, null);
});

test("buildScopedView default: walks up to section ancestor", () => {
  const tagged =
    '<html><body><section data-op-id="s"><h2 data-op-id="h">Hi</h2><p data-op-id="p">x</p></section></body></html>';
  const r = quiet(() => buildScopedView(tagged, "p"));
  assert.ok(r !== null);
  assert.equal(r!.containerOpId, "s");
  assert.ok(r!.scopedHtml.includes("<section"));
  assert.ok(r!.scopedHtml.includes('data-op-id="p"'));
});

test("buildScopedView default: outline lists top-level sections", () => {
  const tagged =
    '<html><body><header data-op-id="hd"><h1 data-op-id="h1">Top</h1></header><main data-op-id="m"><section data-op-id="s"><p data-op-id="p">x</p></section></main></body></html>';
  const r = quiet(() => buildScopedView(tagged, "p"));
  assert.ok(r !== null);
  assert.ok(r!.outline.includes("[hd]"));
  assert.ok(r!.outline.includes("[m]"));
});

test("buildScopedView rust-forced: returns same containerOpId + scoped html shape", () => {
  const tagged =
    '<html><body><section data-op-id="s"><h2 data-op-id="h">Hi</h2><p data-op-id="p">x</p></section></body></html>';
  const r = withEnv({ OPENLEN_SHADOW_BUILD_SCOPED_VIEW: "rust" }, () =>
    buildScopedView(tagged, "p"),
  );
  assert.ok(r !== null);
  assert.equal(r!.containerOpId, "s");
  assert.ok(r!.scopedHtml.includes('data-op-id="p"'));
});
