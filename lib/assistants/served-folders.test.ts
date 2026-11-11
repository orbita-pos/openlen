// WHERE SHE READS EACH PROJECT SHE SERVES (spec local 2026-11-06-asistente-propio, §8, phase 4B): one folder per
// project under ~/.assistant/projects, as Claude Code lists its additional working directories.
import { describe, expect, it } from "vitest";

import { SERVED_FOLDERS, servedFolderAt, servedFolderOf } from "./served-folders";

const S = [{ id: "p1" }, { id: "p2" }];

describe("her projects' folders", () => {
  it("each project has its folder under ~/.assistant/projects", () => {
    expect(SERVED_FOLDERS).toBe("~/.assistant/projects");
    expect(servedFolderOf("p2")).toBe("~/.assistant/projects/p2");
  });

  it("a path in one of her projects' folders names the project and its folder", () => {
    const hit = { kind: "project", projectId: "p2", prefix: "/home/user/.assistant/projects/p2" };
    expect(servedFolderAt("~/.assistant/projects/p2/envios/index.html", S)).toEqual(hit);
    expect(servedFolderAt("/home/user/.assistant/projects/p2", S)).toEqual(hit);
  });

  it("the folder of all her projects is the parent", () => {
    expect(servedFolderAt("~/.assistant/projects", S)).toEqual({ kind: "parent" });
    expect(servedFolderAt("~/.assistant/projects/", S)).toEqual({ kind: "parent" });
  });

  it("🔴 a project she doesn't serve is unknown", () => {
    expect(servedFolderAt("~/.assistant/projects/p9/index.html", S)).toEqual({ kind: "unknown", asked: "~/.assistant/projects/p9/index.html" });
  });

  it("anything else isn't hers to route", () => {
    expect(servedFolderAt("~/.assistant/projects/../MEMORY.md", S)).toBeNull();
    expect(servedFolderAt("/index.html", S)).toBeNull();
    expect(servedFolderAt("~/.assistant/projectsX/a", S)).toBeNull();
  });
});
