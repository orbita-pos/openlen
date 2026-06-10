// Run: npx tsx --test lib/projects/site-pages.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  listSitePages,
  MAX_SITE_PAGES,
  pagesForPublish,
  pageTitle,
  validatePageSlug,
} from "./site-pages";
import type { ProjectData } from "./types";

describe("validatePageSlug", () => {
  it("accepts clean slugs", () => {
    for (const s of ["menu", "sobre-mi", "precios2026", "a", "x9"]) {
      const r = validatePageSlug(s);
      assert.deepEqual(r, { ok: true, slug: s });
    }
  });

  it("normalizes user input — case, slashes, spaces, double hyphens", () => {
    assert.deepEqual(validatePageSlug("/Menu/"), { ok: true, slug: "menu" });
    assert.deepEqual(validatePageSlug("mi  pagina"), { ok: true, slug: "mi-pagina" });
    assert.deepEqual(validatePageSlug("a--b"), { ok: true, slug: "a-b" });
  });

  it("rejects malformed slugs", () => {
    for (const s of ["", "-x", "x-", "ñame", "a/b", "a".repeat(50), "con espacios -"]) {
      assert.equal(validatePageSlug(s).ok, false, s);
    }
  });

  it("rejects every reserved path a published sub already owns", () => {
    for (const s of ["assets", "c", "api", "uploads", "index", "404", "es", "ja", "EN"]) {
      const r = validatePageSlug(s);
      assert.equal(r.ok, false, s);
      if (!r.ok) assert.equal(r.reason, "reserved", s);
    }
    // Shapes the slug regex already excludes (underscore, dot) — rejected
    // as invalid before the reserved check even runs. Equally safe.
    for (const s of ["_system", "sitemap.xml", "robots.txt"]) {
      assert.equal(validatePageSlug(s).ok, false, s);
    }
  });

  it("caps a site at MAX_SITE_PAGES", () => {
    assert.ok(MAX_SITE_PAGES >= 10 && MAX_SITE_PAGES <= 50);
  });
});

describe("listing + publish helpers", () => {
  const data: ProjectData = {
    html: "<html>home</html>",
    pages: {
      menu: { html: "<html>menu</html>" },
      "sobre-mi": { html: "<html>about</html>", title: "Sobre mí" },
      vacia: { html: "" },
    },
  };

  it("listSitePages is sorted and display-titled", () => {
    assert.deepEqual(listSitePages(data), [
      { slug: "menu", title: "Menu" },
      { slug: "sobre-mi", title: "Sobre mí" },
      { slug: "vacia", title: "Vacia" },
    ]);
    assert.deepEqual(listSitePages({ html: "x" }), []);
    assert.deepEqual(listSitePages(null), []);
  });

  it("pageTitle falls back to a humanized slug", () => {
    assert.equal(pageTitle("sobre-mi", undefined), "Sobre mi");
    assert.equal(pageTitle("x", { html: "", title: "  " }), "X");
  });

  it("pagesForPublish drops empty documents", () => {
    assert.deepEqual(pagesForPublish(data), [
      { slug: "menu", html: "<html>menu</html>" },
      { slug: "sobre-mi", html: "<html>about</html>" },
    ]);
    assert.deepEqual(pagesForPublish(undefined), []);
  });
});
