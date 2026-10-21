import { describe, expect, it } from "vitest";

import { NEVER_IN_BOX, SYSTEM_TOP_LEVEL, conflictingTopLevel, isSyncedPath } from "./paths";

describe("isSyncedPath", () => {
  it("never syncs system folders, /tmp, node_modules, /.openlen or the bridge", () => {
    for (const p of [
      "/usr/bin/x",
      "/etc/hosts",
      "/tmp/a",
      "/node_modules/react/index.js",
      "/.openlen/docs/apps.md",
      "/run/openlen/requests/1.json",
      "/home/user/.bashrc",
      "/home/other/.len/LEN.md",
    ])
      expect(isSyncedPath(p), p).toBe(false);
  });

  it("syncs the project's files and the person's memory", () => {
    for (const p of ["/index.html", "/src/App.tsx", "/supabase/migrations/1_a.sql", "/LEN.md", "/.len/memory/a.md", "/home/user/.len/LEN.md"])
      expect(isSyncedPath(p), p).toBe(true);
  });

  it("a folder that only starts like a system one is the project's", () => {
    expect(isSyncedPath("/library/index.html")).toBe(true);
    expect(isSyncedPath("/user/index.html")).toBe(true);
  });
});

describe("folders that are never the project's, at any depth", () => {
  it("node_modules, .git and __pycache__ never sync, wherever they are", () => {
    for (const p of ["/scripts/node_modules/sharp/index.js", "/vendor/lib/.git/config", "/tools/__pycache__/x.pyc"]) expect(isSyncedPath(p), p).toBe(false);
    for (const p of ["/scripts/gen.js", "/node-modules-guide.md", "/src/git.ts"]) expect(isSyncedPath(p), p).toBe(true);
  });

  it("a project with files in one of them uses today's terminal", () => {
    expect(conflictingTopLevel(["/index.html", "/vendor/node_modules/a.js"])).toEqual(["/vendor/node_modules/a.js"]);
  });
});

describe("conflictingTopLevel", () => {
  it("a project with a top-level folder named like a system one is not compatible", () => {
    expect(conflictingTopLevel(["/index.html", "/home/index.html", "/media/a.png"])).toEqual(["/home/index.html", "/media/a.png"]);
  });

  it("the person's memory and ordinary folders are fine", () => {
    expect(conflictingTopLevel(["/index.html", "/src/main.tsx", "/home/user/.len/LEN.md"])).toEqual([]);
  });

  it("every system name counts", () => {
    for (const top of SYSTEM_TOP_LEVEL) expect(conflictingTopLevel([`/${top}/x`]), top).toEqual([`/${top}/x`]);
  });
});

describe("NEVER_IN_BOX", () => {
  it("visitor data never goes to the box", () => {
    expect(NEVER_IN_BOX.test("/.openlen/bandeja/formularios.jsonl")).toBe(true);
    expect(NEVER_IN_BOX.test("/.openlen/bandeja")).toBe(true);
    expect(NEVER_IN_BOX.test("/.openlen/resultados/visitas.json")).toBe(true);
    expect(NEVER_IN_BOX.test("/.openlen/docs/apps.md")).toBe(false);
    expect(NEVER_IN_BOX.test("/.openlen/bandejas/x")).toBe(false);
  });
});
