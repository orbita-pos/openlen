// @vitest-environment node
// `git merge` in OpenLen's git (spec local 2026-10-28-ficheros-al-nivel-de-claude-code, §8), against the real git
// 2.45.2: fast-forward, a three-way merge with its two-parent commit (the same oid as git's), conflicts with git's
// markers byte for byte, a binary conflict, --abort, and the error when a local change would be overwritten.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { makePointer, putBlob } from "@/lib/files/blob";
import { __setStorageForTest } from "@/lib/storage";
import { FilesystemStorage } from "@/lib/storage/filesystem";

import { Pair } from "./test-support/pair";

let almacen: string;
beforeAll(() => {
  almacen = mkdtempSync(path.join(tmpdir(), "len-git-merge-blobs-"));
  __setStorageForTest(new FilesystemStorage({ rootDir: almacen, publicUrlBase: "/uploads" }));
});
afterAll(() => {
  __setStorageForTest(null);
  rmSync(almacen, { recursive: true, force: true });
});

let pair: Pair;
afterEach(() => pair?.dispose());
async function same(args: readonly string[]): Promise<void> {
  const { real, ours } = await pair.both(args);
  expect(ours, args.join(" ")).toEqual(real);
}
async function sameHeads(): Promise<void> {
  const h = await pair.heads();
  expect(h.ours).toBe(h.real);
}
function sameFiles(): void {
  const s = pair.snapshots();
  expect(s.ours).toEqual(s.real);
}

const LINES = Array.from({ length: 12 }, (_, i) => `linea ${i + 1}\n`).join("");
const SITE = { "index.html": "<h1>Hola</h1>\n<p>uno</p>\n<p>dos</p>\n", "notas.txt": LINES };

/** A branch `feature` off main with `theirs` committed there, and `ours` committed on main. */
async function diverge(base: Readonly<Record<string, string>>, ours: Readonly<Record<string, string | null>>, theirs: Readonly<Record<string, string | null>>): Promise<void> {
  pair = new Pair();
  await pair.start(base);
  await same(["switch", "-c", "feature"]);
  pair.tick();
  pair.write(theirs);
  await same(["add", "-A"]);
  await same(["commit", "-m", "en feature"]);
  await same(["switch", "main"]);
  pair.tick();
  pair.write(ours);
  await same(["add", "-A"]);
  await same(["commit", "-m", "en main"]);
  pair.tick();
}

