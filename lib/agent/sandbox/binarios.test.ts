// The box and binary files (spec local 2026-10-28-ficheros-al-nivel-de-claude-code, §4-§5): nothing Len makes
// in the box is lost up to 50 MB a file; a binary of the project goes into the box as its bytes, once; and what
// a package manager regenerates (the project's .gitignore, or the usual folders) never comes back.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getBlob, isBlobPointer, makePointer, parsePointer, putBlob } from "@/lib/files/blob";
import { __setStorageForTest } from "@/lib/storage";
import { FilesystemStorage } from "@/lib/storage/filesystem";

import type { SandboxHandle } from "./driver";
import { fakeDriver } from "./fake-driver";
import { SandboxTerminal } from "./sandbox-terminal";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openlen-box-bin-"));
  __setStorageForTest(new FilesystemStorage({ rootDir: dir, publicUrlBase: "/uploads" }));
});
afterEach(() => {
  __setStorageForTest(null);
  rmSync(dir, { recursive: true, force: true });
});

const bytes = (n: number, fill = 7) => {
  const b = new Uint8Array(n).fill(fill);
  b[0] = 0; // a NUL: binary
  return b;
};

async function open(projectFiles: Record<string, string>, syncedManifest: Record<string, string> = {}) {
  const d = fakeDriver();
  const handle: SandboxHandle = await d.create({ template: "t", metadata: {} });
  const terminal = new SandboxTerminal({ handle, projectFiles, syncedManifest, bridge: {}, readOnly: async () => ({}), startedAt: Date.now() });
  return { d, handle, terminal };
}

describe("the box keeps binaries", () => {
  it("a PNG of 3 MB and a PDF of 20 MB made in the box come back as pointers to their bytes", async () => {
    const { handle, terminal } = await open({ "/index.html": "<h1>x</h1>" });
    await terminal.ejecutar("true");
    const png = bytes(3 * 1024 * 1024);
    const pdf = bytes(20 * 1024 * 1024, 9);
    await handle.writeBytes!({ "/img/hecha.png": png, "/doc/informe.pdf": pdf });
    const r = await terminal.ejecutar("true");
    const p = r.ficheros?.["/img/hecha.png"] ?? "";
    expect(isBlobPointer(p)).toBe(true);
    expect(parsePointer(p)?.size).toBe(png.byteLength);
    expect((await getBlob(p)).byteLength).toBe(png.byteLength);
    expect(parsePointer(r.ficheros?.["/doc/informe.pdf"] ?? "")?.size).toBe(pdf.byteLength);
  });

  it("one over 50 MB is not saved, and the output says so", async () => {
    const { handle, terminal } = await open({ "/index.html": "<h1>x</h1>" });
    await terminal.ejecutar("true");
    await handle.writeBytes!({ "/video/largo.mp4": bytes(50 * 1024 * 1024 + 1) });
    const r = await terminal.ejecutar("true");
    expect(r.ficheros?.["/video/largo.mp4"]).toBeUndefined();
    expect(r.noGuardados).toEqual([{ ruta: "/video/largo.mp4", motivo: "too_large" }]);
  });

  it("what the project's .gitignore ignores, or the usual folders without one, never comes back", async () => {
    const { handle, terminal } = await open({ "/index.html": "<h1>x</h1>", "/.gitignore": "out/\n" });
    await terminal.ejecutar("true");
    await handle.write({ "/out/a.js": "x", "/node_modules/x/index.js": "y", "/src/ok.js": "z" });
    const r = await terminal.ejecutar("true");
    expect(r.ficheros?.["/out/a.js"]).toBeUndefined();
    expect(r.ficheros?.["/node_modules/x/index.js"]).toBeUndefined();
    expect(r.ficheros?.["/src/ok.js"]).toBe("z");

    const sin = await open({ "/index.html": "<h1>x</h1>" });
    await sin.terminal.ejecutar("true");
    await sin.handle.write({ "/.venv/lib/x.py": "y", "/.cache/a": "z" });
    const r2 = await sin.terminal.ejecutar("true");
    expect(r2.ficheros?.["/.venv/lib/x.py"]).toBeUndefined();
    expect(r2.ficheros?.["/.cache/a"]).toBeUndefined();
  });

  it("a binary of the project goes into the box as its bytes, and an unchanged one is not written again", async () => {
    const png = bytes(1000);
    const puntero = makePointer(await putBlob(png));
    const first = await open({ "/index.html": "<h1>x</h1>", "/img/a.png": puntero });
    await first.terminal.ejecutar("true");
    expect(Array.from(first.d.bytesOf(first.handle.id).get("/img/a.png") ?? [])).toEqual(Array.from(png));

    // The next turn, on the same box, with what the last one synced: nothing to write.
    const synced = { "/index.html": "", "/img/a.png": parsePointer(puntero)!.sha256 };
    const again = new SandboxTerminal({ handle: first.handle, projectFiles: { "/index.html": "<h1>x</h1>", "/img/a.png": puntero }, syncedManifest: synced, bridge: {}, readOnly: async () => ({}), startedAt: Date.now() });
    first.d.bytesOf(first.handle.id).delete("/img/a.png");
    await again.ejecutar("true");
    expect(first.d.bytesOf(first.handle.id).has("/img/a.png")).toBe(false);
  });
});
