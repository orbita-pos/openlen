// UN TURNO PEDIDO CON @Len DESDE UN HILO DEL CÓDIGO, en la charla: se ve lo que
// se escribió, tal cual, con la etiqueta «desde el hilo · fichero:línea» que
// abre ese fichero. El contexto del hilo lo lee sólo Len.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next-intl", () => ({
  useTranslations: () => (clave: string, v?: Record<string, unknown>) => (v ? `${clave} ${JSON.stringify(v)}` : clave),
}));

import { UserMessage } from "./chat-turn";
import { restoreTurn, type DesignTurn } from "./use-agent-chat";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
});

function pintar(turn: DesignTurn, onAbrirOrigen?: (ruta: string) => void) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(<UserMessage turn={turn} initial="A" {...(onAbrirOrigen ? { onAbrirOrigen } : {})} />));
  return host;
}

describe("un turno desde un hilo del código, en la charla", () => {
  it("🔴 lo escrito, tal cual, y la etiqueta del hilo que abre su fichero", () => {
    const abrir = vi.fn();
    const turn = restoreTurn({
      id: "f1",
      userText: "@Len renombra la función a Tienda",
      assistantReasoning: "",
      status: "applied",
      appliedAt: 0,
      origen: { hiloId: "h1", ruta: "/src/App.jsx", linea: 12 },
    });
    const host = pintar(turn, abrir);
    expect(host.textContent).toContain("@Len renombra la función a Tienda");
    const etiqueta = host.querySelector<HTMLButtonElement>("[data-origen-del-turno]")!;
    expect(etiqueta.textContent).toContain('turn.desdeElHilo {"donde":"src/App.jsx:12"}');
    act(() => etiqueta.click());
    expect(abrir).toHaveBeenCalledWith("/src/App.jsx");
  });

  it("un turno del chat no lleva etiqueta", () => {
    const host = pintar({ id: "t", userText: "hola", assistantReasoning: "", status: "applied" } as DesignTurn);
    expect(host.querySelector("[data-origen-del-turno]")).toBeNull();
  });

  it("🔴 la inicial es la de quien pidió el turno (otro del proyecto), no la de quien mira", () => {
    // Quien mira es «A» (`pintar`).
    const turn = restoreTurn({ id: "f2", userText: "hazlo", assistantReasoning: "", status: "applied", appliedAt: 0, autor: "zoe@ejemplo.com" });
    const avatar = pintar(turn).querySelector<HTMLElement>("[data-autor-del-turno]")!;
    expect(avatar.textContent).toBe("Z");
    expect(avatar.getAttribute("title")).toBe("zoe@ejemplo.com");
    expect(pintar({ ...turn, autor: "bruno" }).querySelector("[data-autor-del-turno]")!.textContent).toBe("B");
    // Sin autor (lo acaba de mandar quien mira), la suya.
    expect(pintar({ ...turn, autor: undefined }).querySelector("[data-autor-del-turno]")!.textContent).toBe("A");
  });
});