describe("git merge, against the real git", () => {
  it("🔴 fast-forward: Updating a..b, Fast-forward, the stat; then Already up to date", async () => {
    pair = new Pair();
    await pair.start(SITE);
    await same(["switch", "-c", "feature"]);
    pair.tick();
    pair.write({ "index.html": "<h1>Hola</h1>\n<p>uno!</p>\n<p>dos</p>\n", "nuevo.txt": "n\n" });
    await same(["add", "-A"]);
    await same(["commit", "-m", "en feature"]);
    await same(["switch", "main"]);
    await same(["merge", "feature"]);
    await sameHeads();
    sameFiles();
    await same(["merge", "feature"]);
    await same(["status"]);
  });

  it("🔴 three-way without conflicts: Auto-merging, the 'ort' line, a two-parent commit with git's oid", async () => {
    await diverge(SITE, { "notas.txt": LINES.replace("linea 2\n", "linea dos\n") }, { "notas.txt": LINES.replace("linea 11\n", "linea once\n"), "otro.txt": "o\n" });
    await same(["merge", "feature"]);
    await sameHeads();
    sameFiles();
    await same(["log", "--oneline"]);
    await same(["log", "-1", "--format=%P%n%s"]);
    await same(["log", "-1"]);
    await same(["show", "HEAD"]);
    await same(["show", "--stat", "HEAD"]);
    await same(["log", "--oneline", "main..feature"]);
    await same(["status"]);
    // And the other way: a merge into a branch that isn't main names it.
    await same(["switch", "feature"]);
    pair.tick();
    pair.write({ "otro.txt": "o2\n" });
    await same(["commit", "-am", "otro"]);
    pair.tick();
    await same(["merge", "main"]);
    await sameHeads();
    await same(["log", "-1", "--format=%s"]);
  });

  it("🔴 a conflict: git's markers byte for byte, status, commit refused until add, then the merge commit", async () => {
    await diverge(SITE, { "index.html": "<h1>Hola</h1>\n<p>uno en main</p>\n<p>dos</p>\n" }, { "index.html": "<h1>Hola</h1>\n<p>uno en feature</p>\n<p>dos</p>\n" });
    await same(["merge", "feature"]);
    sameFiles();
    await sameHeads();
    await same(["status"]);
    await same(["status", "--short"]);
    await same(["commit", "-m", "x"]);
    await same(["merge", "feature"]);
    pair.write({ "index.html": "<h1>Hola</h1>\n<p>uno en los dos</p>\n<p>dos</p>\n" });
    await same(["add", "index.html"]);
    await same(["status"]);
    await same(["commit", "--no-edit"]);
    await sameHeads();
    await same(["log", "-1", "--format=%B"]);
    await same(["status"]);
  });

  it("the line merge is git's: neighbours, identical changes, conflicts close together, a missing newline", async () => {
    const cases: readonly [string, string, string][] = [
      // Adjacent lines changed on each side: git calls that a conflict.
      [LINES, LINES.replace("linea 4\n", "cuatro\n"), LINES.replace("linea 5\n", "cinco\n")],
      // The same change on both sides: no conflict.
      [LINES, LINES.replace("linea 6\n", "seis\n"), LINES.replace("linea 6\n", "seis\n")],
      // Two conflicts three lines apart: one conflict, as git's zealous merge joins them.
      [LINES, LINES.replace("linea 2\n", "dos A\n").replace("linea 6\n", "seis A\n"), LINES.replace("linea 2\n", "dos B\n").replace("linea 6\n", "seis B\n")],
      // Two conflicts far apart: two conflicts.
      [LINES, LINES.replace("linea 1\n", "uno A\n").replace("linea 11\n", "once A\n"), LINES.replace("linea 1\n", "uno B\n").replace("linea 11\n", "once B\n")],
      // A conflict whose sides share lines: git shrinks it to what differs.
      [LINES, LINES.replace("linea 3\nlinea 4\nlinea 5\n", "igual\ntres A\nigual 2\n"), LINES.replace("linea 3\nlinea 4\nlinea 5\n", "igual\ntres B\nigual 2\n")],
      // No newline at the end, changed on both sides.
      ["a\nb\nc", "a\nb\nC1", "a\nb\nC2"],
      // One side deletes what the other changes.
      [LINES, LINES.replace("linea 7\nlinea 8\n", ""), LINES.replace("linea 8\n", "ocho\n")],
    ];
    for (const [base, ours, theirs] of cases) {
      await diverge({ "f.txt": base }, { "f.txt": ours }, { "f.txt": theirs });
      await same(["merge", "feature"]);
      sameFiles();
      pair.dispose();
    }
  });

  it("an add/add conflict and a modify/delete conflict say what git says", async () => {
    await diverge(SITE, { "nuevo.txt": "de main\n", "notas.txt": null }, { "nuevo.txt": "de feature\n", "notas.txt": LINES.replace("linea 1\n", "uno\n") });
    await same(["merge", "feature"]);
    sameFiles();
    await same(["status"]);
    await same(["status", "--short"]);
  });

  it("🔴 a binary changed on both sides: the warning, the conflict, our version stays", async () => {
    const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 1, 2, 3]);
    const binary = async (bytes: Uint8Array) => {
      writeFileSync(path.join(pair.real.dir, "a.png"), bytes);
      pair.ours.files["/a.png"] = makePointer(await putBlob(bytes));
    };
    pair = new Pair();
    await pair.start(SITE);
    await binary(PNG);
    await same(["add", "-A"]);
    await same(["commit", "-m", "png"]);
    await same(["switch", "-c", "feature"]);
    pair.tick();
    await binary(Uint8Array.from([...PNG, 4]));
    await same(["commit", "-am", "png feature"]);
    await same(["switch", "main"]);
    pair.tick();
    await binary(Uint8Array.from([...PNG, 5]));
    await same(["commit", "-am", "png main"]);
    pair.tick();
    await same(["merge", "feature"]);
    await same(["status", "--short"]);
    await same(["diff", "--stat", "HEAD"]);
  });

  it("🔴 merge --abort puts everything back", async () => {
    await diverge(SITE, { "index.html": "<h1>main</h1>\n" }, { "index.html": "<h1>feature</h1>\n" });
    await same(["merge", "feature"]);
    await same(["merge", "--abort"]);
    sameFiles();
    await sameHeads();
    await same(["status"]);
    await same(["merge", "--abort"]);
  });

  it("with unmerged paths you can't switch; git reset ends the merge", async () => {
    await diverge(SITE, { "index.html": "<h1>main</h1>\n" }, { "index.html": "<h1>feature</h1>\n" });
    await same(["merge", "feature"]);
    await same(["switch", "feature"]);
    await same(["checkout", "feature"]);
    await same(["reset"]);
    await same(["status"]);
    await same(["merge", "--abort"]);
  });

  it("a local change the merge would overwrite: git's error, nothing moves; an unknown branch: git's error", async () => {
    await diverge(SITE, { "notas.txt": LINES.replace("linea 2\n", "dos\n") }, { "index.html": "<h1>feature</h1>\n" });
    pair.write({ "index.html": "<h1>sin guardar</h1>\n" });
    await same(["merge", "feature"]);
    await sameHeads();
    sameFiles();
    await same(["merge", "noexiste"]);
  });
});
