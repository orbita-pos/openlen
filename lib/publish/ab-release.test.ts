// A/B TESTING IN THE RELEASE TREE (review items 2, 3, 16, 17; the shared layout ruling of 2026-11-19).
//
// · Without an experiment the release is the one of before A/B testing: no `openlen/ab*`, the old robots.txt, the old
//   analytics snippet — and a project file called `ab.json` or living in `_ab/` publishes like any other.
// · With an experiment, the manifest is `openlen/ab.json` and Variant B's tree `openlen/ab/<id>/b/` (a reserved root, so
//   nothing of the owner's can collide), with `overrides` listing the assets whose bytes differ from control's.
// Run: npx tsx --require ./scripts/test-node-server-only-shim.cjs --test lib/publish/ab-release.test.ts
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.OPENLEN_IMAGE_BAKE = "0";
process.env.OPENLEN_FONT_BAKE = "0";
process.env.OPENLEN_LOCALIZE = "0";

const root = mkdtempSync(path.join(tmpdir(), "olabrelease-"));
process.env.PUBLISH_ROOT = root;

import { publishToDir } from "./filesystem";

const DOC = (label: string) => `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>${label}</title></head>
<body><h1>${label}</h1><form><input name="email"></form></body></html>`;

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
function arbol(sub: string): string[] {
  const base = releaseViva(sub);
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else out.push(path.relative(base, full).split(path.sep).join("/"));
    }
  };
  walk(base);
  return out.sort();
}

const EXP = "ab_1234abcd";
const spec = (over: Record<string, unknown> = {}) => ({
  id: EXP,
  targetPath: "/",
  splitBps: 5000,
  salt: "salt-1",
  includeLocales: false,
  variantB: { html: DOC("Variante B"), files: [] as Array<{ path: string; content: string }> },
  ...over,
});

describe("sin experimento, la release es la de antes de las pruebas A/B", () => {
  after(() => rmSync(root, { recursive: true, force: true }));

  it("🔴 ni `openlen/ab*`, ni el robots de las pruebas, ni el lector A/B en la página", async () => {
    await publishToDir({
      subdomain: "abnone",
      html: DOC("Control"),
      projectId: "proj-ab-1",
      files: [{ path: "/css/site.css", content: "a{}" }],
    });
    const t = arbol("abnone");
    assert.ok(!t.some((p) => p.startsWith("openlen/ab")), `no hay nada del experimento: ${t.join(", ")}`);
    assert.match(actual("abnone", "robots.txt"), /^User-agent: \*\nAllow: \/\n\nSitemap: https:\/\/abnone\.[^/]+\/sitemap\.xml\n$/);
    const home = actual("abnone", "index.html");
    assert.match(home, /var P="proj-ab-1",G=null,E="\/c\/"\+P;/);
    assert.ok(!home.includes("ol_ab"), "la página no lleva el lector de las pruebas A/B");
    assert.ok(!home.includes("_openlen_ab"), "el formulario no lleva el campo de las pruebas A/B");
  });

  it("🔴 un fichero del proyecto llamado `ab.json`, o dentro de `_ab/`, se publica como cualquier otro (ya no están reservados)", async () => {
    await publishToDir({
      subdomain: "abmio",
      html: DOC("Control"),
      files: [
        { path: "/ab.json", content: '{"mio":true}' },
        { path: "/_ab/notas.txt", content: "hola" },
      ],
    });
    assert.equal(actual("abmio", "ab.json"), '{"mio":true}');
    assert.equal(actual("abmio", "_ab/notas.txt"), "hola");
  });
});

describe("con un experimento, vive bajo la raíz reservada `openlen/`", () => {
  it("🔴 el manifiesto en openlen/ab.json y B en openlen/ab/<id>/b/, con `overrides` de los assets que cambian", async () => {
    await publishToDir({
      subdomain: "abvivo",
      html: DOC("Control"),
      projectId: "proj-ab-2",
      files: [
        { path: "/css/site.css", content: "a{}" },
        { path: "/js/igual.js", content: "console.log(1)" },
      ],
      abExperiment: spec({
        variantB: {
          html: DOC("Variante B"),
          files: [
            { path: "/css/site.css", content: "b{}" },
            { path: "/js/igual.js", content: "console.log(1)" },
            { path: "/js/nuevo.js", content: "console.log(2)" },
          ],
        },
      }),
    });
    const t = arbol("abvivo");
    assert.ok(t.includes("openlen/ab.json"));
    assert.ok(!t.includes("ab.json"), "ya no hay ab.json en la raíz");
    assert.ok(!t.some((p) => p.startsWith("_ab/")), "ya no hay _ab/");
    const prefix = `openlen/ab/${EXP}/b`;
    assert.ok(t.includes(`${prefix}/index.html`));
    assert.equal(actual("abvivo", `${prefix}/css/site.css`), "b{}");
    assert.ok(!t.includes(`${prefix}/js/igual.js`), "lo que no cambia no se duplica");
    assert.equal(actual("abvivo", `${prefix}/js/nuevo.js`), "console.log(2)");

    const manifest = JSON.parse(actual("abvivo", "openlen/ab.json"));
    assert.equal(manifest.version, 1);
    assert.equal(manifest.experiments.length, 1);
    const e = manifest.experiments[0];
    assert.equal(e.id, EXP);
    assert.equal(e.prefixB, prefix);
    assert.deepEqual(e.overrides, ["/css/site.css", "/js/nuevo.js"]);

    // Control y B llevan su etiqueta; el robots deja fuera a los buscadores de la copia de B.
    assert.match(actual("abvivo", "index.html"), new RegExp(`var AB="${EXP}:a"`));
    assert.match(actual("abvivo", `${prefix}/index.html`), new RegExp(`var AB="${EXP}:b"`));
    assert.match(actual("abvivo", `${prefix}/index.html`), new RegExp(`name="_openlen_ab" value="${EXP}:b"`));
    assert.match(actual("abvivo", "robots.txt"), /Disallow: \/openlen\/ab\/\n/);
  });

  it("sin assets distintos, `overrides` va vacío (y el manifiesto sigue siendo válido)", async () => {
    await publishToDir({ subdomain: "abvacio", html: DOC("Control"), abExperiment: spec() });
    const e = JSON.parse(actual("abvacio", "openlen/ab.json")).experiments[0];
    assert.deepEqual(e.overrides, []);
    assert.ok(enActual("abvacio", `openlen/ab/${EXP}/b/index.html`));
  });
});
