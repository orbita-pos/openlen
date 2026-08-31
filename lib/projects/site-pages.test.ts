// Run: npx tsx --test lib/projects/site-pages.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildAutoMembersPage,
  buildPageShell,
  listSitePages,
  MAX_SITE_PAGES,
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

/**
 * LA COMPATIBILIDAD DE LA HUELLA, que era «load-bearing».
 *
 * Aquí vivía el describe de restricción por miembros. El módulo se retiró el
 * 2026-08-21, y su comentario avisaba de algo que ahora importa MÁS: sin nada
 * restringido, la huella produce exactamente el flujo legado. Si eso se rompe,
 * TODO sitio multipágina ya publicado enseña una píldora de deriva fantasma —
 * un cambio que nadie hizo.
 */
describe("huella de páginas", () => {
  it("es byte a byte el flujo legado", () => {
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
  });

  // Los proyectos viejos conservan `membersOnly` en su fila: el módulo se
  // retiró, no se migraron los datos. Ese resto NO puede mover el hash.
  it("un membersOnly heredado no mueve la huella", () => {
    const plain: ProjectData = {
      html: "<html>home</html>",
      pages: { menu: { html: "<html>menu</html>" } },
    };
    const heredado: ProjectData = {
      ...plain,
      pages: { menu: { html: "<html>menu</html>", membersOnly: true } },
    };
    assert.deepEqual(
      sitePagesFingerprintInput(heredado),
      sitePagesFingerprintInput(plain),
    );
  });

  it("todas las páginas publican públicas", () => {
    const d: ProjectData = {
      html: "<html>home</html>",
      pages: {
        publica: { html: "<html>a</html>" },
        privada: { html: "<html>b</html>", membersOnly: true },
      },
    };
    const { publicPages, gatedPages } = splitPagesForPublish(d);
    assert.equal(gatedPages.length, 0);
    assert.deepEqual(publicPages.map((p) => p.slug).sort(), ["privada", "publica"]);
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

  // 🔴 EL LOGO LLEVA A LA PORTADA — 2026-08-31.
  //
  // MEDIDO sobre el corpus: 7 de 12 subpáginas (58%) tenían su logo en
  // `href="#"`, así que pulsarlo desde /nosotros te dejaba en /nosotros# — sin
  // ir a ninguna parte y sin un solo error. Jesús lo vio, se lo pidió al
  // Agente, y el Agente lo arregló EN LA HOME dejando la subpágina igual. No
  // era despiste del modelo: el armazón nacía así.
  //
  // El contrato manda poner `href="#"` cuando no hay destino, y por eso
  // `anclasALaPortada` lo deja intacto a propósito. Correcto para un botón;
  // equivocado para el logo, que no es un botón sin destino.
  const homeLogoMuerto = `<!doctype html><html lang="es"><head><title>X</title></head><body>
<header><nav><a href="#"><img src="logo.png" alt="X"></a><a href="#precios">Precios</a><button>Vacío</button></nav></header>
<section id="hero"><h1>Hola</h1></section>
<footer><a href="#">pie</a></footer>
</body></html>`;

  it("🔴 el logo de la cabecera apunta a la portada, no a '#'", () => {
    const shell = buildPageShell(homeLogoMuerto, "Nosotros")!;
    const header = /<header[\s\S]*?<\/header>/i.exec(shell)![0];
    assert.ok(header.includes('href="/"'), `el logo sigue muerto: ${header}`);
    assert.ok(!/<a\s+href="#"/.test(header), "quedó un href='#' en la cabecera");
  });

  it("y las anclas del menú siguen yendo a la portada", () => {
    // El arreglo del logo no puede pisar lo que ya funcionaba.
    assert.ok(buildPageShell(homeLogoMuerto, "Nosotros")!.includes('href="/#precios"'));
  });

  // BRAZO DE CONTROL: sólo el PRIMER <a> de la cabecera. Un `href="#"` en el
  // pie —o en cualquier otro sitio— sigue intacto: es lo que el contrato manda
  // poner cuando no hay destino, y convertirlo en "/" mandaría a la portada a
  // quien pulse algo que debía no hacer nada.
  // 🔴 SEGUNDO BRAZO DE CONTROL, y me lo enseñó una prueba AJENA
  // (`construir-paginas-declaradas.test.ts`) al ponerse roja: mi primera
  // versión tocaba el primer <a> y punto. Pero un menú puede empezar por un
  // BOTÓN sin destino —`<a href="#">Reservar</a>`— y mandarlo a la portada es
  // justo el fallo del que `anclasALaPortada` ya se cuidaba.
  it("y un BOTÓN sin destino al principio del nav tampoco es el logo", () => {
    const conBoton = `<!doctype html><html lang="es"><head><title>X</title></head><body>
<header><nav><a href="#">Reservar</a><a href="#precios">Precios</a></nav></header>
<section id="hero"><h1>Hola</h1></section><footer>pie</footer>
</body></html>`;
    const header = /<header[\s\S]*?<\/header>/i.exec(buildPageShell(conBoton, "N")!)![0];
    assert.ok(header.includes('href="#"'), `mandó un botón a la portada: ${header}`);
    assert.ok(header.includes(">Reservar<"));
  });

  it("pero un href='#' fuera del logo NO se toca", () => {
    const shell = buildPageShell(homeLogoMuerto, "Nosotros")!;
    const footer = /<footer[\s\S]*?<\/footer>/i.exec(shell)![0];
    assert.ok(footer.includes('href="#"'), `el pie se tocó: ${footer}`);
  });

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

describe("buildPageShell — chrome extraction on real-world markup", () => {
  // Foundry/Manuscript shape: the real navbar is a styled DIV capsule (fixed,
  // rounded) with an inner <nav>, and the hero carries a second decorative
  // <header> (logo + links, no h1). The capsule must win, whole wrapper included.
  const capsuleHome = `<!doctype html><html lang="en"><head><title>Foundry</title></head>
<body class="min-h-screen">
<div class="fixed top-4 left-1/2 z-50 max-w-[680px]">
  <div class="tabbar border rounded-full flex items-center">
    <span class="serif">Foundry</span>
    <nav class="ml-auto flex gap-4">
      <a href="#issues">Issues</a><a href="#letter">Letter</a>
      <a href="#join" class="btn-primary rounded-full">Subscribe</a>
    </nav>
  </div>
</div>
<section class="hero mesh">
  <header class="flex justify-between"><span>Foundry</span><span>Est. MMXX</span>
    <nav class="hidden md:flex"><a href="#archive">Archive</a></nav>
  </header>
  <h1>Engineering, written like it matters.</h1>
  <p>Four issues a year.</p>
</section>
<section id="content"><p>middle content</p></section>
<footer class="border-t"><small>© Foundry</small></footer>
</body></html>`;

  it("captures the styled DIV capsule around the nav, not the bare inner <nav>", () => {
    const shell = buildPageShell(capsuleHome, "Catalog")!;
    assert.ok(shell.includes('class="fixed top-4'), "capsule wrapper kept");
    assert.ok(shell.includes("tabbar"), "capsule styling kept");
    assert.ok(shell.includes("Subscribe"), "capsule CTA kept");
  });

  it("drops the hero's decorative header instead of promoting it to navbar", () => {
    const shell = buildPageShell(capsuleHome, "Catalog")!;
    assert.ok(!shell.includes("Est. MMXX"), "hero header not promoted");
    assert.ok(!shell.includes("Engineering, written"), "hero content dropped");
  });

  it("skips a hero <header> that carries the h1 and finds the real navbar below", () => {
    const home = `<html lang="en"><head><title>x</title></head><body>
<section class="hero"><header class="hero-head"><h1>Big Title</h1><p>tag</p></header></section>
<header class="site-nav"><nav><a href="/a">A</a><a href="/b">B</a></nav></header>
<section><p>content</p></section>
<footer><small>fin</small></footer>
</body></html>`;
    const shell = buildPageShell(home, "Nueva")!;
    assert.ok(!shell.includes("Big Title"), "h1 header rejected as navbar");
    assert.ok(shell.includes('class="site-nav"'), "real navbar captured");
  });

  it("inherits a div-based footer via the © heuristic", () => {
    const home = `<html lang="en"><head><title>x</title></head><body>
<header><nav><a href="/">Home</a></nav></header>
<section><p>content that goes on for a while in the middle of the page</p></section>
<div class="foot dark"><p>© Acme Studio</p><a href="/privacy">Privacy</a></div>
</body></html>`;
    const shell = buildPageShell(home, "Nueva")!;
    assert.ok(shell.includes("© Acme Studio"), "div footer inherited");
    assert.ok(shell.includes('class="foot dark"'), "footer wrapper kept");
  });

  it("expands a semantic footer to its styled wrapper div", () => {
    const home = `<html lang="en"><head><title>x</title></head><body>
<header><nav><a href="/">Home</a></nav></header>
<section><p>middle middle middle middle middle middle middle</p></section>
<div class="footer-band bg-black"><footer><small>© Wrap Co</small></footer></div>
</body></html>`;
    const shell = buildPageShell(home, "Nueva")!;
    assert.ok(shell.includes('class="footer-band bg-black"'), "wrapper captured");
    assert.ok(shell.includes("© Wrap Co"));
  });

  it("does not duplicate a footer-only nav as a top navbar", () => {
    const home = `<html lang="en"><head><title>x</title></head><body>
<section><h1>Landing</h1><p>content</p></section>
<footer><nav><a href="/x">FootLink</a></nav><small>©</small></footer>
</body></html>`;
    const shell = buildPageShell(home, "Nueva")!;
    const hits = shell.split("FootLink").length - 1;
    assert.equal(hits, 1, "footer nav appears exactly once");
  });
});

describe("buildPageShell — adversarial edges", () => {
  it("survives multi-byte lowering (İ) without losing the footer wrapper", () => {
    const home = `<html lang="tr"><head><title>x</title></head><body>
<header class="site"><nav><a href="/">Ana</a></nav></header>
<section><h1>İstanbul İçin İyi İş — İletişim, İnceleme, İzmir, İçel, İdeal</h1></section>
<style>.brand{color:red}</style>
<footer class="real"><small>© Marka</small></footer>
</body></html>`;
    const shell = buildPageShell(home, "Nueva")!;
    assert.ok(shell.includes('class="real"'), "footer wrapper kept despite İ");
    assert.ok(shell.includes("© Marka"));
  });

  it("ignores markup inside <pre> code samples", () => {
    const home = `<html lang="en"><head><title>x</title></head><body>
<section><h1>How to build a nav</h1>
<pre><code><nav class="from-code-sample"><a href="#">x</a></nav>
<footer class="from-code-sample"><small>© Example</small></footer></code></pre></section>
<header class="site-real"><nav><a href="/">Home</a></nav></header>
<section><p>content</p></section>
<footer class="real"><small>© Real</small></footer>
</body></html>`;
    const shell = buildPageShell(home, "Nueva")!;
    assert.ok(!shell.includes("from-code-sample"), "code sample not promoted");
    assert.ok(shell.includes('class="site-real"'), "real navbar captured");
    assert.ok(shell.includes("© Real"));
  });

  it("does not absorb an h2 CTA band into the footer wrapper", () => {
    const copy = "<p>Marketing copy paragraph with plenty of words in it. </p>".repeat(20);
    const home = `<html lang="en"><head><title>x</title></head><body>
<header><nav><a href="/">Home</a></nav></header>
<section><h1>Hero</h1>${copy}</section>
<div class="end-band"><div class="cta"><h2>Ready to start?</h2><a href="/go">Go</a></div>
<footer><small>© Acme</small></footer></div>
</body></html>`;
    const shell = buildPageShell(home, "Nueva")!;
    assert.ok(!shell.includes("Ready to start?"), "CTA band left behind");
    assert.ok(shell.includes("© Acme"), "semantic footer kept");
  });

  it("does not promote a mid-page photo credit © as the footer", () => {
    const copy = "<p>Long portfolio copy paragraph with plenty of text. </p>".repeat(20);
    const home = `<html lang="en"><head><title>x</title></head><body>
<header><nav><a href="/">Home</a></nav></header>
<section><h1>Gallery</h1>${copy}
<figure><img src="a.jpg"><figcaption>© Estudio Luz</figcaption></figure></section>
<section class="cta-final"><h2>Book a session</h2>${copy}<a href="/book">Book</a></section>
</body></html>`;
    const shell = buildPageShell(home, "Nueva")!;
    assert.ok(!shell.includes("© Estudio Luz"), "photo credit not promoted");
  });

  it("rejects a whole-body wrapper as the © footer", () => {
    const home = `<html lang="en"><head><title>x</title></head><body>
<div id="app"><header><nav><a href="/">Home</a></nav></header>
<div class="hero"><h2>Big claim</h2><p>MIDDLE-CONTENT-MARKER and lots of copy here to give the page some body length</p></div>
© MegaWrap Inc</div>
</body></html>`;
    const shell = buildPageShell(home, "Nueva")!;
    assert.ok(!shell.includes("MIDDLE-CONTENT-MARKER"), "body not captured as footer");
  });

  it("legacy fallback (unclosed style) does not duplicate footer-nested chrome", () => {
    const home = `<html lang="en"><head><title>x</title></head><body>
<style>.oops{color:red}
<section><h1>Landing</h1></section>
<footer><header>ACME</header><small>©</small></footer>
</body></html>`;
    const shell = buildPageShell(home, "Nueva")!;
    const hits = shell.split("ACME").length - 1;
    assert.equal(hits, 1, "brand appears exactly once");
  });

  it("never emits a malformed fragment from a crossed close (implicitly closed nav)", () => {
    const home = `<html lang="en"><head><title>x</title></head><body>
<div class="wrap"><nav><a href="/">A</a></div>
<section><h1>Landing</h1></section>
<footer><small>© F</small></footer>
</body></html>`;
    const shell = buildPageShell(home, "Nueva")!;
    const opens = shell.split("<div").length - 1;
    const closes = shell.split("</div").length - 1;
    assert.equal(opens, closes, "no stray </div> from a crossed slice");
    assert.ok(shell.includes("© F"), "footer intact");
  });

  it("an unquoted attribute apostrophe does not swallow the navbar", () => {
    const home = `<html lang="en"><head><title>x</title></head><body>
<section><img src="a.jpg" alt=chef's-special><h1>Menu</h1></section>
<header class="site"><nav><a href="/">Home</a></nav></header>
<section><p>that's all folks</p></section>
<footer><small>© Chef</small></footer>
</body></html>`;
    const shell = buildPageShell(home, "Nueva")!;
    assert.ok(shell.includes('class="site"'), "navbar captured despite apostrophe");
  });
});

