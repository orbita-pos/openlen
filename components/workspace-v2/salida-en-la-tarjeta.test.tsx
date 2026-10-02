// @vitest-environment jsdom
// La tarjeta de `bash` del Chat se despliega con su salida (la #5 de
// plans/len-agente-2026/notas/fase-5-taller.md). Arnés manual de react-dom +
// act(), como `terminal-view.test.tsx`.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

// Las claves tal cual, con sus valores detrás: basta para leer qué se pintó.
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, v?: Record<string, unknown>) => (v ? `${key} ${JSON.stringify(v)}` : key),
}));

import { AgentActionCard, type AgentAction } from "./agent-action-card";
import { terminalEnVivo } from "@/lib/workspace-v2/terminal-en-vivo";
import { resumenDelComando } from "@/lib/agent/terminal/resumen-del-comando";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
afterEach(() => {
  roots.splice(0).forEach((r) => act(() => r.unmount()));
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

function pintar(action: AgentAction, projectId: string, turnId = "t1", indice = 0): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  roots.push(root);
  act(() => root.render(<AgentActionCard action={action} terminal={{ projectId, turnId, indice }} />));
  return el;
}

const GREP = "grep -rn 'Calle Marea 12' /";
const SALIDA = ["/index.html:88:a", "/index.html:131:b", "/menu/index.html:41:c", "/contacto/index.html:23:d", "/contacto/index.html:58:e", "[Command finished with exit code 0]"].join("\n");

describe("la tarjeta de la terminal en el Chat", () => {
  it("plegada: la etiqueta y el comando; desplegada: el comando entero, 3 líneas y cuántas quedan", () => {
    terminalEnVivo.empujar("p-vivo", { command: GREP, salida: SALIDA, exitCode: 0, turnId: "t1" });
    const el = pintar({ tool: "bash", status: "done", summary: resumenDelComando(GREP) }, "p-vivo");

    const boton = el.querySelector("button[aria-expanded]")!;
    expect(boton.getAttribute("aria-expanded")).toBe("false");
    expect(boton.textContent).toContain("agent.tool.bash");
    expect(boton.textContent).toContain(GREP);
    expect(el.textContent).not.toContain("/index.html:88");

    act(() => (boton as HTMLButtonElement).click());
    expect(boton.getAttribute("aria-expanded")).toBe("true");
    expect(el.querySelector("pre")!.textContent).toBe(`$ ${GREP}`);
    expect(el.textContent).toContain("/menu/index.html:41:c");
    expect(el.textContent).not.toContain("/contacto/index.html:23:d");
    expect(el.textContent).not.toContain("Command finished");
    expect(el.textContent).toContain('agent.terminal.mas {"count":2}');

    const mas = [...el.querySelectorAll("button")].find((b) => b.textContent?.startsWith("agent.terminal.mas"))!;
    act(() => mas.click());
    expect(el.textContent).toContain("/contacto/index.html:58:e");
    expect(el.textContent).toContain("agent.terminal.menos");
  });

  it("de un turno de antes de recargar, la salida se pide a la ruta de la Terminal (una vez) y el código distinto de 0 va aparte", async () => {
    const fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          encendida: true,
          turnos: [{ id: "t9", comandos: [{ command: "cat /AGENTS.md > /x", salida: "rechazado\n[Command finished with exit code 1]", exitCode: 1 }] }],
        }),
      ),
    );
    vi.stubGlobal("fetch", fetch);
    const el = pintar(
      { tool: "bash", status: "error", summary: resumenDelComando("cat /AGENTS.md > /x"), motivo: "exit code 1" },
      "p-guardado",
      "t9",
    );
    await act(async () => {
      el.querySelector<HTMLButtonElement>("button[aria-expanded]")!.click();
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String((fetch.mock.calls[0] as unknown[])[0])).toBe("/api/projects/p-guardado/terminal");
    expect(el.textContent).toContain("rechazado");
    expect(el.textContent).toContain('preview.terminal.codigo {"n":1}');
  });

  it("si nadie guardó esa salida, lo dice en vez de enseñar la de otro comando", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ turnos: [{ id: "t9", comandos: [{ command: "ls /", salida: "/index.html", exitCode: 0 }] }] }))));
    const el = pintar({ tool: "bash", status: "done", summary: "pwd" }, "p-sin", "t9");
    await act(async () => {
      el.querySelector<HTMLButtonElement>("button[aria-expanded]")!.click();
    });
    expect(el.textContent).toContain("preview.terminal.sinSalida");
    expect(el.textContent).not.toContain("/index.html");
  });

  it("mientras corre no se despliega, y las demás herramientas siguen siendo una fila", () => {
    const corriendo = pintar({ tool: "bash", status: "running", summary: resumenDelComando(GREP) }, "p-x");
    expect(corriendo.querySelector("button")).toBeNull();
    expect(corriendo.textContent).toContain(GREP);
    const read = pintar({ tool: "Read", status: "done", summary: "index.html" }, "p-x");
    expect(read.querySelector("button")).toBeNull();
  });
});
