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

  // THE SEAM WITH THE EDGE: the manifest the publisher writes is read by the edge's own parser (the TS mirror of
  // crates/edge, which runs the same shared fixtures). The two halves were built in separate branches and once
  // disagreed on where `overrides` lives — this reads a REAL release, so they can't drift apart again.
  it("🔴 the edge reads the published manifest: B's page and B's changed asset are decided, an unchanged asset is not", async () => {
    const { readReleaseAbManifest, evaluateAbManifest, resolveVariantBFile } = await import("@/lib/ab/serve");
    const release = releaseViva("abvivo");
    const manifest = await readReleaseAbManifest(release);
    assert.ok(manifest, "the edge accepts the manifest the publisher wrote");
    assert.deepEqual(manifest.experiments[0].overrides, ["/css/site.css", "/js/nuevo.js"]);

    const asB = { cookieHeader: `ol_ab_${EXP}=b`, userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/120" };
    const page = evaluateAbManifest(manifest, { urlPath: "/", ...asB });
    assert.equal(page?.variant, "b");
    const pageFile = await resolveVariantBFile(release, page!.variantBPath!, true);
    assert.ok(pageFile && readFileSync(pageFile, "utf8").includes("Variante B"));

    const css = evaluateAbManifest(manifest, { urlPath: "/css/site.css", ...asB });
    assert.equal(css?.variant, "b");
    const cssFile = await resolveVariantBFile(release, css!.variantBPath!, false);
    assert.ok(cssFile);
    assert.equal(readFileSync(cssFile, "utf8"), "b{}");

    // Control's visitor of a changed asset is decided too (served control, never stored by a CDN)…
    assert.equal(evaluateAbManifest(manifest, { urlPath: "/css/site.css", cookieHeader: `ol_ab_${EXP}=a` })?.variant, "a");
    // …and an asset B doesn't change is not the experiment's business.
    assert.equal(evaluateAbManifest(manifest, { urlPath: "/js/igual.js", ...asB }), null);
  });

  it("sin assets distintos, `overrides` va vacío (y el manifiesto sigue siendo válido)", async () => {
    await publishToDir({ subdomain: "abvacio", html: DOC("Control"), abExperiment: spec() });
    const e = JSON.parse(actual("abvacio", "openlen/ab.json")).experiments[0];
    assert.deepEqual(e.overrides, []);
    assert.ok(enActual("abvacio", `openlen/ab/${EXP}/b/index.html`));
  });
});

// The language variants (review item 17). A document carries an experiment tag only if the edge BUCKETS it. Control's
// language pages used to inherit `exp:a` from the home they are translated from even when they are not in the
// experiment — inflating A's views — and a B visitor who switched language was re-tagged as A.
describe("los idiomas y la etiqueta del experimento", () => {
  const TAGGED = new RegExp(`var AB="${EXP}:(a|b)"`);
  /** A stand-in for the translation: the same document, its heading changed — scripts and forms ride along as in the real one. */
  const traducir = (rompeB = false) => async (html: string) => {
    if (rompeB && html.includes("Variante B")) throw new Error("la traducción de B falló");
    return [{ locale: "en", html: html.replace(/<h1>(.*?)<\/h1>/, "<h1>$1 EN</h1>") }];
  };
  const conLocalizacion = async (run: () => Promise<void>) => {
    process.env.OPENLEN_LOCALIZE = "1";
    try {
      await run();
    } finally {
      process.env.OPENLEN_LOCALIZE = "0";
    }
  };

  it("🔴 un idioma que NO está en el experimento no lleva la etiqueta de A (ni el campo de formulario), y B no trae idiomas", async () => {
    await conLocalizacion(async () => {
      await publishToDir({
        subdomain: "abidiomas1",
        html: DOC("Control"),
        projectId: "proj-ab-3",
        sourceLang: "es",
        buildLocaleDocs: traducir(),
        abExperiment: spec({ includeLocales: false }),
      });
    });
    assert.match(actual("abidiomas1", "index.html"), new RegExp(`var AB="${EXP}:a"`), "la raíz sí está en el experimento");
    const en = actual("abidiomas1", "en/index.html");
    assert.match(en, /<h1>Control EN<\/h1>/);
    assert.match(en, /var P="proj-ab-3"/, "sigue llevando su analítica de siempre");
    assert.ok(!TAGGED.test(en), "el idioma no se etiqueta como A");
    assert.ok(!en.includes("_openlen_ab"), "ni el formulario");
    assert.ok(!enActual("abidiomas1", `openlen/ab/${EXP}/b/en/index.html`));
    const e = JSON.parse(actual("abidiomas1", "openlen/ab.json")).experiments[0];
    assert.equal(e.includeLocales, false);
    assert.deepEqual(e.locales, []);
  });

  it("🔴 con idiomas en el experimento, el de control lleva A y el de B lleva B (los dos están sembrados por el borde)", async () => {
    await conLocalizacion(async () => {
      await publishToDir({
        subdomain: "abidiomas2",
        html: DOC("Control"),
        projectId: "proj-ab-3",
        sourceLang: "es",
        buildLocaleDocs: traducir(),
        abExperiment: spec({ includeLocales: true }),
      });
    });
    assert.match(actual("abidiomas2", "en/index.html"), new RegExp(`var AB="${EXP}:a"`));
    assert.match(actual("abidiomas2", `openlen/ab/${EXP}/b/en/index.html`), new RegExp(`var AB="${EXP}:b"`));
    const e = JSON.parse(actual("abidiomas2", "openlen/ab.json")).experiments[0];
    assert.equal(e.includeLocales, true);
    assert.deepEqual(e.locales, ["en"]);
  });

  it("🔴 se pidieron idiomas en el experimento pero B no pudo traducirse: el manifiesto no los incluye, y el de control tampoco lleva etiqueta", async () => {
    await conLocalizacion(async () => {
      await publishToDir({
        subdomain: "abidiomas3",
        html: DOC("Control"),
        projectId: "proj-ab-3",
        sourceLang: "es",
        buildLocaleDocs: traducir(true),
        abExperiment: spec({ includeLocales: true }),
      });
    });
    const e = JSON.parse(actual("abidiomas3", "openlen/ab.json")).experiments[0];
    assert.equal(e.includeLocales, false);
    assert.ok(!TAGGED.test(actual("abidiomas3", "en/index.html")), "el borde no reparte ese idioma: no se etiqueta");
    assert.match(actual("abidiomas3", "en/index.html"), /<h1>Control EN<\/h1>/);
  });

  it("un experimento sobre una subpágina no toca los idiomas de la home", async () => {
    await conLocalizacion(async () => {
      await publishToDir({
        subdomain: "abidiomas4",
        html: DOC("Control"),
        projectId: "proj-ab-3",
        sourceLang: "es",
        pages: [{ slug: "menu", html: DOC("Menú") }],
        buildLocaleDocs: traducir(),
        abExperiment: spec({
          targetPath: "/menu",
          variantB: { html: DOC("Home B"), pages: [{ slug: "menu", html: DOC("Menú B") }], files: [] },
        }),
      });
    });
    assert.ok(!TAGGED.test(actual("abidiomas4", "index.html")));
    assert.ok(!TAGGED.test(actual("abidiomas4", "en/index.html")));
    assert.match(actual("abidiomas4", "menu/index.html"), new RegExp(`var AB="${EXP}:a"`));
  });
});
