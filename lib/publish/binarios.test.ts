// PUBLICAR CUALQUIER FICHERO (spec local 2026-10-28-ficheros-al-nivel-de-claude-code, §7): un binario de la carpeta
// llega a la release con sus BYTES, en su ruta; un .html que no es una página, tal cual.
// Run: npx tsx --require ./scripts/test-node-server-only-shim.cjs --test lib/publish/binarios.test.ts
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.OPENLEN_IMAGE_BAKE = "0";
process.env.OPENLEN_FONT_BAKE = "0";
process.env.OPENLEN_LOCALIZE = "0";

const root = mkdtempSync(path.join(tmpdir(), "olbin-"));
process.env.PUBLISH_ROOT = root;
const almacen = mkdtempSync(path.join(tmpdir(), "olbin-store-"));

import { publishToDir } from "./filesystem";
import { makePointer, putBlob } from "@/lib/files/blob";
import { __setStorageForTest } from "@/lib/storage";
import { FilesystemStorage } from "@/lib/storage/filesystem";

__setStorageForTest(new FilesystemStorage({ rootDir: almacen, publicUrlBase: "/uploads" }));
after(() => {
  __setStorageForTest(null);
  rmSync(root, { recursive: true, force: true });
  rmSync(almacen, { recursive: true, force: true });
});

function releaseViva(sub: string): string {
  const current = path.join(root, sub, "current");
  try {
    return path.join(root, sub, "releases", readFileSync(current, "utf8").trim());
  } catch {
    return current;
  }
}

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0xff, 0xfe]);

describe("publicar binarios de la carpeta", () => {
  it("🔴 una imagen y una fuente se escriben con sus bytes; un .html suelto, tal cual", async () => {
    const fuente = Uint8Array.from([0x77, 0x4f, 0x46, 0x32, 0x00, 0x01, 0x02]);
    await publishToDir({
      subdomain: "binarios",
      html: '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>x</title></head><body><img src="/img/a.png"></body></html>',
      files: [
        { path: "/img/a.png", content: makePointer(await putBlob(PNG)) },
        { path: "/fonts/x.woff2", content: makePointer(await putBlob(fuente)) },
        { path: "/legal.html", content: "<!doctype html><p>legal</p>" },
      ],
    });
    const rel = releaseViva("binarios");
    assert.deepEqual(Array.from(readFileSync(path.join(rel, "img/a.png"))), Array.from(PNG));
    assert.deepEqual(Array.from(readFileSync(path.join(rel, "fonts/x.woff2"))), Array.from(fuente));
    assert.equal(readFileSync(path.join(rel, "legal.html"), "utf8"), "<!doctype html><p>legal</p>");
  });
});

describe("invariante 4 con los .html sueltos", () => {
  it("🔴 un .html de la carpeta con data-slot-path no llega al disco: la publicación se niega", async () => {
    await assert.rejects(
      publishToDir({
        subdomain: "binarios-slot",
        html: '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>x</title></head><body><p>x</p></body></html>',
        files: [{ path: "/legal.html", content: '<p data-slot-path="hero.title">x</p>' }],
      }),
      /refusing to write \/legal\.html containing data-slot-path/,
    );
  });
});

describe("una app que importa una foto, como en Vite", () => {
  it("🔴 el paquete lleva su URL y la release, la foto con sus bytes", async () => {
    const { stopBundlerWorker } = await import("@/lib/apps/bundler/bundle-app");
    try {
      await publishToDir({
        subdomain: "app-foto",
        html: '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>x</title></head><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>',
        app: { catalogo: "2026-11", entrada: "/src/main.jsx" },
        files: [
          { path: "/src/main.jsx", content: 'import { createRoot } from "react-dom/client";\nimport hero from "./hero.png";\ncreateRoot(document.getElementById("root")).render(<img src={hero} alt="" />);' },
          { path: "/src/hero.png", content: makePointer(await putBlob(PNG)) },
        ],
      });
      const rel = releaseViva("app-foto");
      assert.ok(readFileSync(path.join(rel, "src/main.jsx"), "utf8").includes('"/src/hero.png"'), "the bundle carries the photo's URL");
      assert.deepEqual(Array.from(readFileSync(path.join(rel, "src/hero.png"))), Array.from(PNG));
    } finally {
      stopBundlerWorker();
    }
  });
});
