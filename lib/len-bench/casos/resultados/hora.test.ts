import { describe, expect, it } from "vitest";
import { fechaLocal } from "@/lib/resultados/zona";
import { aLas, haceUnRato } from "./hora";

const MX = "America/Mexico_City";
// 30/09 19:00 en México = 01/10 01:00 UTC: el día de UTC ya cambió.
const AHORA = new Date("2026-10-01T01:00:00Z");

describe("aLas", () => {
  it("ayer a las 12:00 de México es 18:00 UTC (UTC−6), aunque UTC ya vaya un día por delante", () => {
    expect(aLas({ zona: MX, ahora: AHORA }, 1, 12).toISOString()).toBe("2026-09-29T18:00:00.000Z");
  });
  it("hoy a las 00:01 de México", () => {
    expect(aLas({ zona: MX, ahora: AHORA }, 0, 0, 1).toISOString()).toBe("2026-09-30T06:01:00.000Z");
  });
  it("una zona con cambio de hora: Madrid en verano (UTC+2) y en invierno (UTC+1)", () => {
    expect(aLas({ zona: "Europe/Madrid", ahora: new Date("2026-07-15T10:00:00Z") }, 0, 12).toISOString()).toBe("2026-07-15T10:00:00.000Z");
    expect(aLas({ zona: "Europe/Madrid", ahora: new Date("2026-12-15T10:00:00Z") }, 0, 12).toISOString()).toBe("2026-12-15T11:00:00.000Z");
  });
});

describe("haceUnRato", () => {
  it("20 minutos antes, y es HOY en la hora del dueño", () => {
    const r = haceUnRato({ zona: MX, ahora: AHORA });
    expect(r.toISOString()).toBe("2026-10-01T00:40:00.000Z");
    expect(fechaLocal(r, MX)).toBe("2026-09-30");
  });
  it("recién pasada la medianoche no se va a ayer", () => {
    const r = haceUnRato({ zona: MX, ahora: new Date("2026-09-30T06:05:00Z") }); // 00:05 en México
    expect(fechaLocal(r, MX)).toBe("2026-09-30");
  });
});
