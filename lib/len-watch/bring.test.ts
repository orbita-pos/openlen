// @vitest-environment node
// «Traer el arreglo» (spec local 2026-10-30-len-watch, §5.5 step 5): what `git stash` + `git merge len-watch/…` +
// `git stash pop` would do to the owner's draft — a three-way merge (base = what was published, ours = the draft,
// theirs = the branch), deciding what to write; never conflict markers in anybody's app.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { makePointer } from "@/lib/files/blob-pointer";
import { oidOfContent } from "@/lib/git/content";

import { planBring } from "./bring";

const POINTER = makePointer({ sha256: "e".repeat(64), size: 3, gitOid: "f".repeat(40) });

/** Trees (absolute path → oid) from contents, and the reader of their texts. */
function sides(...files: Record<string, string>[]) {
  const texts = new Map<string, string>();
  const maps = files.map(
    (f) =>
      new Map(
        Object.entries(f).map(([path, content]) => {
          const oid = oidOfContent(content);
          texts.set(oid, content);
          return [path, oid] as const;
        }),
      ),
  );
  return { base: maps[0]!, ours: maps[1]!, theirs: maps[2]!, text: async (oid: string) => texts.get(oid)! };
}

const FIVE = "L1\nL2\nL3\nL4\nL5\n";

describe("planBring", () => {
  it("the fix enters and what the owner had half done stays half done", async () => {
    const s = sides({ "/index.html": FIVE, "/js/a.js": "a" }, { "/index.html": FIVE.replace("L1", "L1 owner"), "/js/a.js": "a owner" }, { "/index.html": FIVE.replace("L5", "L5 fix"), "/js/a.js": "a" });
    const p = await planBring(s.base, s.ours, s.theirs, s.text);
    expect(p.kind).toBe("clean");
    if (p.kind !== "clean") return;
    expect([...p.writes.keys()]).toEqual(["/index.html"]);
    expect(p.writes.get("/index.html")).toBe("L1 owner\nL2\nL3\nL4\nL5 fix\n");
  });

  it("the same lines changed on both sides → conflict, and nothing to write", async () => {
    const s = sides({ "/index.html": FIVE }, { "/index.html": FIVE.replace("L3", "L3 owner") }, { "/index.html": FIVE.replace("L3", "L3 fix") });
    expect(await planBring(s.base, s.ours, s.theirs, s.text)).toEqual({ kind: "conflict", paths: ["/index.html"] });
  });

  it("the owner's draft already has the fix → nothing", async () => {
    const fixed = FIVE.replace("L5", "L5 fix");
    const s = sides({ "/index.html": FIVE }, { "/index.html": fixed }, { "/index.html": fixed });
    expect(await planBring(s.base, s.ours, s.theirs, s.text)).toEqual({ kind: "nothing" });
  });

  it("a file the fix created arrives; a file the fix deleted goes", async () => {
    const s = sides({ "/old.js": "old", "/index.html": FIVE }, { "/old.js": "old", "/index.html": FIVE }, { "/new.js": "new", "/index.html": FIVE });
    const p = await planBring(s.base, s.ours, s.theirs, s.text);
    expect(p.kind).toBe("clean");
    if (p.kind !== "clean") return;
    expect(Object.fromEntries(p.writes)).toEqual({ "/new.js": "new", "/old.js": null });
  });

  it("an untouched binary pointer is not written", async () => {
    const s = sides({ "/img/a.webp": POINTER, "/index.html": FIVE }, { "/img/a.webp": POINTER, "/index.html": FIVE }, { "/img/a.webp": POINTER, "/index.html": FIVE.replace("L5", "L5 fix") });
    const p = await planBring(s.base, s.ours, s.theirs, s.text);
    expect(p.kind).toBe("clean");
    if (p.kind !== "clean") return;
    expect([...p.writes.keys()]).toEqual(["/index.html"]);
  });
});
