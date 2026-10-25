// @vitest-environment node
import { describe, expect, it } from "vitest";
import { HOME_PAGE_REFUSAL, SITE_FILE_REFUSAL, deletionRefusal } from "./deletion-rule";

describe("what the terminal can delete, and why not", () => {
  it("a memory note, a folder file and a page other than the home can go, like `rm` in Claude Code", () => {
    expect(deletionRefusal("/.len/memory/la-direccion.md")).toBeNull();
    expect(deletionRefusal("/src/App.tsx")).toBeNull();
    expect(deletionRefusal("/js/main.js")).toBeNull();
    expect(deletionRefusal("/menu/index.html")).toBeNull();
  });
  it("the home page cannot: a site always has one", () => {
    expect(deletionRefusal("/index.html")).toBe(HOME_PAGE_REFUSAL);
  });
  it("a file of the site that is neither a page nor the folder's cannot", () => {
    expect(deletionRefusal("/ajustes/proyecto.json")).toBe(SITE_FILE_REFUSAL);
  });
  it("the memory files that are not notes cannot, each with its reason", () => {
    expect(deletionRefusal("/LEN.md")).toBe("write it empty to clear it.");
    expect(deletionRefusal("/.len/memory/MEMORY.md")).toBe("/.len/memory/MEMORY.md is generated from the notes.");
  });
});
