// Tests for the language-cluster annotations (canonical / hreflang /
// switcher / sitemap) — pure string transforms, no DB, no Gemini.
//
// Run via: npx tsx --test lib/publish/language-cluster.test.ts

import { test } from "node:test";
import { strict as assert } from "node:assert";

import {
  annotateLanguageCluster,
  buildRobots,
  buildSitemap,
  detectHtmlLang,
  type ClusterMember,
} from "./language-cluster";

const BASE = "https://miempresa.openlen.com";
const PAGE = `<!doctype html><html lang="es"><head><title>t</title></head><body><h1>Hola</h1></body></html>`;

const CLUSTER: ClusterMember[] = [
  { lang: "es", path: "/" },
  { lang: "en", path: "/en/" },
  { lang: "fr", path: "/fr/" },
];

test("detectHtmlLang: primary subtag, lowercased, null when absent", () => {
  assert.equal(detectHtmlLang(PAGE), "es");
  assert.equal(detectHtmlLang('<html lang="en-US"><body></body></html>'), "en");
  assert.equal(detectHtmlLang("<html><body></body></html>"), null);
});

test("single-language page gets canonical only", () => {
  const out = annotateLanguageCluster(PAGE, {
    baseUrl: BASE,
    selfPath: "/",
    cluster: [{ lang: "es", path: "/" }],
  });
  assert.ok(out.includes(`<link rel="canonical" href="${BASE}/">`));
  assert.ok(!out.includes("hreflang"));
  assert.ok(!out.includes("data-ol-lang-switcher"));
});

test("author canonical is never overridden", () => {
  const withCanonical = PAGE.replace(
    "</head>",
    '<link rel="canonical" href="https://example.com/x"></head>',
  );
  const out = annotateLanguageCluster(withCanonical, {
    baseUrl: BASE,
    selfPath: "/",
    cluster: [{ lang: "es", path: "/" }],
  });
  assert.equal(out.match(/rel="canonical"/g)?.length, 1);
  assert.ok(out.includes("https://example.com/x"));
});

test("multilingual cluster: reciprocal hreflang + x-default on every doc", () => {
  const root = annotateLanguageCluster(PAGE, {
    baseUrl: BASE,
    selfPath: "/",
    cluster: CLUSTER,
  });
  const fr = annotateLanguageCluster(PAGE, {
    baseUrl: BASE,
    selfPath: "/fr/",
    cluster: CLUSTER,
  });
  for (const doc of [root, fr]) {
    assert.ok(doc.includes(`hreflang="es" href="${BASE}/"`));
    assert.ok(doc.includes(`hreflang="en" href="${BASE}/en/"`));
    assert.ok(doc.includes(`hreflang="fr" href="${BASE}/fr/"`));
    assert.ok(doc.includes(`hreflang="x-default" href="${BASE}/"`));
  }
  assert.ok(root.includes(`<link rel="canonical" href="${BASE}/">`));
  assert.ok(fr.includes(`<link rel="canonical" href="${BASE}/fr/">`));
});

test("switcher: pure <a> nav, current page marked, no scripts", () => {
  const fr = annotateLanguageCluster(PAGE, {
    baseUrl: BASE,
    selfPath: "/fr/",
    cluster: CLUSTER,
  });
  assert.ok(fr.includes("data-ol-lang-switcher"));
  assert.ok(fr.includes('<a href="/fr/" aria-current="page"'));
  assert.ok(fr.includes('<a href="/" '));
  assert.ok(fr.includes(">FR</a>"));
  assert.ok(!fr.includes("<script"));
});

test("annotations are idempotent on re-run", () => {
  const opts = { baseUrl: BASE, selfPath: "/", cluster: CLUSTER };
  const once = annotateLanguageCluster(PAGE, opts);
  const twice = annotateLanguageCluster(once, opts);
  assert.equal(once, twice);
});

test("sitemap: one url per member with reciprocal alternates", () => {
  const xml = buildSitemap(BASE, CLUSTER);
  assert.equal(xml.match(/<url>/g)?.length, 3);
  assert.ok(xml.includes(`<loc>${BASE}/en/</loc>`));
  assert.equal(xml.match(/hreflang="fr"/g)?.length, 3);
  assert.ok(xml.includes('xmlns:xhtml="http://www.w3.org/1999/xhtml"'));
});

test("sitemap: single-language has no alternates namespace", () => {
  const xml = buildSitemap(BASE, [{ lang: "es", path: "/" }]);
  assert.equal(xml.match(/<url>/g)?.length, 1);
  assert.ok(!xml.includes("xhtml"));
});

test("robots points at the sitemap", () => {
  const robots = buildRobots(BASE);
  assert.ok(robots.includes("Allow: /"));
  assert.ok(robots.includes(`Sitemap: ${BASE}/sitemap.xml`));
});
