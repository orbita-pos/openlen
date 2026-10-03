import { describe, expect, it } from "vitest";

import { todayLine } from "./today-line";

describe("la fecha para los prompts", () => {
  it("dice el día en ISO y ata las cifras derivadas a hoy", () => {
    const line = todayLine(new Date("2026-08-19T12:00:00Z"));
    expect(line).toContain("TODAY IS 2026-08-19");
    expect(line).toMatch(/years of experience/);
    expect(line.endsWith("\n\n")).toBe(true);
  });

  it("usa el día real cuando no se le inyecta uno", () => {
    expect(todayLine()).toContain(`TODAY IS ${new Date().toISOString().slice(0, 10)}`);
  });

  // MEDIDO el 30/09 (corridas/2026-10-01-resultados-humo): a las 19:25 de
  // México, «HOY ES» decía el 1 de octubre (UTC) y Len llamó «ayer» a un
  // mensaje de ese mismo día. Con la zona del usuario, el día es el suyo.
  it("con la zona del usuario, el día es el SUYO, no el de UTC", () => {
    const a = new Date("2026-10-01T01:25:00Z"); // 30/09 19:25 en Ciudad de México
    expect(todayLine(a, "America/Mexico_City")).toContain("TODAY IS 2026-09-30");
    expect(todayLine(a)).toContain("TODAY IS 2026-10-01");
  });
});
