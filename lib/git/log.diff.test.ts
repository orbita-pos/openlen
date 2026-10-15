// @vitest-environment node
// log and show against the real git, over a small history.
import { afterEach, describe, expect, it } from "vitest";
import { Pair } from "./test-support/pair";

let pair: Pair;
afterEach(() => pair?.dispose());
async function same(args: readonly string[], cwd?: string): Promise<void> {
  const { real, ours } = await pair.both(args, cwd ? { cwd } : {});
  expect(ours).toEqual(real);
}

async function history(): Promise<void> {
  pair = new Pair();
  await pair.start({ "index.html": "<h1>Hola</h1>\n", "src/App.tsx": "export function App() {\n  return 1;\n}\n" });
  const steps: [Record<string, string | null>, string][] = [
    [{ "index.html": "<h1>Hola!</h1>\n" }, "Make the title louder"],
    [{ "src/Cart.tsx": "export const Cart = 1;\n" }, "Add the cart so customers can order\n\nIt keeps the items in memory.\n\nCo-Authored-By: Len <noreply@openlen.com>"],
    [{ "index.html": null, "home/index.html": "<h1>Hola!</h1>\n" }, "Move the home page"],
  ];
  for (const [files, message] of steps) {
    pair.tick(3600);
    pair.write(files);
    await pair.both(["add", "-A"]);
    await pair.both(["commit", "-q", "-m", message]);
  }
}

describe("git log and git show, against the real git", () => {
  it("formats", async () => {
    await history();
    for (const args of [
      ["log"],
      ["log", "--oneline"],
      ["log", "-n", "2"],
      ["log", "-2", "--oneline"],
      ["log", "--reverse", "--oneline"],
      ["log", "--pretty=short"],
      ["log", "--pretty=full"],
      ["log", "--pretty=fuller"],
      ["log", "--pretty=oneline"],
      ["log", "--format=%h %an <%ae> %ad %s"],
      ["log", "--format=%H%n%b%n--"],
      ["log", "--pretty=format:%h %s"],
      ["log", "--date=iso", "-1"],
      ["log", "--date=short", "--format=%ad %s"],
      ["log", "--abbrev-commit", "-1"],
      ["log", "--decorate", "--oneline"],
      ["log", "--graph", "--oneline"],
      ["log", "--graph", "-2"],
    ]) await same(args);
  });

  it("with changes: -p, --stat, --name-only, --name-status", async () => {
    await history();
    for (const args of [["log", "-p"], ["log", "--stat"], ["log", "--name-only"], ["log", "--name-status"], ["log", "--oneline", "-p"], ["log", "--oneline", "--stat"], ["log", "--format=%s", "--stat"], ["log", "-p", "-1", "-U1"]]) {
      await same(args);
    }
  });

  it("filters: a path, --author, --grep, a range", async () => {
    await history();
    for (const args of [["log", "--oneline", "--", "src"], ["log", "--oneline", "src/Cart.tsx"], ["log", "-p", "--", "index.html"], ["log", "--oneline", "--author=Ana"], ["log", "--oneline", "--grep=cart"], ["log", "--oneline", "HEAD~2..HEAD"], ["log", "--oneline", "HEAD~1"]]) {
      await same(args);
    }
    await same(["log", "--oneline"], "src");
    await same(["log", "nope"]);
  });

  it("relative dates (against the real clock)", async () => {
    pair = new Pair();
    const now = Math.floor(Date.now() / 1000);
    pair.real.timestamp = now - 3 * 3600;
    pair.ours.timestamp = now - 3 * 3600;
    await pair.start({ "a.txt": "a\n" });
    pair.ours.timestamp = Math.floor(Date.now() / 1000);
    await same(["log", "--format=%ar"]);
    await same(["log", "--date=relative", "-1"]);
  });

  it("show: a commit, a file at a commit, errors", async () => {
    await history();
    for (const args of [["show"], ["show", "HEAD~1"], ["show", "--stat", "HEAD~1"], ["show", "-s", "HEAD~2"], ["show", "--name-only"], ["show", "--format=%s", "-s"], ["show", "HEAD~1:src/Cart.tsx"], ["show", "HEAD:src"], ["show", "HEAD~3"], ["show", "HEAD:nope.txt"], ["show", "nope:index.html"]]) {
      await same(args);
    }
    await same(["show", "HEAD:./Cart.tsx"], "src");
  });
});
