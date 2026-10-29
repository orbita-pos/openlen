// @vitest-environment node
// Branches in OpenLen's git (spec local 2026-10-28-ficheros-al-nivel-de-claude-code, §8), against the real git 2.45.2:
// branch, switch, checkout -b and checkout <branch> say what git says, move the same commits and leave the same
// files; a switch that would overwrite local changes is refused with git's own words.
import { afterEach, describe, expect, it } from "vitest";

import { Pair } from "./test-support/pair";

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

const SITE = { "index.html": "<h1>Hola</h1>\n", "src/App.tsx": "export const App = 1;\n" };

describe("branches, against the real git", () => {
  it("🔴 create, list, switch -c, commit there, switch back: same output, same files, same commits", async () => {
    pair = new Pair();
    await pair.start(SITE);
    await same(["branch"]);
    await same(["branch", "nueva"]);
    await same(["branch"]);
    await same(["branch", "-v"]);
    await same(["switch", "nueva"]);
    await same(["branch", "--show-current"]);
    await same(["rev-parse", "--abbrev-ref", "HEAD"]);
    await same(["status"]);
    pair.tick();
    pair.write({ "index.html": "<h1>Hola desde nueva</h1>\n", "nuevo.txt": "n\n" });
    await same(["add", "-A"]);
    await same(["commit", "-m", "En la rama nueva"]);
    await sameHeads();
    await same(["log", "--oneline", "--decorate", "--all"]);
    await same(["switch", "main"]);
    await sameHeads();
    sameFiles();
    await same(["log", "--oneline", "nueva"]);
    await same(["diff", "main", "nueva", "--stat"]);
    await same(["checkout", "nueva"]);
    sameFiles();
    await same(["switch", "-c", "otra"]);
    await same(["checkout", "-b", "tercera", "main"]);
    sameFiles();
    await same(["branch"]);
  });

  it("🔴 a switch that would overwrite local changes is refused, and nothing moves", async () => {
    pair = new Pair();
    await pair.start(SITE);
    await same(["switch", "-c", "cambio"]);
    pair.tick();
    pair.write({ "index.html": "<h1>en cambio</h1>\n" });
    await same(["commit", "-am", "cambio"]);
    await same(["switch", "main"]);
    pair.write({ "index.html": "<h1>sin guardar</h1>\n" });
    await same(["switch", "cambio"]);
    await same(["checkout", "cambio"]);
    await sameHeads();
    sameFiles();
  });

  it("local changes to a file both branches share go along, as git lists them", async () => {
    pair = new Pair();
    await pair.start(SITE);
    await same(["branch", "otra"]);
    pair.write({ "src/App.tsx": "export const App = 2;\n" });
    await same(["checkout", "otra"]);
    await same(["status", "--short"]);
    sameFiles();
  });

  it("branch -d of an unmerged branch is refused; -D deletes it; the current one can't be deleted", async () => {
    pair = new Pair();
    await pair.start(SITE);
    await same(["switch", "-c", "suelta"]);
    pair.tick();
    pair.write({ "index.html": "<h1>suelta</h1>\n" });
    await same(["commit", "-am", "suelta"]);
    await same(["switch", "main"]);
    await same(["branch", "-d", "suelta"]);
    await same(["branch", "-D", "suelta"]);
    await same(["branch", "otra"]);
    await same(["branch", "-d", "otra"]);
    await same(["branch", "nueva"]);
    await same(["branch", "nueva"]);
    await same(["switch", "noexiste"]);
  });
});
