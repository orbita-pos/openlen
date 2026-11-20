// @vitest-environment node
//
// WHO MAY SEE AN MCP TOOL (MCP Apps, SEP-1865): a server marks a tool `_meta.ui.visibility: ["app"]` when only its own UI
// calls it. Len is the MODEL's side, so one rule decides for both the installed tools' operations and the person's
// connectors: hidden iff the field is an array that doesn't name "model" — a typo (`["App"]`) or an empty list fails
// closed, a field that isn't an array (or is absent) leaves the tool visible, as before the standard.
import { describe, expect, it } from "vitest";

import { declaredVisibility, modelMaySee } from "./visibility";

const raw = (visibility: unknown) => ({ name: "t", inputSchema: { type: "object" }, _meta: { ui: { visibility } } });

describe("modelMaySee", () => {
  it("a tool the server says nothing about is visible", () => {
    expect(modelMaySee({ name: "t" })).toBe(true);
    expect(modelMaySee({ name: "t", _meta: {} })).toBe(true);
    expect(modelMaySee({ name: "t", _meta: { ui: {} } })).toBe(true);
    expect(modelMaySee({ name: "t", _meta: null })).toBe(true);
  });

  it("a field that isn't an array leaves it visible", () => {
    expect(modelMaySee(raw("app"))).toBe(true);
    expect(modelMaySee(raw({ 0: "app" }))).toBe(true);
    expect(modelMaySee(raw(null))).toBe(true);
  });

  it("an array that names model is visible", () => {
    expect(modelMaySee(raw(["model"]))).toBe(true);
    expect(modelMaySee(raw(["model", "app"]))).toBe(true);
    expect(modelMaySee(raw(["app", "model"]))).toBe(true);
  });

  it("🔴 an array that doesn't name model is hidden — app-only, empty, a typo, not strings", () => {
    expect(modelMaySee(raw(["app"]))).toBe(false);
    expect(modelMaySee(raw([]))).toBe(false);
    expect(modelMaySee(raw(["App"]))).toBe(false);
    expect(modelMaySee(raw(["Model"]))).toBe(false);
    expect(modelMaySee(raw([1, null]))).toBe(false);
  });

  it("reads the already-normalized `visibility` of a listed or stored tool the same way", () => {
    expect(modelMaySee({ name: "t", visibility: ["app"] })).toBe(false);
    expect(modelMaySee({ name: "t", visibility: [] })).toBe(false);
    expect(modelMaySee({ name: "t", visibility: ["model", "app"] })).toBe(true);
    expect(modelMaySee({ name: "t", visibility: undefined })).toBe(true);
  });

  it("garbage in the place of a tool is not a reason to throw", () => {
    expect(modelMaySee(null)).toBe(true);
    expect(modelMaySee("x")).toBe(true);
  });
});

describe("declaredVisibility", () => {
  it("is the strings the server declared, once each, or undefined when it declared no array", () => {
    expect(declaredVisibility(raw(["app", "app", "model"]))).toEqual(["app", "model"]);
    expect(declaredVisibility(raw([]))).toEqual([]);
    expect(declaredVisibility(raw(["App", 3]))).toEqual(["App"]);
    expect(declaredVisibility(raw("app"))).toBeUndefined();
    expect(declaredVisibility({ name: "t" })).toBeUndefined();
  });
});
