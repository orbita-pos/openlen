import { describe, expect, it, vi } from "vitest";
import { crearEntrada, type DepsDeEntrada } from "./entrada";

const ESTADO = "e".repeat(32);

function deps(over: Partial<DepsDeEntrada> = {}): DepsDeEntrada {
  let recordado: string | null = null;
  return {
    base: "http://localhost:3007",
    idioma: "es",
    enWeb: false,
    abrir: vi.fn().mockResolvedValue(undefined),
    aleatorio: () => ESTADO,
    recordar: { leer: () => recordado, guardar: (v) => { recordado = v; } },
    canjear: vi.fn().mockResolvedValue("LLAVE"),
    guardarLlave: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

describe("entrar desde la app", () => {
  it("empezar abre el navegador en /movil/entrar con un estado nuevo", async () => {
    const d = deps();
    await crearEntrada(d).empezar();
    expect(d.abrir).toHaveBeenCalledWith(`http://localhost:3007/es/movil/entrar?estado=${ESTADO}&retorno=app`);
    expect(d.recordar.leer()).toBe(ESTADO);
  });

  it("en el navegador de la PC pide volver a Vite (retorno=dev)", async () => {
    const d = deps({ enWeb: true });
    await crearEntrada(d).empezar();
    expect(d.abrir).toHaveBeenCalledWith(expect.stringContaining("&retorno=dev"));
  });

  it("al volver con su estado, canjea y guarda la llave; el estado se olvida", async () => {
    const d = deps();
    const e = crearEntrada(d);
    await e.empezar();
    expect(await e.alVolver(`openlen://entrar?codigo=C0D&estado=${ESTADO}`)).toBe("ok");
    expect(d.canjear).toHaveBeenCalledWith("C0D", ESTADO);
    expect(d.guardarLlave).toHaveBeenCalledWith("LLAVE");
    expect(d.recordar.leer()).toBeNull();
  });

  it("un regreso con OTRO estado se ignora: nadie te cuela una sesión", async () => {
    const d = deps();
    const e = crearEntrada(d);
    await e.empezar();
    expect(await e.alVolver("openlen://entrar?codigo=C0D&estado=otro-estado-0123456789")).toBe("ignorado");
    expect(d.canjear).not.toHaveBeenCalled();
  });

  it("sin haber empezado, cualquier regreso se ignora", async () => {
    const d = deps();
    expect(await crearEntrada(d).alVolver(`openlen://entrar?codigo=C0D&estado=${ESTADO}`)).toBe("ignorado");
  });

  it("un código que el servidor no acepta → caducado", async () => {
    const d = deps({ canjear: vi.fn().mockResolvedValue(null) });
    const e = crearEntrada(d);
    await e.empezar();
    expect(await e.alVolver(`openlen://entrar?codigo=C0D&estado=${ESTADO}`)).toBe("caducado");
    expect(d.guardarLlave).not.toHaveBeenCalled();
  });
});
