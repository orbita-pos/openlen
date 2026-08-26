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
<body><h1>${label}</h1><p>contenido ${label}</p>
<footer><a href="mailto:hola@negocio.mx">hola@negocio.mx</a></footer></body></html>`;

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

  // Cloudflare reescribe los correos de lo que proxea y mete un script para
  // descifrarlos; la CSP sellada lo bloquea y el visitante lee
  // "[email protected]". Medido en producción el 2026-08-24. El marcador tiene
  // que llegar al FICHERO, no sólo a la función: es el único sitio donde se
  // comprueba que sobrevive al sellado.
  it("cada documento del release sale con los correos a salvo de Cloudflare", () => {
    for (const rel of [["index.html"], ["menu", "index.html"], ["sobre-mi", "index.html"]]) {
      const doc = readFileSync(path.join(releaseDir(), ...rel), "utf8");
      assert.ok(doc.includes("<!--email_off-->"), `sin marcador en ${rel.join("/")}`);
      assert.ok(doc.includes("<!--/email_off-->"), `sin cierre en ${rel.join("/")}`);
      assert.ok(
        doc.includes('href="mailto:hola@negocio.mx"'),
        `el mailto no sobrevivió en ${rel.join("/")}`,
      );
    }
  });

  it("el html que se devuelve es EL MISMO que se escribió en disco", async () => {
    // `PublishResult.html` alimenta el respaldo en R2. Si el envoltorio se
    // aplicara sólo al fichero, el respaldo guardaría otro documento y una
    // restauración devolvería las páginas con los correos rotos.
    const r = await publishToDir({ subdomain: "espejo", html: DOC("home") });
    const current = path.join(root, "espejo", "current");
    let dir: string;
    try {
      dir = path.join(root, "espejo", "releases", readFileSync(current, "utf8").trim());
    } catch {
      dir = current;
    }
    assert.equal(r.html, readFileSync(path.join(dir, "index.html"), "utf8"));
    assert.ok(r.html.includes("<!--email_off-->"));
  });
});









// «La banda manda» (2026-07-23): un módulo de SECCIÓN que el creador ya colocó
// en algún documento se publica SOLO donde está su banda. Sin banda en ninguna
// parte se conserva el respaldo histórico (encender el módulo publica algo).

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

  it("an account-mode chat sits one slot above the assistant", async () => {
    await publishToDir({
      subdomain: "fabstack",
      html: DOC("home"),
      assistant: { enabled: true, businessName: "Mi Negocio" },
      chat: { enabled: true, mount: "fab", selfServeJoin: true, identityMode: "account" },
    });
    const home = readHome("fabstack");
    assert.ok(home.includes('"bottom":86'), "chat FAB lifted above the assistant");
  });

  it("a mergeable guest chat keeps ONE bubble (handoff)", async () => {
    await publishToDir({
      subdomain: "fabmerged",
      html: DOC("home"),
      assistant: { enabled: true, businessName: "Mi Negocio" },
      chat: { enabled: true, mount: "fab", selfServeJoin: true },
    });
    const home = readHome("fabmerged");
    assert.ok(home.includes('"handoff":true'), "chat baked as the assistant's handoff target");
    assert.ok(!home.includes('"bottom":86'), "no second bubble to lift");
  });
});
