import { describe, expect, it } from "vitest";

import { changesSince } from "./diff";

describe("changesSince — the diff from the published version, like a pull request's", () => {
  it("a changed file comes as git shows it, and is listed", () => {
    const r = changesSince({ "/src/a.ts": "const x = 1;\nconst y = 2;\n" }, { "/src/a.ts": "const x = 1;\nconst y = 3;\n" });
    expect(r.changed).toEqual(["/src/a.ts"]);
    expect(r.diff).toContain("diff --git a/src/a.ts b/src/a.ts");
    expect(r.diff).toContain("-const y = 2;");
    expect(r.diff).toContain("+const y = 3;");
  });

  it("new and deleted files too, and the list is sorted", () => {
    const r = changesSince({ "/z.ts": "adiós\n", "/same.ts": "igual\n" }, { "/a.ts": "hola\n", "/same.ts": "igual\n" });
    expect(r.changed).toEqual(["/a.ts", "/z.ts"]);
    expect(r.diff).toContain("new file mode");
    expect(r.diff).toContain("+hola");
    expect(r.diff).toContain("deleted file mode");
    expect(r.diff).toContain("-adiós");
    expect(r.diff).not.toContain("same.ts");
  });

  it("nothing changed: no files and an empty diff", () => {
    expect(changesSince({ "/a.ts": "x\n" }, { "/a.ts": "x\n" })).toEqual({ changed: [], diff: "" });
  });

  it("a diff too big for the prompt is left out and only the files are listed, as Claude Code does", () => {
    const big = Array.from({ length: 200 }, (_, k) => `line ${k}`).join("\n");
    const r = changesSince({ "/a.ts": "" }, { "/a.ts": big }, 500);
    expect(r).toEqual({ changed: ["/a.ts"], diff: null });
  });
});
