// @vitest-environment node
// `git diff` against the real git.
import { afterEach, describe, expect, it } from "vitest";
import { Pair } from "./test-support/pair";

let pair: Pair;
afterEach(() => pair?.dispose());
async function same(args: readonly string[], cwd?: string): Promise<void> {
  const { real, ours } = await pair.both(args, cwd ? { cwd } : {});
  expect(ours).toEqual(real);
}

const SITE = {
  "index.html": "<html>\n<body>\n<h1>Hola</h1>\n<p>Uno</p>\n</body>\n</html>\n",
  "menu/index.html": "<h1>Menú</h1>\n",
  "src/App.tsx": "export function App() {\n  return null;\n}\n",
  "café.html": "c\n",
};

describe("git diff, against the real git", () => {
  it("working tree against the index: modified and deleted; untracked not shown", async () => {
    pair = new Pair();
    await pair.start(SITE);
    pair.write({ "index.html": SITE["index.html"].replace("Uno", "Dos"), "menu/index.html": null, "new.txt": "n\n", "café.html": "c2\n" });
    for (const args of [["diff"], ["diff", "--stat"], ["diff", "--name-only"], ["diff", "--name-status"], ["diff", "--numstat"], ["diff", "--shortstat"], ["diff", "-U1"], ["diff", "--unified=0"], ["diff", "--exit-code"], ["diff", "--quiet"], ["diff", "HEAD"], ["diff", "--", "index.html"], ["diff", "src"], ["diff", "--stat", "-p"]]) {
      await same(args);
    }
  });

  it("from a subfolder, paths stay repository-relative", async () => {
    pair = new Pair();
    await pair.start(SITE);
    pair.write({ "src/App.tsx": "export function App() {\n  return 1;\n}\n" });
    await same(["diff"], "src");
    await same(["diff", "."], "src");
  });

  it("an unknown option and an unknown revision are git's errors", async () => {
    pair = new Pair();
    await pair.start(SITE);
    // git prints its whole option list after the usage line; ours stops there (spec §4).
    const { real, ours } = await pair.both(["diff", "--frobnicate"]);
    expect(ours.exitCode).toBe(real.exitCode);
    expect(ours.stderr).toBe(real.stderr.split("\n").slice(0, 2).join("\n") + "\n");
    await same(["diff", "nope"]);
    await same(["diff", "nope", "--"]);
  });
});
