// Multi-page publish — the release must carry every site page through the
// same bake as home, atomically, with sane SEO (own canonical, sitemap
// entries outside the hreflang cluster).
// Run: npx tsx --test lib/publish/multi-page-publish.test.ts
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Network-touching bakes off; CSP seal stays on (pure Rust, no network) so
// the test proves pages survive the real seal.
process.env.OPENLEN_IMAGE_BAKE = "0";
process.env.OPENLEN_FONT_BAKE = "0";
process.env.OPENLEN_LOCALIZE = "0";

const root = mkdtempSync(path.join(tmpdir(), "olpub-"));
process.env.PUBLISH_ROOT = root;

import { publishToDir } from "./filesystem";

const DOC = (label: string) => `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>${label}</title>
<style>:root{--ol-bg:#fff}</style></head>
<body><h1>${label}</h1><p>contenido ${label}</p></body></html>`;

describe("publishToDir with site pages", () => {
  before(async () => {
    await publishToDir({
      subdomain: "multitest",
      html: DOC("home"),
      pages: [
        { slug: "menu", html: DOC("menu") },
        { slug: "sobre-mi", html: DOC("sobre") },
      ],
    });
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  const releaseDir = () => {
    const current = path.join(root, "multitest", "current");
    // Windows test env writes a sha marker file instead of a symlink.
    try {
      const sha = readFileSync(current, "utf8").trim();
      return path.join(root, "multitest", "releases", sha);
    } catch {
      return current;
    }
  };

  it("writes every page into the same release", () => {
    const dir = releaseDir();
    assert.ok(existsSync(path.join(dir, "index.html")));
    assert.ok(existsSync(path.join(dir, "menu", "index.html")));
    assert.ok(existsSync(path.join(dir, "sobre-mi", "index.html")));
  });

  it("each page keeps its own content and gets its own canonical", () => {
    const menu = readFileSync(path.join(releaseDir(), "menu", "index.html"), "utf8");
    assert.ok(menu.includes("contenido menu"));
    assert.ok(
      menu.includes('rel="canonical" href="https://multitest.openlen.com/menu/"'),
    );
    // No hreflang cluster on a subpage — it is not a language alternate.
    assert.ok(!menu.includes("hreflang"));
  });

  it("pages are CSP-sealed like home", () => {
    const home = readFileSync(path.join(releaseDir(), "index.html"), "utf8");
    const menu = readFileSync(path.join(releaseDir(), "menu", "index.html"), "utf8");
    const sealed = (s: string) => s.includes("Content-Security-Policy");
    assert.equal(sealed(menu), sealed(home));
  });

  it("sitemap lists the pages as plain entries", () => {
    const sitemap = readFileSync(path.join(releaseDir(), "sitemap.xml"), "utf8");
    assert.ok(sitemap.includes("https://multitest.openlen.com/menu/"));
    assert.ok(sitemap.includes("https://multitest.openlen.com/sobre-mi/"));
  });

  it("a page with editor markers fails the WHOLE publish", async () => {
    await assert.rejects(
      publishToDir({
        subdomain: "multitest",
        html: DOC("home"),
        pages: [{ slug: "mala", html: '<html><body data-slot-path="x">x</body></html>' }],
      }),
      /data-slot-path/,
    );
  });

  it("republishing identical content dedupes to the same sha", async () => {
    const a = await publishToDir({
      subdomain: "multitest",
      html: DOC("home"),
      pages: [
        { slug: "menu", html: DOC("menu") },
        { slug: "sobre-mi", html: DOC("sobre") },
      ],
    });
    assert.equal(a.written, false);
    assert.deepEqual(a.pages, ["menu", "sobre-mi"]);
  });
});
