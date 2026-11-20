// THE FLAG-OFF RELEASE, BYTE FOR BYTE (G1+G3 review, item 23).
//
// Publishing with OPENLEN_AB_TESTING off and no experiment must produce the release master produced BEFORE the A/B work
// (04b218999): not a similar one — the same one, every file. This publishes a fixture that touches everything A/B touched in
// the document bake — a home and two pages, forms (wired to the project's config and with no config), the analytics
// snippet, a stylesheet and a script, a locale, the robots and the sitemap — and compares the tree with the one that commit
// writes.
//
// HOW THE PINNED VALUES WERE COMPUTED (do it again if the fixture changes on purpose; never to make a failure go away):
//   git worktree add .claude/worktrees/_pin 04b218999            # the commit before the A/B work, a scratch worktree
//   cp lib/publish/flag-off-release.test.ts .claude/worktrees/_pin/lib/publish/
//   cd .claude/worktrees/_pin
//   FLAG_OFF_PIN_PRINT=1 npx tsx --require ./scripts/test-node-server-only-shim.cjs --test lib/publish/flag-off-release.test.ts
//   → copy the printed `PINNED_FILES` and `PINNED_TREE_SHA` below;   git worktree remove .claude/worktrees/_pin
// The tree is every file's sha256 by path; `sitemap.xml` carries the day's date, so its PATH counts and its content doesn't
// (as in no-regresion.test.ts). The tree sha is the sha256 of the sorted `path<TAB>sha256` lines.
// Run: npx tsx --require ./scripts/test-node-server-only-shim.cjs --test lib/publish/flag-off-release.test.ts
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.OPENLEN_IMAGE_BAKE = "0";
process.env.OPENLEN_FONT_BAKE = "0";
delete process.env.OPENLEN_AB_TESTING; // the flag is OFF

const root = mkdtempSync(path.join(tmpdir(), "olflagoff-"));
process.env.PUBLISH_ROOT = root;

import { publishToDir } from "./filesystem";

after(() => rmSync(root, { recursive: true, force: true }));

const DOC = (title: string, body: string) => `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>${title}</title><meta name="description" content="${title} — pan de masa madre"><link rel="stylesheet" href="/css/site.css"></head>
<body><header><a href="/">Inicio</a> <a href="/menu/">Carta</a> <a href="/contacto/">Contacto</a></header><h1>${title}</h1>${body}<script src="/js/app.js" defer></script></body></html>`;

const HOME = DOC("Panadería Luna", `<p>Pan de masa madre cada mañana.</p><a class="cta" href="/contacto/">Pide el tuyo</a><form id="suscribir"><input name="email" type="email" required><button>Suscribirme</button></form>`);
const MENU = DOC("Carta", `<ul><li>Hogaza</li><li>Baguette</li></ul><a class="cta" href="https://wa.me/34600000000">Pedir por WhatsApp</a>`);
const CONTACTO = DOC("Contacto", `<form id="contacto"><input name="nombre"><input name="email" type="email"><textarea name="mensaje"></textarea><button>Enviar</button></form>`);

async function publish() {
  return publishToDir({
    subdomain: "luna",
    html: HOME,
    projectId: "proj-flag-off",
    analyticsEnabled: true,
    formConfigs: { contacto: { notifyEmail: "hola@luna.test", successMessage: "¡Gracias!" } } as never,
    pages: [
      { slug: "menu", html: MENU },
      { slug: "contacto", html: CONTACTO },
    ],
    files: [
      { path: "/css/site.css", content: "body{font-family:serif;margin:0}.cta{background:#c60}" },
      { path: "/js/app.js", content: "console.log('luna')" },
    ],
    sourceLang: "es",
    // A stand-in for the translation: the same document with its heading changed, as the real one leaves scripts and forms.
    buildLocaleDocs: async (html: string) => [{ locale: "en", html: html.replace(/<h1>(.*?)<\/h1>/, "<h1>$1 EN</h1>") }],
    localesPedidos: ["en"],
  });
}

