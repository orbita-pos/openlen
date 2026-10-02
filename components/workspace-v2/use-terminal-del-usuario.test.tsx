// @vitest-environment jsdom
// La terminal del usuario, del lado del navegador (la #17 de
// plans/len-agente-2026/notas/fase-5-taller.md): manda el comando, guarda lo que
// imprime y, si cambió algún fichero, avisa al lienzo por el canal de `/new`.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { useTerminalDelUsuario, type TerminalDelUsuario } from "./use-terminal-del-usuario";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
afterEach(() => {
  roots.splice(0).forEach((r) => act(() => r.unmount()));
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

function montar(projectId: string): { actual: () => TerminalDelUsuario } {
  let ultimo: TerminalDelUsuario | null = null;
  function Sonda() {
    ultimo = useTerminalDelUsuario(projectId);
    return null;
  }
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  roots.push(root);
  act(() => root.render(<Sonda />));
  return { actual: () => ultimo! };
}

describe("useTerminalDelUsuario", () => {
  it("manda el comando y guarda lo que imprimió; si cambió algo, avisa al lienzo", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ salida: "index.html: saved.\n", exitCode: 0, cambio: true })));
    vi.stubGlobal("fetch", fetch);
    const avisos: unknown[] = [];
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        constructor(readonly nombre: string) {}
        postMessage(m: unknown) {
          avisos.push([this.nombre, m]);
        }
        close() {}
      },
    );
    const { actual } = montar("p-ok");
    await act(async () => actual().ejecutar("sed -i 's/a/b/' /index.html"));
    expect(fetch).toHaveBeenCalledWith("/api/projects/p-ok/terminal", expect.objectContaining({ method: "POST" }));
    expect(JSON.parse(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual({ command: "sed -i 's/a/b/' /index.html" });
    expect(actual().comandos).toEqual([expect.objectContaining({ command: "sed -i 's/a/b/' /index.html", salida: "index.html: saved.\n", exitCode: 0 })]);
    expect(actual().corriendo).toBe(false);
    expect(avisos).toEqual([["openlen-project-sync", { projectId: "p-ok" }]]);
  });

  it("si no corre (la terminal apagada, la red), lo dice en el propio comando", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "apagada" }), { status: 409 })));
    const { actual } = montar("p-apagada");
    await act(async () => actual().ejecutar("ls /"));
    expect(actual().comandos).toEqual([expect.objectContaining({ command: "ls /", salida: null, error: "apagada" })]);
    expect(actual().corriendo).toBe(false);

    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
    await act(async () => actual().ejecutar("pwd"));
    expect(actual().comandos.at(-1)).toEqual(expect.objectContaining({ command: "pwd", error: "red" }));
  });
});
