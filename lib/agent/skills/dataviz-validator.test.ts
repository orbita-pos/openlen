/**
 * The palette validator of the `dataviz` skill (spec local 2026-10-27-len-five-skills, §4.3): our own,
 * because Claude's has no open license. It runs in Len's terminal with Node, so it is plain JavaScript
 * and is tested here as it is served.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { validatePalette } from "./bundled/dataviz/scripts/validate_palette.mjs";

const SCRIPT = path.join(__dirname, "bundled/dataviz/scripts/validate_palette.mjs");

const check = (r: ReturnType<typeof validatePalette>, name: string) => {
  const c = r.checks.find((x) => x.name === name);
  if (!c) throw new Error(`no check named ${name}: ${r.checks.map((x) => x.name).join(", ")}`);
  return c;
};

describe("validate_palette.mjs", () => {
  // Okabe–Ito, made for color blindness. Not matplotlib's tab10: its orange and green are almost the
  // same color for a protanope (ΔE 0.7), and the validator says so.
  it("a well-spaced palette passes", () => {
    const r = validatePalette(["#0072b2", "#e69f00", "#009e73", "#cc79a7"], { mode: "light" });
    expect(r.checks.filter((c) => c.status === "FAIL")).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("two near-identical colors fail for everyone", () => {
    const r = validatePalette(["#1f77b4", "#2077b5"], { mode: "light" });
    expect(check(r, "normal vision").status).toBe("FAIL");
    expect(r.ok).toBe(false);
  });

  it("a red–green pair fails for deuteranopia", () => {
    const r = validatePalette(["#d62728", "#2ca02c"], { mode: "light" });
    expect(["WARN", "FAIL"]).toContain(check(r, "deuteranopia").status);
  });

  it("low contrast on the surface warns", () => {
    expect(check(validatePalette(["#f5f5f5"], { mode: "light" }), "contrast").status).toBe("WARN");
  });

  it("the CLI prints a table and exits 1 on FAIL", () => {
    const run = spawnSync("node", [SCRIPT, "#1f77b4,#2077b5"], { encoding: "utf8" });
    expect(run.status).toBe(1);
    expect(run.stdout).toContain("FAIL");
  });
});
