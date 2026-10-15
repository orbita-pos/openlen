// @vitest-environment node
import { describe, expect, it } from "vitest";
import { matchesPathspec, quotePath, relativeToCwd, repoDir, resolveFromCwd } from "./paths";

describe("paths", () => {
  it("the terminal's cwd as a repository directory", () => {
    expect(repoDir("/")).toBe("");
    expect(repoDir("/src/")).toBe("src");
    expect(repoDir("/src/components")).toBe("src/components");
  });
  it("what the user typed, from the cwd", () => {
    expect(resolveFromCwd("", ".")).toBe("");
    expect(resolveFromCwd("src", ".")).toBe("src");
    expect(resolveFromCwd("src", "App.tsx")).toBe("src/App.tsx");
    expect(resolveFromCwd("src", "../index.html")).toBe("index.html");
    expect(resolveFromCwd("src", "/menu/index.html")).toBe("menu/index.html");
  });
  it("printed relative to the cwd, a folder keeps its slash", () => {
    expect(relativeToCwd("src", "index.html")).toBe("../index.html");
    expect(relativeToCwd("src", "src/App.tsx")).toBe("App.tsx");
    expect(relativeToCwd("", "src/new/")).toBe("src/new/");
    expect(relativeToCwd("src/new", "src/new/")).toBe("./");
  });
  it("quotes like core.quotepath=true", () => {
    expect(quotePath("index.html")).toBe("index.html");
    expect(quotePath("mi página/index.html")).toBe('"mi p\\303\\241gina/index.html"');
    expect(quotePath("con espacio.html")).toBe("con espacio.html");
    expect(quotePath('a"b')).toBe('"a\\"b"');
  });
  it("pathspecs: a file, a folder, a glob (where * crosses /)", () => {
    expect(matchesPathspec("", "src/App.tsx")).toBe(true);
    expect(matchesPathspec("src", "src/App.tsx")).toBe(true);
    expect(matchesPathspec("src", "srcx/App.tsx")).toBe(false);
    expect(matchesPathspec("*.tsx", "src/App.tsx")).toBe(true);
    expect(matchesPathspec("src/*.html", "src/a/b.html")).toBe(true);
    expect(matchesPathspec("index.html", "menu/index.html")).toBe(false);
  });
});
