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

  // Ensayo de caja de crear-es-len (06/10): un turno guardado ANTES de que las
  // 11 herramientas pasaran al inglés pintaba `ver_visitas`, `mirar_pagina` y
  // `usar_pagina` crudos en esta tarjeta (la hermana, `agent-action-card`, ya
  // los traducía).
  it("🔴 una fila guardada con el nombre de antes sale con la etiqueta de hoy", () => {
    const host = pintar([
      { tool: "ver_visitas", status: "done", summary: "" } as AgentAction,
      { tool: "mirar_pagina", status: "done", summary: "index.html" } as AgentAction,
      { tool: "usar_pagina", status: "done", summary: "index.html" } as AgentAction,
    ]);
    expect(host.textContent).toContain("agent.tool.get_visits");
    expect(host.textContent).toContain("agent.tool.view_page");
    expect(host.textContent).toContain("agent.tool.use_page");
    expect(host.textContent).not.toMatch(/ver_visitas|mirar_pagina|usar_pagina/);
  });

  it("🔴 la pregunta abierta no sale como paso aunque otras llamadas de su tanda vayan detrás", () => {
    const host = pintar([
      { tool: "enter_plan_mode", status: "done", summary: "", pregunta: "Switch to plan mode?", preguntas: [{ id: "plan-mode", question: "Switch to plan mode?" }] } as AgentAction,
      { tool: "find_photo", status: "done", summary: "madera" } as AgentAction,
    ]);
    expect(host.textContent).not.toContain("agent.tool.enter_plan_mode");
    expect(host.textContent).toContain("agent.tool.find_photo");
  });

  it("las demás herramientas que fallan siguen como estaban: «falló» y su motivo para el dueño (N41)", () => {
    const host = pintar([{ tool: "Write", status: "error", summary: "/js/app.js" } as AgentAction]);
    expect(host.textContent).toContain("agent.failed");
    expect(host.textContent).not.toContain("/js/app.js");
  });
});
