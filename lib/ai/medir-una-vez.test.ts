import { describe, expect, it } from "vitest";
import { medirUnaVezPorDocumento } from "./medir-una-vez";

describe("una medida por documento", () => {
  it("🔴 el mismo documento se mide UNA vez — que es el ahorro entero", async () => {
    let veces = 0;
    const m = medirUnaVezPorDocumento(async () => {
      veces += 1;
      return { ok: true };
    });
    await m.medir("<html>a</html>");
    await m.medir("<html>a</html>");
    expect(veces).toBe(1);
    expect(m.reusos()).toBe(1);
  });

  it("CONTRA-PRUEBA: un byte de diferencia son dos documentos y dos medidas", async () => {
    let veces = 0;
    const m = medirUnaVezPorDocumento(async () => {
      veces += 1;
      return { ok: true };
    });
    await m.medir("<html>a</html>");
    await m.medir("<html>b</html>");
    expect(veces).toBe(2);
    expect(m.reusos()).toBe(0);
  });

  it("dos llamadas A LA VEZ comparten el render — es el caso de los ojos", async () => {
    let veces = 0;
    const m = medirUnaVezPorDocumento(async () => {
      veces += 1;
      await new Promise((r) => setTimeout(r, 5));
      return { ok: true };
    });
    // Las dos salen ANTES de que la primera resuelva: es lo que pasa cuando los
    // ojos miden en paralelo con la foto.
    const a = m.medir("<html>x</html>");
    const b = m.medir("<html>x</html>");
    expect(await a).toBe(await b);
    expect(veces).toBe(1);
    expect(m.reusos()).toBe(1);
  });

  it("🔴 el FALLO no se cachea: un Chromium que tropieza no deja el turno ciego", async () => {
    let veces = 0;
    const m = medirUnaVezPorDocumento(async () => {
      veces += 1;
      return veces === 1 ? null : { ok: true };
    });
    expect(await m.medir("<html>y</html>")).toBeNull();
    expect(await m.medir("<html>y</html>")).toEqual({ ok: true });
    expect(veces).toBe(2);
  });

  it("un throw tampoco se cachea, y sale como lo tiró el medidor", async () => {
    let veces = 0;
    const m = medirUnaVezPorDocumento(async () => {
      veces += 1;
      if (veces === 1) throw new Error("chrome caído");
      return { ok: true };
    });
    await expect(m.medir("<html>z</html>")).rejects.toThrow("chrome caído");
    expect(await m.medir("<html>z</html>")).toEqual({ ok: true });
    expect(veces).toBe(2);
  });
});
