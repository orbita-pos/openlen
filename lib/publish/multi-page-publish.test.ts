// Multi-page publish — the release must carry every site page through the
// same bake as home, atomically, with sane SEO (own canonical, sitemap
// entries outside the hreflang cluster).
// Run: npx tsx --test lib/publish/multi-page-publish.test.ts
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ItemRow } from "@/lib/collections/store";

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

describe("publishToDir with gated pages (members module)", () => {
  let result: Awaited<ReturnType<typeof publishToDir>>;
  before(async () => {
    result = await publishToDir({
      subdomain: "gatedtest",
      html: DOC("home"),
      pages: [{ slug: "menu", html: DOC("menu") }],
      gatedPages: [{ slug: "privada", html: DOC("secreto") }],
      memberGate: { projectTitle: "Mi Negocio" },
    });
  });

  const releaseDir = () => {
    const current = path.join(root, "gatedtest", "current");
    try {
      const sha = readFileSync(current, "utf8").trim();
      return path.join(root, "gatedtest", "releases", sha);
    } catch {
      return current;
    }
  };

  it("the public path carries a stub with ZERO protected bytes, no CSP, noindex", () => {
    const stub = readFileSync(
      path.join(releaseDir(), "privada", "index.html"),
      "utf8",
    );
    assert.ok(!stub.includes("contenido secreto"));
    assert.ok(!stub.includes("Content-Security-Policy"));
    assert.ok(stub.includes('name="robots" content="noindex"'));
    assert.ok(stub.includes('name="ol-member-gate"'));
    assert.ok(stub.includes("/api/m/"));
    assert.ok(stub.includes("Mi Negocio"));
    // Home is Spanish → the stub speaks Spanish.
    assert.ok(stub.includes("Solo miembros"));
  });

  it("the real document lands OUTSIDE the release, fully baked + sealed", () => {
    const protectedFile = path.join(
      root,
      "gatedtest",
      "protected",
      result.sha,
      "privada",
      "index.html",
    );
    assert.ok(existsSync(protectedFile));
    const doc = readFileSync(protectedFile, "utf8");
    assert.ok(doc.includes("contenido secreto"));
    const home = readFileSync(path.join(releaseDir(), "index.html"), "utf8");
    assert.equal(
      doc.includes("Content-Security-Policy"),
      home.includes("Content-Security-Policy"),
    );
    // And never inside the release dir.
    assert.ok(!existsSync(path.join(releaseDir(), "protected")));
  });

  it("gated slugs stay out of the sitemap; public ones stay in", () => {
    const sitemap = readFileSync(path.join(releaseDir(), "sitemap.xml"), "utf8");
    assert.ok(sitemap.includes("https://gatedtest.openlen.com/menu/"));
    assert.ok(!sitemap.includes("privada"));
  });

  it("reports gated slugs separately", () => {
    assert.deepEqual(result.pages, ["menu"]);
    assert.deepEqual(result.gatedPages, ["privada"]);
  });

  it("editing only the GATED page mints a new sha (drift-consistent releases)", async () => {
    const b = await publishToDir({
      subdomain: "gatedtest",
      html: DOC("home"),
      pages: [{ slug: "menu", html: DOC("menu") }],
      gatedPages: [{ slug: "privada", html: DOC("secreto-v2") }],
      memberGate: { projectTitle: "Mi Negocio" },
    });
    assert.notEqual(b.sha, result.sha);
    const v2 = readFileSync(
      path.join(root, "gatedtest", "protected", b.sha, "privada", "index.html"),
      "utf8",
    );
    assert.ok(v2.includes("contenido secreto-v2"));
    // The prior sha's protected dir survives while its release survives
    // (rollback keeps working).
    assert.ok(
      existsSync(
        path.join(root, "gatedtest", "protected", result.sha, "privada", "index.html"),
      ),
    );
  });

  it("a gated page with editor markers fails the WHOLE publish", async () => {
    await assert.rejects(
      publishToDir({
        subdomain: "gatedtest",
        html: DOC("home"),
        gatedPages: [
          { slug: "mala", html: '<html><body data-slot-path="x">x</body></html>' },
        ],
      }),
      /data-slot-path/,
    );
  });
});

