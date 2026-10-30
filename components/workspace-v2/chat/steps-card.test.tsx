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
import { StepsCard, visibleSteps } from "./steps-card";
import type { DesignTurn } from "./use-agent-chat";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
});

function pintar(actions: AgentAction[], esApp = false) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  const turn = { id: "t", userText: "x", assistantReasoning: "", status: "applied", actions } as DesignTurn;
  act(() => root.render(<StepsCard turn={turn} projectId="p" onOpenFile={() => {}} esApp={esApp} />));
  return host;
}

describe("la tarjeta de los pasos", () => {
  // Ensayo de caja del 09/10: en una app los pasos decían «Leyendo la página
  // src/App.jsx», «Probando la página»…
  it("🔴 en una app, los pasos hablan del código y de la app, no de «la página»", () => {
    const pasos = [
      { tool: "Read", status: "done", summary: "/src/App.jsx" },
      { tool: "Edit", status: "done", summary: "/src/App.jsx" },
      { tool: "use_page", status: "done", summary: "" },
    ] as AgentAction[];
    const app = pintar(pasos, true).textContent ?? "";
    expect(app).toContain("agent.toolApp.Read");
    expect(app).toContain("agent.toolApp.Edit");
    expect(app).toContain("agent.toolApp.use_page");
    expect(app).not.toMatch(/agent\.tool\.(Read|Edit|use_page)/);
    // Lo que no nombra la página, igual; y en una página, como siempre.
    expect(pintar([{ tool: "bash", status: "done", summary: "ls" } as AgentAction], true).textContent).toContain("agent.tool.bash");
    expect(pintar(pasos).textContent).toContain("agent.tool.Read");
  });


  // Prueba real del 21/10: los ficheros de una presentación salían como «Escribiendo la página .len/artifacts/…».
  it("los ficheros de un entregable hablan del entregable, en una página y en una app", () => {
    const pasos = [
      { tool: "Read", status: "done", summary: "/.len/artifacts/ac521cd9/deck.json" },
      { tool: "Edit", status: "done", summary: "/.len/artifacts/ac521cd9/slides/cover.html" },
      { tool: "Write", status: "done", summary: ".len/artifacts/ac521cd9/slides/precios.html" },
    ] as AgentAction[];
    for (const esApp of [false, true]) {
      const texto = pintar(pasos, esApp).textContent ?? "";
      expect(texto).toContain("agent.toolArtifact.Read");
      expect(texto).toContain("agent.toolArtifact.Edit");
      expect(texto).toContain("agent.toolArtifact.Write");
      expect(texto).not.toMatch(/agent\.tool(App)?\.(Read|Edit|Write)/);
    }
  });

  // Lo que vio Len, en el chat (como Claude Code: la captura es el resultado del
  // paso). Jesús, 29/10: «que se vea siempre», también con los pasos plegados.
  it("🔴 las capturas de un paso se ven con los pasos plegados, y una miniatura la abre en grande", () => {
    const url = "https://uploads.openlen.com/uploads/p/screenshot-0123456789abcdef0123456789abcdef.jpg";
    const host = pintar([
      { tool: "Edit", status: "done", summary: "/index.html" },
      { tool: "view_page", status: "done", summary: "", screenshots: [url] },
    ] as AgentAction[]);
    expect(host.querySelector("button[aria-expanded]")?.getAttribute("aria-expanded")).toBe("false");
    const miniatura = host.querySelector<HTMLImageElement>(`img[src="${url}"]`);
    expect(miniatura).not.toBeNull();
    act(() => miniatura!.closest("button")!.click());
    const visor = document.querySelector('[role="dialog"]');
    expect(visor?.querySelector(`img[src="${url}"]`)).not.toBeNull();
    // Su pie dice qué es, no la etiqueta del botón que la abrió (visto en el navegador, 29/10).
    expect(visor?.textContent).toContain("newChat.steps.screenshotCaption");
    expect(visor?.textContent).not.toContain("newChat.steps.openScreenshot");
  });

  it("BRAZO DE CONTROL: sin capturas no hay tira de miniaturas", () => {
    const host = pintar([{ tool: "view_page", status: "done", summary: "" } as AgentAction]);
    expect(host.querySelector("[data-step-screenshots]")).toBeNull();
  });

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

  it("LOS VISUALES: read_me y show_widget no son pasos (el visual va en la respuesta)", () => {
    const steps = visibleSteps([
      { tool: "read_me", status: "done", summary: "" },
      { tool: "show_widget", status: "done", summary: "", widget: { title: "t", loadingMessages: [], code: "<p>" } },
      { tool: "Write", status: "done", summary: "/index.html" },
    ] as AgentAction[]);
    expect(steps.map((a) => a.tool)).toEqual(["Write"]);
  });

  it("las demás herramientas que fallan siguen como estaban: «falló» y su motivo para el dueño (N41)", () => {
    const host = pintar([{ tool: "Write", status: "error", summary: "/js/app.js" } as AgentAction]);
    expect(host.textContent).toContain("agent.failed");
    expect(host.textContent).not.toContain("/js/app.js");
  });
});
