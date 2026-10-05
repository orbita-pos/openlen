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

// LA CARPETA (pieza 9 de Len 2.5): el mismo documento con otro `js/app.js` es
// otra página. La carpeta forma parte de la clave, y llega al medidor.
describe("una medida por documento Y su carpeta", () => {
  const carpeta = (app: string) => ({ carpeta: { files: { "/js/app.js": app }, pagina: null } });

  it("🔴 la carpeta llega al medidor; otro fichero son dos medidas", async () => {
    const vistas: unknown[] = [];
    const m = medirUnaVezPorDocumento(async (_html: string, _i?: unknown, opts?: unknown) => {
      vistas.push(opts);
      return { ok: true };
    });
    await m.medir("<html>a</html>", {}, carpeta("1"));
    await m.medir("<html>a</html>", {}, carpeta("2"));
    await m.medir("<html>a</html>", {}, carpeta("2"));
    expect(vistas).toEqual([carpeta("1"), carpeta("2")]);
    expect(m.reusos()).toBe(1);
  });

  it("BRAZO DE CONTROL: sin carpeta se llama como siempre, con el documento solo", async () => {
    const llamadas: unknown[][] = [];
    const m = medirUnaVezPorDocumento(async (...args: unknown[]) => {
      llamadas.push(args);
      return { ok: true };
    });
    await m.medir("<html>a</html>");
    await m.medir("<html>a</html>", {}, carpeta("1"));
    expect(llamadas).toEqual([["<html>a</html>"], ["<html>a</html>", {}, carpeta("1")]]);
  });
});
