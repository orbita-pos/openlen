// LA CARPETA EN LA PUBLICACIÓN (pieza 9 de Len 2.5): los ficheros web del
// proyecto van al árbol de la release tal cual, lo que no se publica no llega
// al disco, y el service worker no atrapa a ningún visitante.
// Run: npx tsx --require ./scripts/test-node-server-only-shim.cjs --test lib/publish/folder-publish.test.ts
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.OPENLEN_IMAGE_BAKE = "0";
process.env.OPENLEN_FONT_BAKE = "0";
process.env.OPENLEN_LOCALIZE = "0";

const root = mkdtempSync(path.join(tmpdir(), "olcarpeta-"));
process.env.PUBLISH_ROOT = root;

import { publishToDir, rollbackToSha } from "./filesystem";
import { SELF_UNREGISTERING_SW } from "./service-worker";

const DOC = (label: string, extra = "") => `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>${label}</title></head>
<body><h1>${label}</h1><script type="module" src="/js/app.js"></script>${extra}</body></html>`;

/** La release viva. En Windows la prueba escribe un fichero con el sha en vez
 *  del enlace `current` (multi-page-publish.test.ts hace lo mismo). */
function releaseViva(sub: string): string {
  const current = path.join(root, sub, "current");
  try {
    return path.join(root, sub, "releases", readFileSync(current, "utf8").trim());
  } catch {
    return current;
  }
}
const actual = (sub: string, rel: string) => readFileSync(path.join(releaseViva(sub), rel), "utf8");
const enActual = (sub: string, rel: string) => existsSync(path.join(releaseViva(sub), rel));

describe("publicar la carpeta (pieza 9)", () => {
  after(() => rmSync(root, { recursive: true, force: true }));

  it("🔴 escribe los ficheros web tal cual, junto a las páginas", async () => {
    await publishToDir({
      subdomain: "carpeta",
      html: DOC("home"),
      files: [
        { path: "/js/app.js", content: "console.log(1)" },
        { path: "/data/menu.json", content: "[]" },
        { path: "/manifest.json", content: "{}" },
      ],
    });
    assert.equal(actual("carpeta", "js/app.js"), "console.log(1)");
    assert.equal(actual("carpeta", "data/menu.json"), "[]");
    assert.equal(actual("carpeta", "manifest.json"), "{}");
    assert.match(actual("carpeta", "index.html"), /<h1>home<\/h1>/);
  });

  it("🔴 lo que no se publica (pruebas, migraciones, reservadas, rutas raras) no llega al disco", async () => {
    await publishToDir({
      subdomain: "privado",
      html: DOC("home"),
      files: [
        { path: "/tests/a.spec.ts", content: "t" },
        { path: "/supabase/migrations/1_a.sql", content: "s" },
        { path: "/assets/x.js", content: "x" },
        { path: "/../../fuera.js", content: "x" },
        { path: "/menu/index.html", content: "<h1>no</h1>" },
      ],
    });
    for (const rel of ["tests/a.spec.ts", "supabase/migrations/1_a.sql", "assets/x.js", "menu/index.html"]) {
      assert.equal(enActual("privado", rel), false, rel);
    }
    assert.equal(existsSync(path.join(root, "fuera.js")), false);
  });

  it("el robots.txt del dueño gana al generado", async () => {
    await publishToDir({ subdomain: "robots", html: DOC("home"), files: [{ path: "/robots.txt", content: "User-agent: *\nDisallow: /" }] });
    assert.equal(actual("robots", "robots.txt"), "User-agent: *\nDisallow: /");
  });

  it("🔴 sin sw.js propio se publica el que se da de baja; con el suyo, el suyo", async () => {
    await publishToDir({ subdomain: "sinsw", html: DOC("home") });
    assert.equal(actual("sinsw", "sw.js"), SELF_UNREGISTERING_SW);
    await publishToDir({ subdomain: "consw", html: DOC("home"), files: [{ path: "/sw.js", content: "// mío" }] });
    assert.equal(actual("consw", "sw.js"), "// mío");
  });

  it("🔴 el que registró un service worker en otra ruta y lo quita recibe ahí el que se da de baja", async () => {
    const reg = `<script>navigator.serviceWorker.register('/js/worker.js')</script>`;
    await publishToDir({ subdomain: "otraruta", html: DOC("home", reg), files: [{ path: "/js/worker.js", content: "// worker" }] });
    assert.equal(actual("otraruta", "js/worker.js"), "// worker");
    await publishToDir({ subdomain: "otraruta", html: DOC("home") });
    assert.equal(actual("otraruta", "js/worker.js"), SELF_UNREGISTERING_SW);
  });

  it("🔴 volver atrás a una release sin sw.js deja ahí el que se da de baja", async () => {
    const vieja = await publishToDir({ subdomain: "atras", html: DOC("v1") });
    // Una release de ANTES de la pieza 9 no traía sw.js.
    rmSync(path.join(root, "atras", "releases", vieja.sha, "sw.js"));
    await publishToDir({ subdomain: "atras", html: DOC("v2"), files: [{ path: "/sw.js", content: "// real" }] });
    assert.equal(actual("atras", "sw.js"), "// real");
    await rollbackToSha("atras", vieja.sha);
    assert.match(actual("atras", "index.html"), /<h1>v1<\/h1>/);
    assert.equal(actual("atras", "sw.js"), SELF_UNREGISTERING_SW);
  });

  it("BRAZO DE CONTROL: el mismo contenido da la misma release (la carpeta entra en la huella)", async () => {
    const a = await publishToDir({ subdomain: "huella", html: DOC("h"), files: [{ path: "/js/app.js", content: "1" }] });
    const b = await publishToDir({ subdomain: "huella", html: DOC("h"), files: [{ path: "/js/app.js", content: "1" }] });
    const c = await publishToDir({ subdomain: "huella", html: DOC("h"), files: [{ path: "/js/app.js", content: "2" }] });
    assert.equal(a.sha, b.sha);
    assert.notEqual(a.sha, c.sha);
  });
});
