import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useAgentMemory } from "./len-memory";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
afterEach(() => {
  roots.splice(0).forEach((r) => act(() => r.unmount()));
  vi.unstubAllGlobals();
});

type Memoria = ReturnType<typeof useAgentMemory>;

/** Monta el hook y devuelve una función que lee su último valor. */
async function monta(): Promise<() => Memoria> {
  let ultimo: Memoria | null = null;
  function Sonda() {
    ultimo = useAgentMemory();
    return null;
  }
  const c = document.createElement("div");
  document.body.appendChild(c);
  await act(async () => {
    const root = createRoot(c);
    roots.push(root);
    root.render(<Sonda />);
  });
  return () => ultimo!;
}

const respuesta = (lineas: string[]) => new Response(JSON.stringify({ lineas }), { status: 200 });

describe("useAgentMemory", () => {
  it("reload trae lo que Len guardó DESPUÉS de montar el chat (N30: antes hacía falta recargar)", async () => {
    let enServidor: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async () => respuesta(enServidor)));
    const memoria = await monta();
    expect(memoria().lines).toEqual([]);

    enServidor = ["Prefiere textos cortos"];
    await act(async () => {
      await memoria().reload();
    });
    expect(memoria().lines).toEqual(["Prefiere textos cortos"]);
  });

  it("una respuesta vieja que llega tarde no pisa a la nueva", async () => {
    const pendientes: ((r: Response) => void)[] = [];
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => pendientes.push(resolve))));
    const memoria = await monta();
    // La de montar (0) y dos recargas (1 y 2); llegan al revés.
    let r1!: Promise<void>, r2!: Promise<void>;
    act(() => {
      r1 = memoria().reload();
      r2 = memoria().reload();
    });
    await act(async () => {
      pendientes[2](respuesta(["nueva"]));
      await r2;
      pendientes[1](respuesta(["vieja"]));
      await r1;
      pendientes[0](respuesta(["de montar"]));
    });
    expect(memoria().lines).toEqual(["nueva"]);
  });

  it("si la recarga falla, se queda lo que había: no vacía la lista por un fallo de red", async () => {
    let falla = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        if (falla) throw new TypeError("Failed to fetch");
        return respuesta(["Háblale de tú"]);
      }),
    );
    const memoria = await monta();
    expect(memoria().lines).toEqual(["Háblale de tú"]);
    falla = true;
    await act(async () => {
      await memoria().reload();
    });
    expect(memoria().lines).toEqual(["Háblale de tú"]);
  });
});
