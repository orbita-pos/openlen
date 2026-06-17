// Tests for the publish-time URL self-cleaner (lib/publish/tracking-strip.ts):
// the injection contract (placement + idempotency) AND the runtime strip logic
// (executed against a fake location/history so we verify real behavior, not
// just that a string was inserted).
//
// Run via: npx tsx --test lib/publish/tracking-strip.test.ts

import { test } from "node:test";
import { strict as assert } from "node:assert";

import { injectTrackingStrip } from "./tracking-strip";

const PAGE =
  '<!doctype html><html lang="es"><head><title>t</title></head><body><h1>Hi</h1></body></html>';

test("injects the marked script just before </body>", () => {
  const out = injectTrackingStrip(PAGE);
  assert.ok(out.includes("data-ol-noparams"));
  assert.ok(out.includes("history.replaceState"));
  // Script sits inside the body, before the close tag.
  assert.ok(out.indexOf("data-ol-noparams") < out.indexOf("</body>"));
});

test("idempotent — an already-cleaned page is byte-equal", () => {
  const once = injectTrackingStrip(PAGE);
  const twice = injectTrackingStrip(once);
  assert.equal(once, twice);
});

test("appends when there's no </body>", () => {
  const frag = "<main><p>x</p></main>";
  const out = injectTrackingStrip(frag);
  assert.ok(out.startsWith(frag));
  assert.ok(out.includes("data-ol-noparams"));
});

test("the IIFE is self-contained and parses", () => {
  const js = extractScript(injectTrackingStrip("<body></body>"));
  assert.doesNotThrow(() => new Function("location", "history", "URL", js));
});

// ── runtime behavior ────────────────────────────────────────────────────────
// Run the injected IIFE with a fake location/history and return the URL passed
// to history.replaceState (null when the script left the URL untouched). The
// fake location is parsed from a real URL so search/pathname/hash match what a
// browser would expose.
function runClean(href: string): string | null {
  const js = extractScript(injectTrackingStrip("<body></body>"));
  const u = new URL(href);
  let replaced: string | null = null;
  const fakeHistory = {
    replaceState: (_s: unknown, _t: unknown, url: string) => {
      replaced = url;
    },
  };
  new Function("location", "history", js)(
    { search: u.search, pathname: u.pathname, hash: u.hash },
    fakeHistory,
  );
  return replaced;
}

function extractScript(html: string): string {
  const m = html.match(/<script[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error("no script found");
  return m[1];
}

test("strips fbclid down to a clean path", () => {
  assert.equal(runClean("https://x.com/?fbclid=PAVERFWASfJ123"), "/");
});

test("strips utm_* but keeps a legit query param", () => {
  assert.equal(
    runClean("https://x.com/page?utm_source=ig&utm_medium=bio&id=5"),
    "/page?id=5",
  );
});

test("preserves the hash fragment", () => {
  assert.equal(runClean("https://x.com/p?fbclid=z#runas"), "/p#runas");
});

test("no tracking params ⇒ replaceState is never called", () => {
  assert.equal(runClean("https://x.com/p?id=5"), null);
  assert.equal(runClean("https://x.com/"), null);
});

// Byte-preservation: surviving params must come back EXACTLY as received — no
// re-encoding of the rest of the query just because a tracker was removed.
test("keeps %20 in a surviving value verbatim (no + collapse)", () => {
  assert.equal(runClean("https://x.com/p?q=a%20b&fbclid=1"), "/p?q=a%20b");
});

test("keeps a semicolon in a surviving value verbatim", () => {
  assert.equal(runClean("https://x.com/p?a=1;2&fbclid=1"), "/p?a=1;2");
});

test("keeps a value-less surviving key without adding '='", () => {
  assert.equal(runClean("https://x.com/p?flag&fbclid=1"), "/p?flag");
});

test("keeps an encoded URL-in-value verbatim", () => {
  assert.equal(
    runClean("https://x.com/p?redirect=https%3A%2F%2Fy.com%2Fa%3Fb%3Dc&fbclid=1"),
    "/p?redirect=https%3A%2F%2Fy.com%2Fa%3Fb%3Dc",
  );
});

test("drops the tracker when it's first, keeping the rest verbatim", () => {
  assert.equal(runClean("https://x.com/p?fbclid=1&q=a%20b&id=5"), "/p?q=a%20b&id=5");
});
