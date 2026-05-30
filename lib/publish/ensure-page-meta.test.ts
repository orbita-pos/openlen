// Tests for ensurePageMeta — the born-complete <head> pass that makes a page
// land SEO-healthy in the Page Health panel without any user action.
//
// Pure string logic (no Rust binding), so it runs standalone:
//   npx tsx --test lib/publish/ensure-page-meta.test.ts

import { test } from "node:test";
import { strict as assert } from "node:assert";

import { ensurePageMeta } from "./ensure-page-meta";

const DOC = (head = "", body = "<h1>Acme</h1><p>We make the best widgets in the entire world for teams that care about quality and speed.</p>") =>
  `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

function metaContent(html: string, attr: string, value: string): string | null {
  const re = /<meta\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const a = m[0].match(new RegExp(`\\b${attr}\\s*=\\s*"([^"]*)"`, "i"));
    if (a && a[1].toLowerCase() === value.toLowerCase()) {
      const c = m[0].match(/\bcontent\s*=\s*"([^"]*)"/i);
      return c ? c[1] : null;
    }
  }
  return null;
}

function faviconHref(html: string): string | null {
  const re = /<link\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const rel = m[0].match(/\brel\s*=\s*"([^"]*)"/i);
    if (rel && rel[1].includes("icon")) {
      const href = m[0].match(/\bhref\s*=\s*"([^"]*)"/i);
      return href ? href[1] : null;
    }
  }
  return null;
}

test("empty / headless input is a no-op", () => {
  assert.equal(ensurePageMeta(""), "");
  assert.equal(ensurePageMeta("<p>fragment</p>"), "<p>fragment</p>");
});

test("fills all four missing head tags", () => {
  const out = ensurePageMeta(DOC(), { title: "Acme Widgets" });
  assert.ok(metaContent(out, "name", "description"), "description added");
  assert.equal(metaContent(out, "property", "og:title"), "Acme Widgets");
  assert.ok(metaContent(out, "property", "og:image"), "og:image added");
  assert.ok(faviconHref(out), "favicon added");
});

test("description is derived from the page's own copy", () => {
  const out = ensurePageMeta(DOC(), { title: "Acme Widgets" });
  const desc = metaContent(out, "name", "description") ?? "";
  assert.ok(desc.includes("widgets"), `expected body copy, got: ${desc}`);
  assert.ok(desc.length <= 161, "description trimmed to a sane length");
});

test("og:image uses an absolute hero image when present", () => {
  const out = ensurePageMeta(
    DOC("", '<img src="https://images.example.com/hero.jpg"><h1>Hi</h1>'),
    { title: "Page" },
  );
  assert.equal(
    metaContent(out, "property", "og:image"),
    "https://images.example.com/hero.jpg",
  );
});

test("og:image falls back to a base64 branded card when there's no image", () => {
  const out = ensurePageMeta(DOC("", "<h1>Just text</h1><p>No images here at all on this page.</p>"), {
    title: "Just Text",
  });
  const og = metaContent(out, "property", "og:image") ?? "";
  assert.ok(og.startsWith("data:image/svg+xml;base64,"), `got: ${og.slice(0, 40)}`);
});

test("relative / api-asset images are NOT used for og:image", () => {
  const out = ensurePageMeta(
    DOC("", '<img src="/assets/local.webp"><h1>Hi</h1><p>Body copy goes here for the description.</p>'),
    { title: "Page" },
  );
  const og = metaContent(out, "property", "og:image") ?? "";
  assert.ok(og.startsWith("data:image/svg+xml;base64,"), "relative src skipped → card");
});

test("non-destructive: existing tags are preserved", () => {
  const head = [
    "<title>Original Title</title>",
    '<meta name="description" content="Hand-written description that the user already set on the page.">',
    '<meta property="og:image" content="https://cdn.example.com/custom-card.png">',
    '<link rel="icon" href="/favicon.ico">',
  ].join("");
  const out = ensurePageMeta(DOC(head), { title: "Ignored" });
  assert.ok(out.includes("<title>Original Title</title>"));
  assert.equal(
    metaContent(out, "name", "description"),
    "Hand-written description that the user already set on the page.",
  );
  assert.equal(
    metaContent(out, "property", "og:image"),
    "https://cdn.example.com/custom-card.png",
  );
  assert.equal(faviconHref(out), "/favicon.ico");
  // og:title was the only missing one.
  assert.equal(metaContent(out, "property", "og:title"), "Original Title");
});

test("idempotent — second pass changes nothing", () => {
  const once = ensurePageMeta(DOC(), { title: "Acme Widgets" });
  const twice = ensurePageMeta(once, { title: "Acme Widgets" });
  assert.equal(twice, once);
});

test("title falls back to first <h1> when no title / opts given", () => {
  const out = ensurePageMeta(DOC("", "<h1>Heading Wins</h1><p>Some copy.</p>"));
  assert.ok(out.includes("<title>Heading Wins</title>"));
  assert.equal(metaContent(out, "property", "og:title"), "Heading Wins");
});

test("an existing empty <title> gets filled", () => {
  const out = ensurePageMeta(DOC("<title></title>"), { title: "Real Title" });
  assert.ok(out.includes("<title>Real Title</title>"));
  assert.ok(!/<title>\s*<\/title>/.test(out), "no empty title left behind");
});

test("attribute values are escaped", () => {
  const out = ensurePageMeta(DOC("", '<h1>A & B</h1><p>Copy with <em>tags</em> & ampersands inside it here.</p>'), {
    title: 'Tom & "Jerry"',
  });
  assert.ok(out.includes('content="Tom &amp; &quot;Jerry&quot;"'), "og:title escaped");
  // description came from body copy with an entity-decoded ampersand, re-escaped.
  const descTag = out.match(/<meta name="description"[^>]*>/i)?.[0] ?? "";
  assert.ok(!/&(?!amp;|quot;|lt;|gt;)/.test(descTag), "no raw ampersand in description attr");
});
