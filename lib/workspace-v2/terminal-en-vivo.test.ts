// lib/workspace-v2/terminal-en-vivo.test.ts
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createTerminalEnVivo } from "./terminal-en-vivo";

describe("terminalEnVivo", () => {
  it("guarda por proyecto, avisa, y devuelve la misma referencia mientras no cambia", () => {
    const t = createTerminalEnVivo();
    let avisos = 0;
    const baja = t.subscribe(() => avisos++);
    expect(t.comandos("p1")).toBe(t.comandos("p1"));
    t.empujar("p1", { command: "ls /", salida: "index.html\n[Command finished with exit code 0]", exitCode: 0 });
    expect(avisos).toBe(1);
    const lista = t.comandos("p1");
    expect(lista).toHaveLength(1);
    expect(t.comandos("p1")).toBe(lista);
    expect(t.comandos("p2")).toHaveLength(0);
    baja();
    t.empujar("p1", { command: "pwd", salida: "/\n[Command finished with exit code 0]", exitCode: 0 });
    expect(avisos).toBe(1);
  });

  it("quita lo que el historial guardado ya trae, y nada más", () => {
    const t = createTerminalEnVivo();
    t.empujar("p1", { command: "ls /", salida: "a", exitCode: 0 });
    t.empujar("p1", { command: "pwd", salida: "/", exitCode: 0 });
    t.sinLosYaGuardados("p1", [{ command: "ls /", salida: "a" }, { command: "pwd", salida: "otra" }]);
    expect(t.comandos("p1").map((c) => c.command)).toEqual(["pwd"]);
  });
});