describe("gated publish wears the site look", () => {
  const BRANDED_HOME = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>marca</title>
<style>.btn{background:#e11d48}.link{color:#e11d48}.ring{border-color:#e11d48}</style>
</head><body><h1>marca</h1></body></html>`;
  const GATED_WITH_LOGOUT = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>zona</title></head>
<body><h1>zona</h1><p><a href="#" data-ol-logout>Cerrar sesión</a></p></body></html>`;

  let result: Awaited<ReturnType<typeof publishToDir>>;
  before(async () => {
    result = await publishToDir({
      subdomain: "brandtest",
      html: BRANDED_HOME,
      gatedPages: [{ slug: "zona", html: GATED_WITH_LOGOUT }],
      memberGate: { projectTitle: "Marca" },
    });
  });

  const releaseDir = () => {
    const current = path.join(root, "brandtest", "current");
    try {
      const sha = readFileSync(current, "utf8").trim();
      return path.join(root, "brandtest", "releases", sha);
    } catch {
      return current;
    }
  };

  it("the stub picks up the site accent deterministically", () => {
    const stub = readFileSync(path.join(releaseDir(), "zona", "index.html"), "utf8");
    assert.ok(stub.includes("--btn-bg:#e11d48"), "accent in stub");
    assert.match(stub, /--btn-fg:#[0-9a-fA-F]{6}/);
  });

  it("the protected doc gets working, SEALED logout wiring", () => {
    const doc = readFileSync(
      path.join(root, "brandtest", "protected", result.sha, "zona", "index.html"),
      "utf8",
    );
    assert.ok(doc.includes("/api/m/brandtest/auth/logout"), "logout endpoint wired");
    assert.ok(doc.includes("data-ol-logout"), "logout link kept");
    assert.ok(doc.includes("Content-Security-Policy"), "doc still sealed");
  });
});

describe("members sign-in link on public docs (Part D)", () => {
  // Template-style home: its own "Iniciar sesión" link next to the CTA.
  const HOME_WITH_SIGNIN = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>tienda</title>
<style>:root{--ol-bg:#fff}</style></head>
<body>
  <header><nav><a href="#productos">Productos</a></nav>
    <div><a href="#cta" class="text-sm">Iniciar sesión</a><a href="#cta" class="btn">Empezar</a></div>
  </header>
  <h1>tienda</h1>
</body></html>`;
  // AI-style public subpage: nav + heading, NO sign-in link.
  const SUBPAGE_NO_SIGNIN = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>precios</title>
<style>:root{--ol-bg:#fff}</style></head>
<body><header><nav><a href="#a">Planes</a></nav></header><h1>precios</h1></body></html>`;
  // The gated portal (auto members page), members-only.
  const PORTAL = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>miembros</title></head>
<body><h1>Zona de miembros</h1></body></html>`;

  before(async () => {
    await publishToDir({
      subdomain: "signintest",
      html: HOME_WITH_SIGNIN,
      pages: [{ slug: "precios", html: SUBPAGE_NO_SIGNIN }],
      gatedPages: [{ slug: "miembros", html: PORTAL }],
      memberGate: { projectTitle: "Mi Tienda" },
      memberSigninPath: "miembros",
    });
  });

  const releaseDir = () => {
    const current = path.join(root, "signintest", "current");
    try {
      return path.join(root, "signintest", "releases", readFileSync(current, "utf8").trim());
    } catch {
      return current;
    }
  };

  it("rewires the home's own sign-in link to the portal (no duplicate)", () => {
    const home = readFileSync(path.join(releaseDir(), "index.html"), "utf8");
    assert.ok(home.includes("/miembros"), "sign-in points at the portal");
    // Rewired, not injected: still exactly one sign-in, and the CTA is intact.
    assert.equal((home.match(/Iniciar sesión/g) || []).length, 1, "exactly one sign-in");
    assert.ok(home.includes("Empezar"), "the CTA button is untouched");
  });

  it("injects a sign-in link on a page that lacks one", () => {
    const sub = readFileSync(path.join(releaseDir(), "precios", "index.html"), "utf8");
    assert.ok(sub.includes("/miembros"), "points at the portal");
    assert.ok(sub.includes("Iniciar sesión"), "injected sign-in present");
  });

  it("the portal path serves the login gate stub (the sign-in destination works)", () => {
    const stub = readFileSync(path.join(releaseDir(), "miembros", "index.html"), "utf8");
    assert.ok(stub.includes('name="ol-member-gate"'), "it is the gate stub");
    // The stub builds the endpoint at runtime: var SUB="signintest"; "/api/m/"+SUB.
    assert.ok(stub.includes("/api/m/"), "wired to the member API");
    assert.ok(stub.includes("signintest"), "scoped to this site");
  });

  it("the sign-in link survives inside the CSP-sealed home", () => {
    const home = readFileSync(path.join(releaseDir(), "index.html"), "utf8");
    assert.ok(home.includes("Content-Security-Policy"), "home is sealed");
    assert.ok(home.includes("/miembros"), "link still present after the seal");
  });
});

describe("no sign-in when the members module is off", () => {
  const HOME_WITH_SIGNIN = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>off</title><style>:root{--ol-bg:#fff}</style></head>
<body><header><div><a href="#cta">Iniciar sesión</a></div></header><h1>off</h1></body></html>`;

  before(async () => {
    // No gatedPages, no memberSigninPath → module off.
    await publishToDir({ subdomain: "nosignin", html: HOME_WITH_SIGNIN });
  });

  const releaseDir = () => {
    const current = path.join(root, "nosignin", "current");
    try {
      return path.join(root, "nosignin", "releases", readFileSync(current, "utf8").trim());
    } catch {
      return current;
    }
  };

  it("leaves the page's authored sign-in untouched and injects nothing", () => {
    const home = readFileSync(path.join(releaseDir(), "index.html"), "utf8");
    assert.ok(!home.includes("data-ol-signin"), "nothing injected");
    assert.ok(!home.includes("/miembros"), "no portal rewire");
    assert.ok(home.includes("Iniciar sesión"), "authored link left as-is");
  });
});

describe("publishToDir with the account page", () => {
  before(async () => {
    await publishToDir({
      subdomain: "accttest",
      html: DOC("home"),
      accountArea: true,
      memberGate: { projectTitle: "Estudio", passwordLogin: true },
    });
  });

  const releaseDir = () => {
    const current = path.join(root, "accttest", "current");
    try {
      const sha = readFileSync(current, "utf8").trim();
      return path.join(root, "accttest", "releases", sha);
    } catch {
      return current;
    }
  };

  it("publishes /cuenta as the account dashboard stub", () => {
    const file = path.join(releaseDir(), "cuenta", "index.html");
    assert.ok(existsSync(file), "cuenta/index.html exists in the release");
    const stub = readFileSync(file, "utf8");
    assert.ok(stub.includes('MODE="account"'), "baked in account mode");
    assert.ok(stub.includes('id="m-acct"'), "carries the dashboard shell");
    assert.ok(stub.includes('content="noindex"'), "stays noindex");
  });

  it("does not publish /cuenta when the account area is off", async () => {
    await publishToDir({ subdomain: "noacct", html: DOC("home") });
    const current = path.join(root, "noacct", "current");
    let dir: string;
    try {
      const sha = readFileSync(current, "utf8").trim();
      dir = path.join(root, "noacct", "releases", sha);
    } catch {
      dir = current;
    }
    assert.ok(!existsSync(path.join(dir, "cuenta", "index.html")));
  });
});

describe("members sign-in link surfaces the account area (Part E)", () => {
  before(async () => {
    await publishToDir({
      subdomain: "accttest2",
      html: DOC("home"),
      memberSigninPath: "cuenta",
      memberSigninIsAccount: true,
    });
  });

  const releaseDir = () => {
    const current = path.join(root, "accttest2", "current");
    try {
      const sha = readFileSync(current, "utf8").trim();
      return path.join(root, "accttest2", "releases", sha);
    } catch {
      return current;
    }
  };

  it("injects a link to /cuenta with the account label", () => {
    const home = readFileSync(path.join(releaseDir(), "index.html"), "utf8");
    assert.ok(home.includes('href="/cuenta"'), "points at the account home");
    assert.ok(home.includes("Mi cuenta"), "account label, not the generic sign-in label");
    assert.ok(!home.includes("Iniciar sesión"), "does not carry the generic sign-in label");
  });

  it("without memberSigninIsAccount, the same /cuenta path gets the generic sign-in label", async () => {
    await publishToDir({
      subdomain: "accttest2b",
      html: DOC("home"),
      memberSigninPath: "cuenta",
    });
    const current = path.join(root, "accttest2b", "current");
    let dir: string;
    try {
      dir = path.join(root, "accttest2b", "releases", readFileSync(current, "utf8").trim());
    } catch {
      dir = current;
    }
    const home = readFileSync(path.join(dir, "index.html"), "utf8");
    assert.ok(home.includes('href="/cuenta"'), "still points at /cuenta");
    assert.ok(home.includes("Iniciar sesión"), "falls back to the generic sign-in label");
    assert.ok(!home.includes("Mi cuenta"), "not the account label without the flag");
  });
});

describe("account label rewires the page's own sign-in link (Part E rewire)", () => {
  // Reuse the template-style home from Part D that has its own "Iniciar sesión" link.
  const HOME_WITH_SIGNIN = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>tienda</title>
<style>:root{--ol-bg:#fff}</style></head>
<body>
  <header><nav><a href="#productos">Productos</a></nav>
    <div><a href="#cta" class="text-sm">Iniciar sesión</a><a href="#cta" class="btn">Empezar</a></div>
  </header>
  <h1>tienda</h1>
</body></html>`;

  before(async () => {
    await publishToDir({
      subdomain: "accttest3",
      html: HOME_WITH_SIGNIN,
      memberSigninPath: "cuenta",
      memberSigninIsAccount: true,
    });
  });

  const releaseDir = () => {
    const current = path.join(root, "accttest3", "current");
    try {
      const sha = readFileSync(current, "utf8").trim();
      return path.join(root, "accttest3", "releases", sha);
    } catch {
      return current;
    }
  };

  it("rewires an existing sign-in link to the account path with account label", () => {
    const home = readFileSync(path.join(releaseDir(), "index.html"), "utf8");
    assert.ok(home.includes('href="/cuenta"'), "rewired to account path");
    assert.ok(home.includes("Mi cuenta"), "text rewired to account label");
    assert.ok(!home.includes("Iniciar sesión"), "original text replaced");
  });
});

describe("publishToDir wires Pedidos por WhatsApp (orders) over Collections", () => {
  const orderItem: ItemRow = {
    id: "it-1",
    projectId: "p1",
    collectionId: "c1",
    title: "Tacos al pastor",
    subtitle: null,
    description: null,
    imageUrl: null,
    priceDisplay: "$90",
    badge: null,
    ctaLabel: null,
    ctaUrl: null,
    tags: [],
    attrs: {},
    status: "published",
    sortOrder: 0,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };

  const MENU_DOC = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>menu</title></head>
<body><h1>menu</h1><section data-ol-collection-section></section></body></html>`;

  async function publishBoth(opts: { ordersOff?: boolean; sub: string; number?: string }) {
    await publishToDir({
      subdomain: opts.sub,
      html: DOC("home"),
      pages: [{ slug: "menu", html: MENU_DOC }],
      projectId: "p1",
      collections: { enabled: true, items: [orderItem], layout: "grid" },
      orders: opts.ordersOff ? undefined : { enabled: true, number: opts.number ?? "5512345678" },
    });
    const current = path.join(root, opts.sub, "current");
    let dir: string;
    try {
      dir = path.join(root, opts.sub, "releases", readFileSync(current, "utf8").trim());
    } catch {
      dir = current;
    }
    const home = readFileSync(path.join(dir, "index.html"), "utf8");
    const menuDoc = readFileSync(path.join(dir, "menu", "index.html"), "utf8");
    return { home, menuDoc };
  }

  it("cart runtime + buttons ride the collections grid, sealed", async () => {
    const { home, menuDoc } = await publishBoth({ sub: "orderstest" });

    for (const doc of [home, menuDoc]) {
      assert.ok(doc.includes("data-ol-order-add"), "add buttons baked");
      assert.ok(doc.includes('data-ol-order-cents="9000"'), "server-parsed cents");
      assert.ok(doc.includes("data-ol-orders-widget"), "cart runtime injected");
      assert.ok(doc.includes("https://wa.me/525512345678"), "+52 normalized target");
      assert.ok(doc.includes("Content-Security-Policy"), "seal survived the new inline script");
    }
  });

  it("orders OFF keeps the published collections doc byte-free of order markup", async () => {
    const { home } = await publishBoth({ sub: "orderstestoff", ordersOff: true });
    assert.ok(!home.includes("data-ol-order"), "no order markup when module off");
  });

  it("orders ON with an unusable number (waHref -> null) stays byte-free — bake gate must agree with the runtime, no dead buttons", async () => {
    const { home, menuDoc } = await publishBoth({ sub: "orderstestbadnum", number: "1234567" });
    for (const doc of [home, menuDoc]) {
      assert.ok(
        !doc.includes("data-ol-order"),
        "no order markup (buttons or runtime) when the number has < 8 digits, same threshold as the runtime's waHref",
      );
    }
  });
});

// «La banda manda» (2026-07-23): un módulo de SECCIÓN que el creador ya colocó
// en algún documento se publica SOLO donde está su banda. Sin banda en ninguna
// parte se conserva el respaldo histórico (encender el módulo publica algo).
describe("section modules ship where their band is", () => {
  const BAND_DOC = (label: string, marker: string) => `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>${label}</title></head>
<body><h1>${label}</h1><section ${marker}></section></body></html>`;

  const readDocs = (sub: string, slugs: string[]) => {
    const current = path.join(root, sub, "current");
    let dir: string;
    try {
      dir = path.join(root, sub, "releases", readFileSync(current, "utf8").trim());
    } catch {
      dir = current;
    }
    const out: Record<string, string> = {
      home: readFileSync(path.join(dir, "index.html"), "utf8"),
    };
    for (const slug of slugs) {
      out[slug] = readFileSync(path.join(dir, slug, "index.html"), "utf8");
    }
    return out;
  };

  it("bookings ship ONLY on the page carrying the band", async () => {
    await publishToDir({
      subdomain: "bandbookings",
      html: DOC("home"),
      pages: [
        { slug: "menu", html: DOC("menu") },
        { slug: "citas", html: BAND_DOC("citas", "data-ol-bookings-section") },
      ],
      bookings: { enabled: true },
    });
    const docs = readDocs("bandbookings", ["menu", "citas"]);
    assert.ok(docs.citas.includes("data-ol-bookings-widget"), "widget on the page with the band");
    assert.ok(!docs.home.includes("data-ol-bookings-widget"), "home stays clean");
    assert.ok(!docs.menu.includes("data-ol-bookings-widget"), "/menu stays clean");
  });

  it("comments band on home only → the subpages stay clean", async () => {
    await publishToDir({
      subdomain: "bandcomments",
      html: BAND_DOC("home", "data-ol-comments-section"),
      pages: [{ slug: "menu", html: DOC("menu") }],
      comments: { enabled: true },
    });
    const docs = readDocs("bandcomments", ["menu"]);
    assert.ok(docs.home.includes("data-ol-comments-widget"));
    assert.ok(!docs.menu.includes("data-ol-comments-widget"));
  });

  it("no band anywhere → the fallback still publishes the widget on every doc", async () => {
    await publishToDir({
      subdomain: "bandnone",
      html: DOC("home"),
      pages: [{ slug: "menu", html: DOC("menu") }],
      bookings: { enabled: true },
      comments: { enabled: true },
    });
    const docs = readDocs("bandnone", ["menu"]);
    for (const doc of [docs.home, docs.menu]) {
      assert.ok(doc.includes("data-ol-bookings-widget"), "bookings fallback intact");
      assert.ok(doc.includes("data-ol-comments-widget"), "comments fallback intact");
    }
  });
});

// Apilamiento de burbujas: el asistente vive en los 18 px de la esquina. Un
// chat que NO se fusiona con él (cuenta / solo por invitación) tenía el mismo
// bottom + el mismo z-index y lo tapaba entero (QA 2026-07-23).
describe("visitor FABs never land on the same pixel", () => {
  const readHome = (sub: string) => {
    const current = path.join(root, sub, "current");
    try {
      return readFileSync(
        path.join(root, sub, "releases", readFileSync(current, "utf8").trim(), "index.html"),
        "utf8",
      );
    } catch {
      return readFileSync(path.join(current, "index.html"), "utf8");
    }
  };

  it("an account-mode chat sits one slot above the assistant, WhatsApp above both", async () => {
    await publishToDir({
      subdomain: "fabstack",
      html: DOC("home"),
      assistant: { enabled: true, businessName: "Mi Negocio" },
      chat: { enabled: true, mount: "fab", selfServeJoin: true, identityMode: "account" },
      whatsapp: { enabled: true, number: "5512345678" },
    });
    const home = readHome("fabstack");
    assert.ok(home.includes('"bottom":86'), "chat FAB lifted above the assistant");
    assert.ok(home.includes("bottom:154px"), "WhatsApp above both — no empty slot");
  });

  it("a mergeable guest chat keeps ONE bubble (handoff), so WhatsApp only skips one slot", async () => {
    await publishToDir({
      subdomain: "fabmerged",
      html: DOC("home"),
      assistant: { enabled: true, businessName: "Mi Negocio" },
      chat: { enabled: true, mount: "fab", selfServeJoin: true },
      whatsapp: { enabled: true, number: "5512345678" },
    });
    const home = readHome("fabmerged");
    assert.ok(home.includes('"handoff":true'), "chat baked as the assistant's handoff target");
    assert.ok(!home.includes('"bottom":86'), "no second bubble to lift");
    assert.ok(home.includes("bottom:86px"), "WhatsApp sits above the single bubble");
  });
});
