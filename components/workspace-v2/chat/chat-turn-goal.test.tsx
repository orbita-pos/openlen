// LAS RONDAS DEL ENCARGO EN LA CHARLA (pieza 8): el mensaje de ronda de DeepSeek
// queda en la conversación (lo lee el modelo), pero el dueño no lo escribió: la
// ronda 1 se pinta con SU objetivo y las siguientes como una línea.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next-intl", () => ({
  useTranslations: () => (clave: string, v?: Record<string, unknown>) => (v ? `${clave} ${JSON.stringify(v)}` : clave),
}));

import { goalRoundPrompt } from "@/lib/agent/goal";
import { UserMessage } from "./chat-turn";
import type { DesignTurn } from "./use-agent-chat";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
});

function pintar(userText: string) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  const turn = { id: "t", userText, assistantReasoning: "", status: "applied" } as DesignTurn;
  act(() => root.render(<UserMessage turn={turn} initial="J" />));
  return host;
}
const meta = { objective: "Hazme la tienda entera", maxGoalRounds: 256 };

describe("las rondas del encargo en la charla", () => {
  it("la ronda 1 es el mensaje del dueño: su objetivo, con la marca del encargo", () => {
    const host = pintar(goalRoundPrompt(meta, 1));
    expect(host.textContent).toContain("Hazme la tienda entera");
    expect(host.textContent).toContain("newChat.goal.label");
    expect(host.textContent).not.toContain("<goal_round>");
  });

  it("las siguientes son una línea, sin burbuja, con su número", () => {
    const host = pintar(goalRoundPrompt(meta, 3));
    expect(host.textContent).toContain('newChat.goal.roundLine {"round":3,"max":256}');
    expect(host.textContent).not.toContain("<goal_round>");
    expect(host.textContent).not.toContain("Hazme la tienda entera");
  });

  it("y la corrección del dueño a media ronda se sigue viendo", () => {
    const host = pintar(`${goalRoundPrompt(meta, 2)}\n↳ para el encargo`);
    expect(host.textContent).toContain("para el encargo");
  });

  it("BRAZO DE CONTROL: un mensaje normal, tal cual", () => {
    expect(pintar("cambia el título").textContent).toContain("cambia el título");
  });
});
