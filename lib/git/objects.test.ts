// @vitest-environment node
// Every object we write must hash exactly as git's: these tests ask the real git binary.
import { afterAll, describe, expect, it } from "vitest";
import {
  EMPTY_TREE_OID,
  blobOf,
  decodeCommit,
  decodeTree,
  encodeCommit,
  encodeTree,
  makeObject,
  type Commit,
  type TreeEntry,
} from "./objects";
import { AUTHOR, RealRepo } from "./test-support/real-git";

const repo = new RealRepo();
afterAll(() => repo.dispose());

describe("git objects, against the real git", () => {
  it("a blob hashes like `git hash-object`", () => {
    for (const text of ["", "hola\n", "no final newline", "ñandú 🎉\n", "<h1>x</h1>\r\n"]) {
      expect(blobOf(text).oid).toBe(repo.git(["hash-object", "--stdin"], { input: text }).stdout.trim());
    }
  });

  it("a tree hashes like `git mktree`, in git's order (a subtree sorts as if it ended in /)", () => {
    const a = repo.git(["hash-object", "-w", "--stdin"], { input: "a\n" }).stdout.trim();
    expect(blobOf("a\n").oid).toBe(a);
    const sub = repo.git(["mktree"], { input: `100644 blob ${a}\tx.txt\n` }).stdout.trim();
    const entries: TreeEntry[] = [
      { name: "b.txt", mode: "100644", oid: a },
      { name: "a-b", mode: "100644", oid: a },
      { name: "a", mode: "40000", oid: sub },
      { name: "a.txt", mode: "100644", oid: a },
      { name: "é.html", mode: "100644", oid: a },
    ];
    const input = entries.map((e) => `${e.mode === "40000" ? "040000 tree" : "100644 blob"} ${e.oid}\t${e.name}\n`).join("");
    expect(makeObject("tree", encodeTree(entries)).oid).toBe(repo.git(["mktree"], { input }).stdout.trim());
    expect(makeObject("tree", encodeTree([{ name: "x.txt", mode: "100644", oid: a }])).oid).toBe(sub);
  });

  it("the empty tree is git's", () => {
    expect(makeObject("tree", encodeTree([])).oid).toBe(EMPTY_TREE_OID);
    expect(repo.git(["mktree"], { input: "" }).stdout.trim()).toBe(EMPTY_TREE_OID);
  });

  it("a commit hashes like `git commit-tree`, root and child", () => {
    const sig = { name: AUTHOR.name, email: AUTHOR.email, timestamp: repo.timestamp, timezone: "+0000" };
    const root: Commit = { tree: EMPTY_TREE_OID, parents: [], author: sig, committer: sig, message: "Initial commit\n" };
    const rootOid = makeObject("commit", encodeCommit(root)).oid;
    expect(rootOid).toBe(repo.git(["commit-tree", EMPTY_TREE_OID, "-m", "Initial commit"]).stdout.trim());
    const child: Commit = { ...root, parents: [rootOid], message: "Add the cart\n\nSo customers can order.\n" };
    const real = repo.git(["commit-tree", EMPTY_TREE_OID, "-p", rootOid, "-m", "Add the cart", "-m", "So customers can order."]);
    expect(makeObject("commit", encodeCommit(child)).oid).toBe(real.stdout.trim());
  });

  it("decodes what it encodes", () => {
    const entries: TreeEntry[] = [
      { name: "a", mode: "40000", oid: EMPTY_TREE_OID },
      { name: "b.txt", mode: "100644", oid: blobOf("b").oid },
    ];
    expect(decodeTree(encodeTree(entries))).toEqual(entries);
    const sig = { name: "Ana Lopez", email: "a@b", timestamp: 1, timezone: "+0000" };
    const commit: Commit = { tree: EMPTY_TREE_OID, parents: [blobOf("p").oid], author: sig, committer: sig, message: "m\n" };
    expect(decodeCommit(encodeCommit(commit))).toEqual(commit);
  });
});
