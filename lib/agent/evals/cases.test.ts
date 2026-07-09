// Shape-only unit test for the eval battery (F3 T6). NO Gemini, NO DB — this
// validates the static contract of EVAL_CASES + coverage so a malformed case
// (dup id, empty prompt, uncovered tool) fails fast in CI-adjacent `vitest run`
// long before anyone spends credits on the real runner.
import { describe, expect, it } from "vitest";
import { EVAL_CASES, coverage } from "./cases";
import { buildFunctionDeclarations } from "@/lib/agent/catalog";

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

describe("EVAL_CASES shape", () => {
  it("has at least 35 cases", () => {
    expect(EVAL_CASES.length).toBeGreaterThanOrEqual(35);
  });

  it("every id is unique and kebab-case", () => {
    const ids = EVAL_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id, id).toMatch(KEBAB);
  });

  it("every prompt is a non-empty Spanish string", () => {
    for (const c of EVAL_CASES) {
      expect(typeof c.prompt, c.id).toBe("string");
      expect(c.prompt.trim().length, c.id).toBeGreaterThan(0);
    }
  });

  it("every case has an assert function and (if present) a function setup", () => {
    for (const c of EVAL_CASES) {
      expect(typeof c.assert, c.id).toBe("function");
      if (c.setup !== undefined) expect(typeof c.setup, c.id).toBe("function");
    }
  });

  it("costly flag, where set, is exactly the paid image-edit case", () => {
    const costly = EVAL_CASES.filter((c) => c.costly).map((c) => c.id);
    expect(costly).toEqual(["editar-imagen-fondo"]);
  });
});

describe("coverage map", () => {
  it("has one entry per case id, and no stray ids", () => {
    const caseIds = new Set(EVAL_CASES.map((c) => c.id));
    const covIds = new Set(Object.keys(coverage));
    for (const c of EVAL_CASES) expect(covIds.has(c.id), `falta coverage para ${c.id}`).toBe(true);
    for (const id of covIds) expect(caseIds.has(id), `coverage sobra para ${id}`).toBe(true);
  });

  it("covers all 15 catalog tools across the battery", () => {
    const toolNames = buildFunctionDeclarations().map((d) => d.name as string);
    expect(toolNames.length).toBe(15);
    const covered = new Set<string>(Object.values(coverage).flat());
    for (const tool of toolNames) {
      expect(covered.has(tool), `ninguna caso cubre "${tool}"`).toBe(true);
    }
  });

  it("only references real catalog tool names", () => {
    const toolNames = new Set(buildFunctionDeclarations().map((d) => d.name as string));
    for (const [id, tools] of Object.entries(coverage)) {
      for (const t of tools) expect(toolNames.has(t), `${id}: tool inexistente "${t}"`).toBe(true);
    }
  });
});
