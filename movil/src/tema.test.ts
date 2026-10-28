import { beforeEach, describe, expect, it, vi } from "vitest";
import { aplicarTema, temaGuardado } from "./tema";

const sistema = vi.hoisted(() => ({ nativo: false, setStyle: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@capacitor/core", async (original) => {
  const core = await original<typeof import("@capacitor/core")>();
  return { ...core, Capacitor: { ...core.Capacitor, isNativePlatform: () => sistema.nativo }, SystemBars: { setStyle: sistema.setStyle } };
});

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  sistema.nativo = false;
  sistema.setStyle.mockClear();
});

describe("el tema de la app", () => {
  it("sin nada guardado, naranja (claro), aunque el teléfono esté en oscuro", () => {
    expect(temaGuardado()).toBe("light");
  });

  it("el oscuro elegido a mano se pinta y se recuerda", () => {
    aplicarTema("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(temaGuardado()).toBe("dark");
    aplicarTema("light");
    expect(temaGuardado()).toBe("light");
  });

  it.each([['light', 'LIGHT'], ['dark', 'DARK']] as const)("sincroniza ambas barras con el tema %s de Len", (tema, estilo) => {
    sistema.nativo = true;
    aplicarTema(tema);
    expect(sistema.setStyle).toHaveBeenCalledWith({ style: estilo });
  });

  it("en navegador no intenta cambiar las barras nativas", () => {
    aplicarTema("light");
    expect(sistema.setStyle).not.toHaveBeenCalled();
  });

  it("si el puente nativo falla, conserva el tema de la app", async () => {
    sistema.nativo = true;
    sistema.setStyle.mockRejectedValueOnce(new Error("sin puente"));
    aplicarTema("light");
    await Promise.resolve();
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
