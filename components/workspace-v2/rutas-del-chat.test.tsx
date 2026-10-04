// @vitest-environment jsdom
// Las rutas del Chat abren su fichero (la #9 de
// plans/len-agente-2026/notas/fase-5-taller.md): la tarjeta de un fichero y las
// rutas entre comillas de código del texto de Len. Arnés manual de react-dom +
// act(), como `terminal-view.test.tsx`.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

import { AgentActionCard } from "./agent-action-card";
import { TextoDeLen } from "./texto-de-len";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
afterEach(() => {
  roots.splice(0).forEach((r) => act(() => r.unmount()));
  document.body.innerHTML = "";
});

function pintar(nodo: React.ReactNode): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  roots.push(root);
  act(() => root.render(nodo));
  return el;
}

describe("la tarjeta de un fichero lo abre", () => {
  it("Edit: pulsar la tarjeta pide su ruta", () => {
    const abrir = vi.fn();
    const el = pintar(
      <AgentActionCard action={{ tool: "Edit", status: "done", summary: "menu/index.html: «a» → «b»" }} onAbrirFichero={abrir} />,
    );
    const boton = el.querySelector("button")!;
    expect(boton.getAttribute("title")).toBe("agent.abrirFichero");
    act(() => boton.click());
    expect(abrir).toHaveBeenCalledWith("/menu/index.html");
  });

  it("roja, el motivo del dueño sigue en el title; mientras corre, o sin quien abra, es una fila como siempre", () => {
    // N41: en rojo, el `ownerReason` traducido; lo que leyó el modelo (`motivo`) no.
    const rota = pintar(
      <AgentActionCard
        action={{ tool: "Write", status: "error", summary: "index.html", motivo: "Cannot create /x/index.html…", ownerReason: { code: "site_page_limit", limit: 20 } }}
        onAbrirFichero={() => {}}
      />,
    );
    expect(rota.querySelector("button")!.getAttribute("title")).toBe("agent.ownerReason.site_page_limit");
    const deAntes = pintar(
      <AgentActionCard action={{ tool: "Write", status: "error", summary: "index.html", motivo: "data-slot-path" }} onAbrirFichero={() => {}} />,
    );
    expect(deAntes.querySelector("button")!.getAttribute("title")).toBe("agent.abrirFichero");
    expect(pintar(<AgentActionCard action={{ tool: "Read", status: "running", summary: "index.html" }} onAbrirFichero={() => {}} />).querySelector("button")).toBeNull();
    expect(pintar(<AgentActionCard action={{ tool: "Read", status: "done", summary: "index.html" }} />).querySelector("button")).toBeNull();
    expect(pintar(<AgentActionCard action={{ tool: "Grep", status: "done", summary: "Marea" }} onAbrirFichero={() => {}} />).querySelector("button")).toBeNull();
  });
});

describe("el texto de Len enlaza las rutas del turno", () => {
  it("sólo las que el turno leyó o cambió; lo demás sigue siendo código", () => {
    const abrir = vi.fn();
    const el = pintar(
      <TextoDeLen
        texto="Cambié `menu/index.html:41` y no toqué `notas.txt`; **listo**."
        rutas={["/menu/index.html", "/index.html"]}
        onAbrir={abrir}
      />,
    );
    const enlaces = el.querySelectorAll("button");
    expect(enlaces).toHaveLength(1);
    expect(enlaces[0]!.textContent).toBe("menu/index.html:41");
    act(() => enlaces[0]!.click());
    expect(abrir).toHaveBeenCalledWith("/menu/index.html");
    expect(el.querySelector("code")!.textContent).toBe("notas.txt");
    expect(el.querySelector("strong")!.textContent).toBe("listo");
  });

  it("sin quien abra, ninguna ruta es enlace", () => {
    const el = pintar(<TextoDeLen texto="Ver `menu/index.html`." rutas={["/menu/index.html"]} />);
    expect(el.querySelector("button")).toBeNull();
    expect(el.querySelector("code")!.textContent).toBe("menu/index.html");
  });
});
