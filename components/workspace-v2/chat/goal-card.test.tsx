// LA TARJETA DEL ENCARGO (pieza 8): encima del compositor, dice en qué ronda va,
// si sigue solo, está en pausa o se atascó (y por qué), con «Reanudar» y
// «Quitar» cuando Len no está trabajando.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next-intl", () => ({
  useTranslations: () => (clave: string, v?: Record<string, unknown>) => (v ? `${clave} ${JSON.stringify(v)}` : clave),
}));

import { GoalCardView } from "./goal-card";
import type { GoalView } from "./goal-state";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
});

const encargo = (o: Partial<GoalView> = {}): GoalView => ({
  id: "goal-1",
  revision: 2,
  objective: "la tienda entera",
  phase: "active",
  maxGoalRounds: 256,
  roundsStarted: 3,
  activation: "armed",
  ...o,
});

function montar(props: Partial<Parameters<typeof GoalCardView>[0]> = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  const onResume = vi.fn();
  const onClear = vi.fn();
  act(() =>
    root.render(<GoalCardView goal={encargo()} busy={false} stoppedForCredits={false} onResume={onResume} onClear={onClear} {...props} />),
  );
  return { host, onResume, onClear };
}
const boton = (host: HTMLElement, clave: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === clave) as HTMLButtonElement | undefined;

describe("la tarjeta del encargo", () => {
  it("sin encargo, o completo, no se pinta", () => {
    expect(montar({ goal: null }).host.textContent).toBe("");
    expect(montar({ goal: encargo({ phase: "complete" }) }).host.textContent).toBe("");
  });

  it("en marcha: el objetivo, la ronda y su estado; sin botones", () => {
    const { host } = montar();
    expect(host.textContent).toContain("la tienda entera");
    expect(host.textContent).toContain('newChat.goal.round {"round":3,"max":256}');
    expect(host.textContent).toContain("newChat.goal.running");
    expect(boton(host, "newChat.goal.resume")).toBeUndefined();
    expect(boton(host, "newChat.goal.clear")).toBeUndefined();
  });

  it("en pausa: «Reanudar» y «Quitar», cada uno con lo suyo", () => {
    const { host, onResume, onClear } = montar({ goal: encargo({ phase: "paused", activation: "disarmed" }) });
    expect(host.textContent).toContain("newChat.goal.paused");
    act(() => boton(host, "newChat.goal.resume")!.click());
    act(() => boton(host, "newChat.goal.clear")!.click());
    expect(onResume).toHaveBeenCalledTimes(1);
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("mientras Len trabaja (otro turno), los botones no se pulsan", () => {
    const { host } = montar({ goal: encargo({ phase: "paused", activation: "disarmed" }), busy: true });
    expect(boton(host, "newChat.goal.resume")?.disabled).toBe(true);
    expect(boton(host, "newChat.goal.clear")?.disabled).toBe(true);
  });

  it("atascado: con el motivo de Len; al tope de rondas lo dice y no se reanuda", () => {
    const motivo = montar({
      goal: encargo({ phase: "blocked", activation: "disarmed", blockedReason: { code: "model-reported", message: "faltan las fotos" } }),
    });
    expect(motivo.host.textContent).toContain("newChat.goal.blocked");
    expect(motivo.host.textContent).toContain("faltan las fotos");
    const tope = montar({
      goal: encargo({
        phase: "blocked",
        activation: "disarmed",
        roundsStarted: 256,
        blockedReason: { code: "round-limit", message: "Goal reached its configured limit of 256 rounds." },
      }),
    });
    expect(tope.host.textContent).toContain('newChat.goal.roundLimit {"max":256}');
    expect(tope.host.textContent).not.toContain("Goal reached");
    expect(boton(tope.host, "newChat.goal.resume")).toBeUndefined();
  });

  it("parado por el saldo: lo dice", () => {
    const { host } = montar({ goal: encargo({ activation: "disarmed" }), stoppedForCredits: true });
    expect(host.textContent).toContain("newChat.goal.noCredits");
  });
});
