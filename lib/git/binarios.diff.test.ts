// Binary files in OpenLen's git, against the real git 2.45.2 (spec local 2026-10-28-ficheros-al-nivel-de-claude-code,
// §8): the real repository has the bytes, ours a blob pointer to them; the commits are the same, `status` and
// `diff` say the same, and restoring a binary gives back its pointer without downloading anything.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { makePointer, putBlob } from "@/lib/files/blob";
import { __setStorageForTest } from "@/lib/storage";
import { FilesystemStorage } from "@/lib/storage/filesystem";

import { buildTree } from "./repository";
import { Pair } from "./test-support/pair";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 1, 2, 3]);
const PNG2 = Uint8Array.from([...PNG.slice(0, -1), 9]);

let almacen: string;
beforeAll(() => {
  almacen = mkdtempSync(path.join(tmpdir(), "len-git-blobs-"));
  __setStorageForTest(new FilesystemStorage({ rootDir: almacen, publicUrlBase: "/uploads" }));
});
afterAll(() => {
  __setStorageForTest(null);
  rmSync(almacen, { recursive: true, force: true });
});

let pair: Pair;
beforeEach(() => {
  pair = new Pair();
});
afterEach(() => pair.dispose());

/** The same binary on both sides: its bytes in the real repository, its pointer in ours. */
async function writeBinary(p: string, bytes: Uint8Array) {
  writeFileSync(path.join(pair.real.dir, ...p.split("/")), bytes);
  pair.ours.files[`/${p}`] = makePointer(await putBlob(bytes));
}

describe("binary files, against the real git", () => {
  it("🔴 add + commit of a PNG: the same commit; status clean on both", async () => {
    await pair.start({ "index.html": "<h1>x</h1>\n" });
    pair.real.write({ "img/.keep": "" });
    pair.ours.write({ "img/.keep": "" });
    await writeBinary("img/a.png", PNG);
    pair.tick();
    await pair.both(["add", "-A"]);
    const c = await pair.both(["commit", "-q", "-m", "a png"]);
    expect(c.ours.exitCode).toBe(c.real.exitCode);
    const heads = await pair.heads();
    expect(heads.ours).toBe(heads.real);
    const s = await pair.both(["status", "--short"]);
    expect(s.ours.stdout).toBe(s.real.stdout);
  });

  it("🔴 a changed binary: status and diff say what git says (Binary files … differ)", async () => {
    await pair.start({ "index.html": "<h1>x</h1>\n" });
    await writeBinary("a.png", PNG);
    pair.tick();
    await pair.both(["add", "-A"]);
    await pair.both(["commit", "-q", "-m", "png"]);
    await writeBinary("a.png", PNG2);
    // A text change next to the binary: the stat's columns line up as git's.
    pair.write({ "index.html": "<h1>y</h1>\n<p>z</p>\n" });
    for (const args of [["status", "--short"], ["diff"], ["diff", "--stat"], ["diff", "--numstat"]]) {
      const r = await pair.both(args);
      expect(r.ours.stdout, args.join(" ")).toBe(r.real.stdout);
    }
  });

  it("🔴 git checkout -- a.png gives the pointer back (the real one, the bytes)", async () => {
    await pair.start({ "index.html": "<h1>x</h1>\n" });
    await writeBinary("a.png", PNG);
    pair.tick();
    await pair.both(["add", "-A"]);
    await pair.both(["commit", "-q", "-m", "png"]);
    const original = pair.ours.files["/a.png"];
    await writeBinary("a.png", PNG2);
    await pair.both(["checkout", "--", "a.png"]);
    expect(pair.ours.files["/a.png"]).toBe(original);
    const s = await pair.both(["status", "--short"]);
    expect(s.ours.stdout).toBe(s.real.stdout);
    expect(s.ours.stdout).toBe("");
  });

  it("a move there and back again: status clean", async () => {
    await pair.start({ "index.html": "<h1>x</h1>\n" });
    await writeBinary("a.png", PNG);
    pair.tick();
    await pair.both(["add", "-A"]);
    await pair.both(["commit", "-q", "-m", "png"]);
    const p = pair.ours.files["/a.png"]!;
    delete pair.ours.files["/a.png"];
    pair.ours.files["/b.png"] = p;
    delete pair.ours.files["/b.png"];
    pair.ours.files["/a.png"] = p;
    expect((await pair.ours.git(["status", "--short"])).stdout).toBe("");
  });
});

describe("file modes in trees, against the real git", () => {
  it("an executable, a link and a submodule entry: the same tree id", async () => {
    pair.real.write({ "run.sh": "echo hi\n", "target.txt": "t\n" });
    const blob = pair.real.git(["hash-object", "-w", "run.sh"]).stdout.trim();
    const link = pair.real.git(["hash-object", "-w", "--stdin"], { input: "target.txt" }).stdout.trim();
    const sub = "1".repeat(40);
    pair.real.git(["update-index", "--add", "--cacheinfo", `100755,${blob},run.sh`]);
    pair.real.git(["update-index", "--add", "--cacheinfo", `120000,${link},link`]);
    pair.real.git(["update-index", "--add", "--cacheinfo", `160000,${sub},vendor/lib`]);
    const real = pair.real.git(["write-tree"]).stdout.trim();
    const ours = buildTree(new Map([["run.sh", blob], ["link", link], ["vendor/lib", sub]]), { "run.sh": "100755", link: "120000", "vendor/lib": "160000" }).root;
    expect(ours).toBe(real);
  });
});
