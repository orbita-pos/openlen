import { describe, expect, it } from "vitest";

import { todayLine } from "./today-line";

describe("la fecha para los prompts", () => {
  it("dice el día en ISO y ata las cifras derivadas a hoy", () => {
    const line = todayLine(new Date("2026-08-19T12:00:00Z"));
    expect(line).toContain("HOY ES 2026-08-19");
    expect(line).toMatch(/años de experiencia/);
    expect(line.endsWith("\n\n")).toBe(true);
  });

  it("usa el día real cuando no se le inyecta uno", () => {
    expect(todayLine()).toContain(`HOY ES ${new Date().toISOString().slice(0, 10)}`);
  });
});
