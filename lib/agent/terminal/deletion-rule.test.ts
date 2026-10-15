// @vitest-environment node
import { describe, expect, it } from "vitest";
import { SITE_FILE_REFUSAL, deletionRefusal } from "./deletion-rule";

describe("what the terminal can delete, and why not", () => {
  it("a memory note and a folder file can go", () => {
    expect(deletionRefusal("/.len/memory/la-direccion.md")).toBeNull();
    expect(deletionRefusal("/src/App.tsx")).toBeNull();
    expect(deletionRefusal("/js/main.js")).toBeNull();
  });
  it("a page cannot: the person removes it in the editor", () => {
    expect(deletionRefusal("/index.html")).toBe(SITE_FILE_REFUSAL);
    expect(deletionRefusal("/menu/index.html")).toBe(SITE_FILE_REFUSAL);
  });
  it("the memory files that are not notes cannot, each with its reason", () => {
    expect(deletionRefusal("/LEN.md")).toBe("write it empty to clear it.");
    expect(deletionRefusal("/.len/memory/MEMORY.md")).toBe("/.len/memory/MEMORY.md is generated from the notes.");
  });
});