function releaseTree(sub: string): Record<string, string> {
  const current = path.join(root, sub, "current");
  const base = path.join(root, sub, "releases", readFileSync(current, "utf8").trim());
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else {
        const rel = path.relative(base, full).split(path.sep).join("/");
        out[rel] = rel === "sitemap.xml" ? "(fecha)" : createHash("sha256").update(readFileSync(full)).digest("hex");
      }
    }
  };
  walk(base);
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

const treeSha = (t: Record<string, string>): string =>
  createHash("sha256")
    .update(Object.entries(t).map(([p, h]) => `${p}\t${h}`).join("\n"))
    .digest("hex");

// ── pinned from 04b218999 (see the header) ───────────────────────────────────────────────────────────────────────────────
const PINNED_FILES: Record<string, string> = {
  "contacto/index.html": "ab55ded2ca21096be83b92447c96542134c8381c93254a618f299cefdc23b71a",
  "css/site.css": "e4bc8d3b6884015b3ea4da4599661c2abdf07f6c5d94b09d395b7fe38cf91d0d",
  "en/index.html": "1b353c6c5fb3b6f721170a2ba9701b183c29e8e7072ff4aaa93cc7a3653e54c4",
  "index.html": "b0a54d75f664f60ac40f1fb742f15263925878684cf060f0511bcc16489b6d44",
  "js/app.js": "41943c45aacaf2831d1eb92fe91ef837c7ec5b06905843400770a612b16e2a4e",
  "llms.txt": "4ef9836901ad5e371222bc81a95061001d46a90d1f43fd66c9583add2b8284fa",
  "menu/index.html": "3107711c7f7a6a18fe678765f34536f1d9d11533250d8878a19a3c38345a233d",
  "robots.txt": "1e741b6b1a301271ab7e5e92230ef38634177643ef12fb61f2afcdadc2aff03b",
  "sitemap.xml": "(fecha)",
  "sw.js": "f3b9de0ad2092c80aee477e7d1e08469fe0c0badbcf5b33664dce11c35f7fd55",
};
const PINNED_TREE_SHA = "33dc7320cfd3c42ac790011020caf7526cc02d92951627495cb927ad7e5b348e";

describe("with the flag off and no experiment, the release is byte for byte the one of before the A/B work", () => {
  it("🔴 every file of the release tree (and so the tree) is the one 04b218999 writes", async () => {
    await publish();
    const tree = releaseTree("luna");
    if (process.env.FLAG_OFF_PIN_PRINT === "1") {
      console.log(`PINNED_FILES = ${JSON.stringify(tree, null, 2)}\nPINNED_TREE_SHA = ${JSON.stringify(treeSha(tree))}`);
      return;
    }
    // File by file first: a failure says WHICH file changed, not just that the tree did.
    assert.deepEqual(Object.keys(tree), Object.keys(PINNED_FILES), "the same files, none added and none missing");
    for (const [p, h] of Object.entries(PINNED_FILES)) assert.equal(tree[p], h, `${p} is byte for byte what it was`);
    assert.equal(treeSha(tree), PINNED_TREE_SHA);
  });

  it("it is deterministic: publishing the same fixture again writes the same tree", async () => {
    await publish();
    const again = releaseTree("luna");
    await publish();
    assert.equal(treeSha(releaseTree("luna")), treeSha(again));
  });

  it("and it carries nothing of the A/B work: no manifest, no variant tree, no reader, no form field", async () => {
    await publish();
    const tree = releaseTree("luna");
    assert.ok(!Object.keys(tree).some((p) => p.startsWith("openlen/ab") || p === "ab.json" || p.startsWith("_ab/")));
    const home = readFileSync(path.join(root, "luna", "releases", readFileSync(path.join(root, "luna", "current"), "utf8").trim(), "index.html"), "utf8");
    assert.ok(!home.includes("ol_ab") && !home.includes("_openlen_ab") && !home.includes('var AB="'));
  });
});
