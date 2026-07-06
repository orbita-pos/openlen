// Run: npx tsx --test lib/projects/site-pages.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildAutoMembersPage,
  buildPageShell,
  listSitePages,
  MAX_SITE_PAGES,
  membersGatingEnabled,
  pagesForPublish,
  pageTitle,
  sitePagesFingerprintInput,
  splitPagesForPublish,
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
    for (const s of ["assets", "c", "api", "uploads", "index", "404", "es", "ja", "EN", "cuenta", "account"]) {
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

describe("members gating", () => {
  const gatedData: ProjectData = {
    html: "<html>home</html>",
    settings: { members: { enabled: true } },
    pages: {
      menu: { html: "<html>menu</html>" },
      privada: { html: "<html>secret</html>", membersOnly: true },
    },
  };

  it("membersGatingEnabled requires the explicit switch", () => {
    assert.equal(membersGatingEnabled(gatedData), true);
    assert.equal(membersGatingEnabled({ html: "x" }), false);
    assert.equal(membersGatingEnabled(null), false);
    assert.equal(
      membersGatingEnabled({ html: "x", settings: { members: {} } }),
      false,
    );
  });

  it("splitPagesForPublish separates gated pages when the module is on", () => {
    const { publicPages, gatedPages } = splitPagesForPublish(gatedData);
    assert.deepEqual(publicPages, [{ slug: "menu", html: "<html>menu</html>" }]);
    assert.deepEqual(gatedPages, [
      { slug: "privada", html: "<html>secret</html>" },
    ]);
  });

  it("flags are inert while the module is off — everything publishes public", () => {
    const off: ProjectData = {
      ...gatedData,
      settings: { members: { enabled: false } },
    };
    const { publicPages, gatedPages } = splitPagesForPublish(off);
    assert.equal(gatedPages.length, 0);
    assert.equal(publicPages.length, 2);
    // pagesForPublish keeps returning the full set either way (snapshots).
    assert.equal(pagesForPublish(gatedData).length, 2);
  });

  it("listSitePages marks gated pages, only when flagged", () => {
    assert.deepEqual(listSitePages(gatedData), [
      { slug: "menu", title: "Menu" },
      { slug: "privada", title: "Privada", membersOnly: true },
    ]);
  });

  it("fingerprint input is byte-identical to the legacy stream when nothing is gated", () => {
    const plain: ProjectData = {
      html: "<html>home</html>",
      pages: {
        menu: { html: "<html>menu</html>" },
        "sobre-mi": { html: "<html>about</html>" },
      },
    };
    const NUL = String.fromCharCode(0);
    assert.deepEqual(sitePagesFingerprintInput(plain), [
      `menu${NUL}<html>menu</html>${NUL}`,
      `sobre-mi${NUL}<html>about</html>${NUL}`,
    ]);
    // A membersOnly flag with the module OFF must not move the hash either.
    const flaggedModuleOff: ProjectData = {
      ...plain,
      pages: {
        ...plain.pages,
        menu: { html: "<html>menu</html>", membersOnly: true },
      },
    };
    assert.deepEqual(
      sitePagesFingerprintInput(flaggedModuleOff),
      sitePagesFingerprintInput(plain),
    );
  });

  it("an effectively gated page appends the marker and changes the stream", () => {
    const parts = sitePagesFingerprintInput(gatedData);
    const NUL = String.fromCharCode(0);
    assert.equal(parts[1], `privada${NUL}<html>secret</html>${NUL}m${NUL}`);
    const ungated = sitePagesFingerprintInput({
      ...gatedData,
      settings: { members: { enabled: false } },
    });
    assert.notDeepEqual(parts, ungated);
  });
});

describe("buildAutoMembersPage", () => {
  const HOME_ES = `<!doctype html><html lang="es"><head><title>Mi Negocio</title></head>
<body><header><nav>menu</nav></header><section>contenido</section><footer>pie</footer></body></html>`;
  const HOME_EN = HOME_ES.replace('lang="es"', 'lang="en"');

  it("births /miembros for Spanish sites, wearing the shell + logout link", () => {
    const created = buildAutoMembersPage({ html: HOME_ES });
    assert.ok(created);
    assert.equal(created.slug, "miembros");
    assert.equal(created.title, "Zona de miembros");
    assert.ok(created.html.includes("<nav>menu</nav>")); // site chrome kept
    assert.ok(created.html.includes("pie"));
    assert.ok(created.html.includes("Zona de miembros"));
    assert.ok(created.html.includes("data-ol-logout"));
    assert.ok(created.html.includes("Cerrar sesión"));
  });

  it("births /members for non-Spanish sites", () => {
    const created = buildAutoMembersPage({ html: HOME_EN });
    assert.ok(created);
    assert.equal(created.slug, "members");
    assert.ok(created.html.includes("Log out"));
  });

  it("skips when a gated page already exists", () => {
    assert.equal(
      buildAutoMembersPage({
        html: HOME_ES,
        pages: { privada: { html: "<html>x</html>", membersOnly: true } },
      }),
      null,
    );
  });

  it("falls to the alternate slug when the first is taken; null when both are", () => {
    const oneTaken = buildAutoMembersPage({
      html: HOME_ES,
      pages: { miembros: { html: "<html>x</html>" } },
    });
    assert.equal(oneTaken?.slug, "members");
    assert.equal(
      buildAutoMembersPage({
        html: HOME_ES,
        pages: {
          miembros: { html: "<html>x</html>" },
          members: { html: "<html>y</html>" },
        },
      }),
      null,
    );
  });

  it("never throws on an unparseable home — just declines", () => {
    assert.equal(buildAutoMembersPage({ html: "sin body" }), null);
    assert.equal(buildAutoMembersPage(null), null);
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
