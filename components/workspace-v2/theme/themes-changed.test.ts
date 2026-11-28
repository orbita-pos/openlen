// @vitest-environment node
import { describe, expect, it } from "vitest";

import { SET_THEME } from "@/lib/agent/theme-tools";

import { themesChangedBy } from "./themes-changed";

describe("themesChangedBy", () => {
  it("a set_theme or a publish that went through changes what the workspace paints", () => {
    expect(SET_THEME).toBe("set_theme");
    expect(themesChangedBy("set_theme", "done")).toBe(true);
    expect(themesChangedBy("publish", "done")).toBe(true);
    expect(themesChangedBy("publish", "warning")).toBe(true);
  });

  it("one that failed, or is still running, changes nothing", () => {
    for (const status of ["error", "running"]) {
      expect(themesChangedBy("set_theme", status)).toBe(false);
      expect(themesChangedBy("publish", status)).toBe(false);
    }
  });

  it("any other tool changes nothing", () => {
    expect(themesChangedBy("Write", "done")).toBe(false);
    expect(themesChangedBy("view_page", "done")).toBe(false);
  });
});
