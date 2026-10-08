// DESHACER TRAS RECARGAR, como Claude Code: su punto de restauración va en la
// transcripción (`file-history-snapshot`, por mensaje), así que «restaurar el
// código» sigue ahí al reanudar la sesión. Aquí el registro del turno vive en
// el servidor (`projectTurnChanges`): la fila lo dice al cargarse (`deshacible`)
// y el turno recargado ofrece el Deshacer del servidor, no sólo la pestaña que
// lo vio en directo. Visto en el ensayo de caja (08/10): una app nueva o un
// turno pedido desde un hilo, recargados, se quedaban sin botón.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next-intl", () => ({
  useTranslations: () => (clave: string) => clave,
  useLocale: () => "es",
}));

import { TurnClose } from "./turn-close";
import { restoreTurn, type DesignTurn } from "./use-agent-chat";
import { planDeUndo } from "../panels/undo-turn";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
});

const guardado = (deshacible: boolean) =>
  restoreTurn({
    id: "turno-app",
    userText: "hazme un punto de venta",
    assistantReasoning: "Hecho.",
    status: "applied",
    appliedAt: 0,
    ...(deshacible ? { deshacible: true as const } : {}),
  });

function pintar(turn: DesignTurn, onUndo?: (t: DesignTurn) => void) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() =>
    root.render(
      <TurnClose
        turn={turn}
        currentPage={null}
        vote={undefined}
        {...(onUndo ? { onUndo } : {})}
        onRetry={() => {}}
        onRate={async () => true}
        onClearRate={async () => true}
      />,
    ),
  );
  return host;
}

const botonDeshacer = (host: HTMLElement) => [...host.querySelectorAll("button")].find((b) => b.textContent === "applied.undo");

describe("deshacer un turno tras recargar", () => {
  it("🔴 la fila con registro en el servidor vuelve con el Deshacer del servidor", () => {
    const turn = guardado(true);
    expect(turn.deshacerEnServidor).toBe("turno-app");
    expect(planDeUndo(turn, null).kind).toBe("servidor");
    expect(botonDeshacer(pintar(turn, () => {}))).toBeDefined();
  });

  it("sin registro (o ya deshecho), como antes: sin botón si no hay plan local", () => {
    const turn = guardado(false);
    expect(turn.deshacerEnServidor).toBeUndefined();
    expect(botonDeshacer(pintar(turn, () => {}))).toBeUndefined();
  });

  it("🔴 quien sólo mira (un lector) no recibe `onUndo`: no hay botón aunque se pueda deshacer", () => {
    expect(botonDeshacer(pintar(guardado(true)))).toBeUndefined();
  });
});
