// @vitest-environment jsdom
//
// EL SONDEO DEL CHAT DEL EQUIPO: cada 10 s la firma de la conversación, y sólo
// si cambió se relee. Visto en el ensayo de caja: si el proyecto pasa a ser
// compartido con la pestaña abierta, la primera firma ya traía el mensaje del
// invitado y nunca se releía.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { useSondeoDelEquipo } from "./use-sondeo-del-equipo";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.useRealTimers();
});

type Props = { compartido: boolean; soloConfirmado: boolean };

function montar(leerFirma: () => Promise<string | null>, alCambiar: () => void) {
  const firmaRef = { current: null as string | null };
  function Sonda(p: Props) {
    useSondeoDelEquipo({ ...p, leerFirma, alCambiar, ocupado: () => false, firmaRef });
    return null;
  }
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  return async (p: Props) => {
    await act(async () => root!.render(<Sonda {...p} />));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  };
}

describe("el sondeo del chat del equipo", () => {
  it("🔴 abierto ya compartido: la primera firma es la referencia y sólo un cambio relee", async () => {
    vi.useFakeTimers();
    const firmas = ["f1", "f1", "f2"];
    const leer = vi.fn(async () => firmas.shift() ?? "f2");
    const alCambiar = vi.fn();
    const render = montar(leer, alCambiar);
    await render({ compartido: false, soloConfirmado: false });
    await render({ compartido: true, soloConfirmado: false });
    expect(alCambiar).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(alCambiar).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(alCambiar).toHaveBeenCalledTimes(1);
  });

  it("🔴 era un chat de uno y pasa a compartido con la pestaña abierta: relee en seguida (lo que llegó entre medias)", async () => {
    vi.useFakeTimers();
    const leer = vi.fn(async () => "f-con-el-mensaje-de-eli");
    const alCambiar = vi.fn();
    const render = montar(leer, alCambiar);
    await render({ compartido: false, soloConfirmado: true });
    await render({ compartido: true, soloConfirmado: false });
    expect(alCambiar).toHaveBeenCalledTimes(1);
    // Y luego, como siempre: sin cambios, no relee.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(alCambiar).toHaveBeenCalledTimes(1);
  });

  it("sin compartir no pregunta", async () => {
    vi.useFakeTimers();
    const leer = vi.fn(async () => "f");
    const render = montar(leer, vi.fn());
    await render({ compartido: false, soloConfirmado: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(leer).not.toHaveBeenCalled();
  });
});
