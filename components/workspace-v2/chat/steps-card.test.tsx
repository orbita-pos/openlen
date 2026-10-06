// LA TERMINAL QUE FALLA ENSEÑA SU COMANDO (humo de 2.5, 06/10): la tarjeta de
// los pasos decía «Terminal falló» sin el comando, y un `ls` de una carpeta que
// aún no existía parecía una avería.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next-intl", () => ({
  useTranslations: () => (clave: string, v?: Record<string, unknown>) => (v ? `${clave} ${JSON.stringify(v)}` : clave),
  useLocale: () => "es",
}));

import type { AgentAction } from "../agent-action-card";
import { StepsCard } from "./steps-card";
import type { DesignTurn } from "./use-agent-chat";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
});

function pintar(actions: AgentAction[]) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  const turn = { id: "t", userText: "x", assistantReasoning: "", status: "applied", actions } as DesignTurn;
  act(() => root.render(<StepsCard turn={turn} projectId="p" onOpenFile={() => {}} />));
  return host;
}

describe("la tarjeta de los pasos", () => {
  it("🔴 un comando de la terminal que falla enseña el comando y «falló»", () => {
    const host = pintar([{ tool: "bash", status: "error", summary: "ls /supabase" } as AgentAction]);
    expect(host.textContent).toContain("ls /supabase");
    expect(host.textContent).toContain("agent.failed");
  });

  it("BRAZO DE CONTROL: el mismo comando bien, sin «falló»", () => {
    const host = pintar([{ tool: "bash", status: "done", summary: "ls /supabase" } as AgentAction]);
    expect(host.textContent).toContain("ls /supabase");
    expect(host.textContent).not.toContain("agent.failed");
  });

  it("las demás herramientas que fallan siguen como estaban: «falló» y su motivo para el dueño (N41)", () => {
    const host = pintar([{ tool: "Write", status: "error", summary: "/js/app.js" } as AgentAction]);
    expect(host.textContent).toContain("agent.failed");
    expect(host.textContent).not.toContain("/js/app.js");
  });
});
