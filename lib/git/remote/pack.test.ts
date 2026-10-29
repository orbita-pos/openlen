// @vitest-environment node
// Packfiles against the real git 2.45.2: a pack git writes with OFS deltas and one with REF deltas read back to the same
// objects `git cat-file` gives; a pack we write accepted by `git index-pack` and clean under `git fsck`.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { hashObject, type ObjectType } from "../objects";

import { readPack, scanPack } from "./pack-read";
import { writePack } from "./pack-write";

let dir: string;
const git = (args: readonly string[], input?: Buffer | string) => {
  const r = spawnSync("git", [...args], { cwd: dir, input, env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "A", GIT_AUTHOR_EMAIL: "a@x", GIT_COMMITTER_NAME: "A", GIT_COMMITTER_EMAIL: "a@x" } });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout as Buffer;
};

beforeAll(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "len-git-pack-"));
  git(["init", "-q", "-b", "main"]);
  // Similar versions of one file: git packs them as deltas of each other.
  const lines = Array.from({ length: 200 }, (_, i) => `linea ${i} ${"x".repeat(i % 17)}\n`);
  for (let k = 0; k < 6; k++) {
    lines[k * 30] = `cambio ${k}\n`;
    writeFileSync(path.join(dir, "f.txt"), lines.join(""));
    writeFileSync(path.join(dir, `b${k}.bin`), Buffer.from([0, 1, 2, k, 255, 0, 10]));
    git(["add", "-A"]);
    git(["commit", "-q", "-m", `c${k}`]);
  }
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function everyObject(): string[] {
  return git(["rev-list", "--objects", "--all"]).toString("utf8").trim().split("\n").map((l) => l.split(" ")[0]!);
}
function catFile(oid: string): { type: ObjectType; content: Buffer } {
  return { type: git(["cat-file", "-t", oid]).toString("utf8").trim() as ObjectType, content: git(["cat-file", git(["cat-file", "-t", oid]).toString("utf8").trim(), oid]) };
}

describe("packfiles, against the real git", () => {
  for (const [what, flags, deltaType] of [["OFS deltas", ["--delta-base-offset"], 6], ["REF deltas", [], 7]] as const) {
    it(`🔴 a pack with ${what} reads back to git's objects`, async () => {
      const oids = everyObject();
      const pack = new Uint8Array(git(["pack-objects", "--stdout", "--window=10", ...flags], `${oids.join("\n")}\n`));
      expect(scanPack(pack).some((e) => e.type === deltaType)).toBe(true);
      const objects = await readPack(pack, async () => undefined);
      expect(objects.map((o) => o.oid).sort()).toEqual([...oids].sort());
      for (const o of objects) {
        const real = catFile(o.oid);
        expect(o.type).toBe(real.type);
        expect(Buffer.from(o.content).equals(real.content)).toBe(true);
        expect(hashObject(o.type, o.content)).toBe(o.oid);
      }
    });
  }

  it("a pack whose checksum is wrong is refused", async () => {
    const pack = new Uint8Array(git(["pack-objects", "--stdout"], `${everyObject().slice(0, 3).join("\n")}\n`));
    pack[pack.length - 1] ^= 0xff;
    await expect(readPack(pack, async () => undefined)).rejects.toThrow(/checksum/);
  });

  it("🔴 a pack we write: git index-pack takes it and git fsck is clean", async () => {
    const objects = await readPack(new Uint8Array(git(["pack-objects", "--stdout", "--delta-base-offset"], `${everyObject().join("\n")}\n`)), async () => undefined);
    const other = mkdtempSync(path.join(os.tmpdir(), "len-git-pack-in-"));
    try {
      spawnSync("git", ["init", "-q", "--bare", other]);
      const r = spawnSync("git", ["index-pack", "--stdin", "--strict"], { cwd: other, input: Buffer.from(writePack(objects)) });
      expect(r.status, r.stderr.toString()).toBe(0);
      const head = git(["rev-parse", "HEAD"]).toString("utf8").trim();
      spawnSync("git", ["update-ref", "refs/heads/main", head], { cwd: other });
      const fsck = spawnSync("git", ["fsck", "--full", "--strict"], { cwd: other, encoding: "utf8" });
      expect(fsck.status, fsck.stderr).toBe(0);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });
});
