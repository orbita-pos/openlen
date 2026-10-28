// @vitest-environment node
// The usual terminal (just-bash, no processes) with binary files (spec local
// 2026-10-28-ficheros-al-nivel-de-claude-code, §5): a binary is in its file system with its real bytes,
// loaded only when a command reads it; what nobody touched comes back as the same pointer, and a copy
// or a move of the same bytes is the same pointer, with nothing uploaded again.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getBlob, isBlobPointer, parsePointer, putBlob, makePointer } from "@/lib/files/blob";
import { __setStorageForTest } from "@/lib/storage";
import { FilesystemStorage } from "@/lib/storage/filesystem";

import { TerminalDeLen } from "./terminal";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);

let dir: string;
let subidas: string[];
let lecturas: string[];
let abiertas: TerminalDeLen[] = [];
let puntero: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "openlen-term-bin-"));
  subidas = [];
  const fs = new FilesystemStorage({ rootDir: dir, publicUrlBase: "/uploads" });
  __setStorageForTest({ upload: (a) => (subidas.push(a.key), fs.upload(a)), delete: (k) => fs.delete(k), read: (k) => fs.read(k), exists: (k) => fs.exists(k) });
  puntero = makePointer(await putBlob(PNG));
  subidas = [];
  lecturas = [];
});

afterEach(async () => {
  await Promise.all(abiertas.map((t) => t.cerrar()));
  abiertas = [];
  __setStorageForTest(null);
  rmSync(dir, { recursive: true, force: true });
});

function terminal() {
  const t = new TerminalDeLen({
    cargarFicheros: async () => ({ "/index.html": "<h1>x</h1>\n", "/img/a.png": puntero }),
    leerBlob: async (p) => {
      lecturas.push(p);
      return getBlob(p);
    },
  });
  abiertas.push(t);
  return t;
}

describe("the usual terminal with binary files", () => {
  it("a command that doesn't touch a binary leaves it as the same pointer, and its bytes are never fetched", async () => {
    const r = await terminal().ejecutar("echo hola");
    expect(r.ficheros?.["/img/a.png"]).toBe(puntero);
    expect(lecturas).toEqual([]);
  });

  it("ls -la shows the real size and cat gives the real bytes", async () => {
    const t = terminal();
    expect((await t.ejecutar("ls -la /img")).stdout).toMatch(new RegExp(`\\b${PNG.byteLength}\\b.*a\\.png`));
    expect((await t.ejecutar("cat /img/a.png | wc -c")).stdout.trim()).toBe(String(PNG.byteLength));
  });

  it("mv moves the pointer; cp of the same bytes is the same pointer: nothing is uploaded again", async () => {
    const t = terminal();
    const mv = await t.ejecutar("mv /img/a.png /img/b.png");
    expect(mv.ficheros?.["/img/b.png"]).toBe(puntero);
    expect(mv.ficheros?.["/img/a.png"]).toBeUndefined();
    const cp = await t.ejecutar("cp /img/b.png /img/c.png");
    expect(cp.ficheros?.["/img/c.png"]).toBe(puntero);
    expect(subidas).toEqual([]);
  });

  it("a new binary made by a command comes back as a new pointer to its bytes", async () => {
    const r = await terminal().ejecutar("printf '\\000\\001\\002' > /x.bin");
    const nuevo = r.ficheros?.["/x.bin"] ?? "";
    expect(isBlobPointer(nuevo)).toBe(true);
    expect(parsePointer(nuevo)?.size).toBe(3);
    expect(Array.from(await getBlob(nuevo))).toEqual([0, 1, 2]);
  });

  it("text stays text", async () => {
    const r = await terminal().ejecutar("echo hola > /a.txt");
    expect(r.ficheros?.["/a.txt"]).toBe("hola\n");
  });
});
