// @vitest-environment node
// A revert that would delete a file the terminal cannot delete (a page) is refused whole: otherwise
// the history would say the page is gone while the project keeps it (a deliberate difference).
import { describe, expect, it } from "vitest";
import { memoryStore } from "./memory-store";
import { runGit } from "./run";
import { AUTHOR, START } from "./test-support/real-git";

const PAGE_RULE = (path: string) => (path.endsWith(".html") ? "the terminal cannot delete files of the site (a page is removed by the user, in the editor)." : null);

describe("revert and the files the terminal cannot delete", () => {
  it("refuses, says why, and changes nothing", async () => {
    const store = memoryStore();
    let files: Record<string, string> = { "/index.html": "<h1>Home</h1>\n" };
    let clock = START;
    const git = async (args: string[]) => {
      const r = await runGit({ store, files, cwd: "/", identity: AUTHOR, owner: AUTHOR, now: () => new Date(clock * 1000), undeletable: PAGE_RULE }, args);
      for (const [p, c] of Object.entries(r.write ?? {})) {
        if (c === null) delete files[p];
        else files = { ...files, [p]: c };
      }
      return r;
    };
    await git(["status"]);
    clock += 60;
    files = { ...files, "/menu/index.html": "<h1>Menu</h1>\n" };
    await git(["add", "menu/index.html"]);
    await git(["commit", "-m", "Add the menu page"]);
    clock += 60;
    files = { ...files, "/style.css": "body{}\n" };
    await git(["add", "style.css"]);
    await git(["commit", "-m", "Add a stylesheet"]);
    const headBefore = (await store.readRepo())!.head;

    const r = await git(["revert", "--no-edit", "HEAD~1"]);

    expect(r.exitCode).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/^error: could not revert [0-9a-f]{7}\.\.\. Add the menu page\n/);
    expect(r.stderr).toContain("Nothing was changed: reverting it would delete menu/index.html, and the terminal cannot delete files of the site (a page is removed by the user, in the editor).");
    expect(r.write).toBeUndefined();
    expect((await store.readRepo())!.head).toBe(headBefore);
    expect(files["/menu/index.html"]).toBe("<h1>Menu</h1>\n");
  });

  it("a deletion the terminal can do goes ahead as git would", async () => {
    const store = memoryStore();
    let files: Record<string, string> = { "/index.html": "<h1>Home</h1>\n" };
    const run = (args: string[]) => runGit({ store, files, cwd: "/", identity: AUTHOR, owner: AUTHOR, now: () => new Date(START * 1000), undeletable: PAGE_RULE }, args);
    await run(["status"]);
    files = { ...files, "/style.css": "body{}\n" };
    await run(["add", "style.css"]);
    await run(["commit", "-m", "Add a stylesheet"]);
    const r = await run(["revert", "--no-edit", "HEAD"]);
    expect(r.exitCode).toBe(0);
    expect(r.write).toEqual({ "/style.css": null });
  });
});
