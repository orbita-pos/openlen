import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { internalRefs, resolves } from "./lib-links.mjs";

test("se extraen href, src y cada url de srcset, sin anclas ni query", () => {
  const html = `<a href="/es/">x</a><a href="https://x.com/">y</a><img src="/img/a.webp" srcset="/img/a-1.avif 1x, /img/a-2.avif 2x"><a href="/es/research/#abierto">z</a><a href="#top">t</a>`;
  assert.deepEqual(internalRefs(html).sort(), [
    "/es/",
    "/es/research/",
    "/img/a-1.avif",
    "/img/a-2.avif",
    "/img/a.webp",
  ]);
});

test("una ruta resuelve a fichero o a carpeta con index.html", () => {
  const out = mkdtempSync(join(tmpdir(), "len-"));
  mkdirSync(join(out, "es"));
  writeFileSync(join(out, "es", "index.html"), "");
  writeFileSync(join(out, "a.webp"), "");
  assert.equal(resolves(out, "/es/"), true);
  assert.equal(resolves(out, "/a.webp"), true);
  assert.equal(resolves(out, "/en/"), false);
});
