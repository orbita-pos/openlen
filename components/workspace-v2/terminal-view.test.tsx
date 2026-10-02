// @vitest-environment jsdom
// Arnés manual de react-dom + act(), como `agent-reply-card.test.tsx`: en el
// repo no hay @testing-library. Los textos llegan por props.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TerminalView } from "./terminal-view";
import type { TerminalDeLen } from "./use-terminal-de-len";
import type { TerminalDelUsuario } from "./use-terminal-del-usuario";

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
  copiar: "Copiar",
  copiado: "Copiado",
  ocultas: (n: number) => `··· ${n} líneas más`,
  plegar: "Plegar",
  tuya: "Tu terminal",
  escribe: "Escribe un comando y pulsa Intro",
  nota: "Len no ve lo que escribes aquí; lo que cambies en los archivos, sí.",
  corriendo: "Corriendo…",
  noCorrio: (motivo: string) => `No se pudo ejecutar (${motivo}).`,
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

  it("una salida larga va plegada: las 8 primeras, cuántas faltan y las 8 últimas; «Plegar» la vuelve a plegar", () => {
    const lineas = Array.from({ length: 30 }, (_, i) => `linea-${i + 1}`);
    const el = pintar({
      ...base,
      enVivo: [{ command: "cat -n /x", salida: `${lineas.join("\n")}\n[Command finished with exit code 0]`, exitCode: 0 }],
    });
    const texto = () => el.textContent ?? "";
    // El del comando, el de arriba y el de abajo.
    const [, arriba, abajo] = [...el.querySelectorAll("pre")].map((p) => p.textContent);
    expect(arriba).toBe(lineas.slice(0, 8).join("\n"));
    expect(abajo).toBe(lineas.slice(22).join("\n"));
    expect(texto()).toContain("··· 14 líneas más");

    const boton = () => el.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
    act(() => boton().click());
    expect(boton().getAttribute("aria-expanded")).toBe("true");
    expect(texto()).toContain("linea-15");
    expect(texto()).toContain("Plegar");
    act(() => boton().click());
    expect(texto()).not.toContain("linea-15");
  });

  it("hasta 16 líneas, todas y sin pliegue", () => {
    const el = pintar({
      ...base,
      enVivo: [{ command: "ls", salida: `${Array.from({ length: 16 }, (_, i) => `f${i}`).join("\n")}\n[Command finished with exit code 0]`, exitCode: 0 }],
    });
    expect(el.textContent).toContain("f15");
    expect(el.querySelector("button[aria-expanded]")).toBeNull();
  });

  it("Copiar copia sólo lo que imprimió: ni el comando ni la línea del código", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const el = pintar({
      ...base,
      enVivo: [{ command: "grep -rn Marea /", salida: "/a:1:Marea\n/b:2:Marea\n[Command finished with exit code 0]", exitCode: 0 }],
    });
    const copiar = [...el.querySelectorAll("button")].find((b) => b.textContent === "Copiar")!;
    await act(async () => copiar.click());
    expect(writeText).toHaveBeenCalledWith("/a:1:Marea\n/b:2:Marea");
    expect(el.textContent).toContain("Copiado");
  });

  it("sin nada impreso no hay nada que copiar", () => {
    const el = pintar({ ...base, enVivo: [{ command: "true", salida: "[Command finished with exit code 0]", exitCode: 0 }] });
    expect([...el.querySelectorAll("button")].some((b) => b.textContent === "Copiar")).toBe(false);
  });

  it("vacía: dice si la terminal está apagada o si Len aún no la usó", () => {
    expect(pintar(base).textContent).toContain(labels.vacio);
    expect(pintar({ ...base, encendida: false }).textContent).toContain(labels.apagada);
  });
});

describe("TerminalView — tu terminal (la #17)", () => {
  function conTuya(tuya: TerminalDelUsuario, onClose = () => {}) {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const root = createRoot(el);
    roots.push(root);
    const render = (t: TerminalDelUsuario) =>
      act(() => root.render(<TerminalView terminal={base} tuya={t} onClose={onClose} labels={labels} />));
    render(tuya);
    return { el, render };
  }
  const escribir = (input: HTMLInputElement, texto: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setter.call(input, texto);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  const tecla = (el: EventTarget, key: string, atendida = false) => {
    const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    if (atendida) e.preventDefault();
    act(() => {
      el.dispatchEvent(e);
    });
    return e;
  };

  it("sin ella, sólo lectura y sin línea para escribir", () => {
    const el = pintar(base);
    expect(el.textContent).toContain("Sólo lectura");
    expect(el.querySelector("input")).toBeNull();
  });

  it("con ella: la línea, la nota de que Len no la ve, y Enter ejecuta", () => {
    const ejecutar = vi.fn(async () => {});
    const { el } = conTuya({ comandos: [], corriendo: false, ejecutar });
    expect(el.textContent).not.toContain("Sólo lectura");
    expect(el.textContent).toContain(labels.nota);
    const input = el.querySelector("input")!;
    escribir(input, "ls /");
    act(() => {
      el.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(ejecutar).toHaveBeenCalledWith("ls /");
    expect(input.value).toBe("");
  });

  it("tus comandos van en su propio bloque: corriendo, con su salida o con por qué no corrió", () => {
    const { el } = conTuya({
      corriendo: true,
      ejecutar: async () => {},
      comandos: [
        { n: 1, command: "pwd", salida: "/\n[Command finished with exit code 0]", exitCode: 0 },
        { n: 2, command: "cat /x", salida: null, exitCode: null, error: "apagada" },
        { n: 3, command: "sleep 1", salida: null, exitCode: null },
      ],
    });
    expect(el.textContent).toContain("Tu terminal");
    expect(el.textContent).toContain("$ pwd");
    expect(el.textContent).toContain("No se pudo ejecutar (apagada).");
    expect(el.textContent).toContain("Corriendo…");
  });

  it("las flechas recorren lo que escribiste; Escape borra la línea y no cierra", () => {
    const onClose = vi.fn();
    const { el } = conTuya(
      {
        corriendo: false,
        ejecutar: async () => {},
        comandos: [
          { n: 1, command: "ls /", salida: "", exitCode: 0 },
          { n: 2, command: "pwd", salida: "/", exitCode: 0 },
        ],
      },
      onClose,
    );
    const input = el.querySelector("input")!;
    tecla(input, "ArrowUp");
    expect(input.value).toBe("pwd");
    tecla(input, "ArrowUp");
    expect(input.value).toBe("ls /");
    tecla(input, "ArrowDown");
    expect(input.value).toBe("pwd");
    expect(tecla(input, "Escape").defaultPrevented).toBe(true);
    expect(input.value).toBe("");
    expect(onClose).not.toHaveBeenCalled();
    // Como en /new, donde React escucha en el propio `document`: la tecla llega
    // al oyente de la lente aunque la línea la parara, y manda la marca.
    tecla(document, "Escape", true);
    expect(onClose).not.toHaveBeenCalled();
    tecla(input, "Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
