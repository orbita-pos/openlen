// @vitest-environment jsdom
// Arnés manual de react-dom + act(), como `agent-reply-card.test.tsx`: en el
// repo no hay @testing-library. Los textos llegan por props.
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TerminalView } from "./terminal-view";
import type { TerminalDeLen } from "./use-terminal-de-len";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom no tiene scrollIntoView y la vista baja al último comando.
Element.prototype.scrollIntoView = function () {};

const labels = {
  title: "La terminal de Len",
  close: "Cerrar",
  soloLectura: "Sólo lectura",
  vacio: "Len todavía no ha usado la terminal en este proyecto.",
  apagada: "La terminal de Len está apagada en este servidor.",
  error: "No se pudieron cargar los comandos anteriores.",
  enVivo: "Este turno",
  sinSalida: "Sin salida guardada.",
  codigo: (n: number) => `Terminó con el código ${n}`,
};

const base: TerminalDeLen = { encendida: true, turnos: [], enVivo: [], cargando: false, error: false, recargar: () => {} };

const roots: Root[] = [];
afterEach(() => {
  roots.splice(0).forEach((r) => act(() => r.unmount()));
  document.body.innerHTML = "";
});

function pintar(terminal: TerminalDeLen): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  roots.push(root);
  act(() => root.render(<TerminalView terminal={terminal} onClose={() => {}} labels={labels} />));
  return el;
}

describe("TerminalView", () => {
  it("cada turno con su pedido, cada comando con su salida SIN la línea del código, y el código aparte si no es 0", () => {
    const el = pintar({
      ...base,
      turnos: [
        {
          id: "t1",
          pedido: "Cambia la dirección",
          creado: "2026-10-02T09:12:00.000Z",
          comandos: [
            { command: "sed -i 's/a/b/' /index.html", salida: "index.html: saved.\n[Command finished with exit code 0]", exitCode: 0 },
            { command: "echo x >> /AGENTS.md", salida: "AGENTS.md: not saved.\n[Command finished with exit code 1]", exitCode: 1 },
          ],
        },
      ],
      enVivo: [{ command: "ls /", salida: "index.html\n[Command finished with exit code 0]", exitCode: 0 }],
    });
    const texto = el.textContent ?? "";
    expect(texto).toContain("Cambia la dirección");
    expect(texto).toContain("$ sed -i 's/a/b/' /index.html");
    expect(texto).toContain("index.html: saved.");
    expect(texto).not.toContain("[Command finished");
    expect(texto).toContain("Terminó con el código 1");
    expect(texto).not.toContain("Terminó con el código 0");
    expect(texto).toContain("Este turno");
    expect(texto).toContain("$ ls /");
  });

  it("la salida es TEXTO: el HTML de una página o de un visitante no se interpreta", () => {
    const el = pintar({
      ...base,
      enVivo: [{ command: "cat /index.html", salida: '<img src=x onerror="alert(1)"><h1>Hola</h1>\n[Command finished with exit code 0]', exitCode: 0 }],
    });
    expect(el.querySelector("img")).toBeNull();
    expect(el.querySelector("h1")).toBeNull();
    expect(el.textContent).toContain('<img src=x onerror="alert(1)">');
  });

  it("vacía: dice si la terminal está apagada o si Len aún no la usó", () => {
    expect(pintar(base).textContent).toContain(labels.vacio);
    expect(pintar({ ...base, encendida: false }).textContent).toContain(labels.apagada);
  });
});
