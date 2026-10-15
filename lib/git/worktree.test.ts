// @vitest-environment node
import { describe, expect, it } from "vitest";
import { blobOf } from "./objects";
import { collapseUntracked, computeStatus, isVersionable, workingTree } from "./worktree";

describe("what git sees", () => {
  it("never the terminal's scratch, the read-only folders, the manual or ~", () => {
    for (const p of ["/tmp/x", "/.openlen/versiones/indice.jsonl", "/node_modules/three/package.json", "/home/user/.len/LEN.md", "/AGENTS.md"]) {
      expect(isVersionable(p), p).toBe(false);
    }
    for (const p of ["/index.html", "/src/App.tsx", "/supabase/migrations/1_x.sql", "/LEN.md", "/.len/memory/a.md", "/ajustes/proyecto.json", "/.env"]) {
      expect(isVersionable(p), p).toBe(true);
    }
  });
  it(".gitignore files apply under their own folder", () => {
    const tree = workingTree({ "/.gitignore": "dist/\n*.log\n", "/src/.gitignore": "secret.ts\n", "/dist/a.js": "", "/x.log": "", "/src/secret.ts": "", "/secret.ts": "" });
    expect(tree.isIgnored("dist/a.js")).toBe(true);
    expect(tree.isIgnored("x.log")).toBe(true);
    expect(tree.isIgnored("src/secret.ts")).toBe(true);
    expect(tree.isIgnored("secret.ts")).toBe(false);
  });
  it("status: staged and unstaged, untracked, and an untracked folder collapses", () => {
    const head = new Map([["a.txt", blobOf("a\n").oid], ["b.txt", blobOf("b\n").oid]]);
    const index = { "a.txt": blobOf("a2\n").oid, "b.txt": blobOf("b\n").oid, "c.txt": blobOf("c\n").oid };
    const tree = workingTree({ "/a.txt": "a3\n", "/c.txt": "c\n", "/new/x.txt": "", "/new/y.txt": "", "/d.txt": "" });
    const s = computeStatus(head, index, tree);
    expect(s.tracked).toEqual([
      { path: "a.txt", staged: "M", unstaged: "M" },
      { path: "b.txt", staged: " ", unstaged: "D" },
      { path: "c.txt", staged: "A", unstaged: " " },
    ]);
    expect(collapseUntracked(s.untracked, index)).toEqual(["d.txt", "new/"]);
  });
});
