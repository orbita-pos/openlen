// Run: npx tsx --test lib/projects/site-pages.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildPageShell,
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

describe("buildPageShell", () => {
  const home = `<!doctype html>
<html lang="es" data-ol-tematica="coquette" style="--ol-bg:#fff7fa">
<head><meta charset="utf-8"><title>Mi Negocio</title>
<style data-ol-tematica>html::before{content:""}</style></head>
<body>
<header><nav><a href="/">Inicio</a><a href="/precios">Precios</a></nav></header>
<section id="hero"><h1>Bienvenido</h1></section>
<section id="testimonios"><p>opiniones</p></section>
<footer><small>© Mi Negocio</small></footer>
</body></html>`;

  it("keeps the head + html attrs (look + temática survive), swaps the title", () => {
    const shell = buildPageShell(home, "Precios")!;
    assert.ok(shell.includes('data-ol-tematica="coquette"'));
    assert.ok(shell.includes("--ol-bg:#fff7fa"));
    assert.ok(shell.includes("<style data-ol-tematica>"));
    assert.ok(shell.includes("<title>Precios</title>"));
    assert.ok(!shell.includes("<title>Mi Negocio</title>"));
  });

  it("keeps nav + footer, drops the middle content, adds a titled hero", () => {
    const shell = buildPageShell(home, "Precios")!;
    assert.ok(shell.includes('href="/precios"'));
    assert.ok(shell.includes("© Mi Negocio"));
    assert.ok(!shell.includes("Bienvenido"));
    assert.ok(!shell.includes("opiniones"));
    assert.ok(shell.includes("<h1 style=") && shell.includes(">Precios</h1>"));
    // Spanish page → Spanish placeholder.
    assert.ok(shell.includes("lista para tu contenido"));
  });

  it("escapes the title and survives a chrome-less home", () => {
    const bare = `<html lang="en"><head><title>x</title></head><body><div>solo</div></body></html>`;
    const shell = buildPageShell(bare, `<img src=x onerror=1>`)!;
    assert.ok(!shell.includes("<img src=x"));
    assert.ok(shell.includes("&lt;img src=x onerror=1&gt;"));
    assert.ok(!shell.includes("solo"));
    assert.ok(shell.includes("ready for your content"));
  });

  it("returns null when the home document has no body", () => {
    assert.equal(buildPageShell("<html><head></head></html>", "x"), null);
  });
});
