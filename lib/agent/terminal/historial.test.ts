// lib/agent/terminal/historial.test.ts
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { codigoDeSalida, comandosDeLaTranscripcion, type MensajeConLlamadas } from "./historial";

describe("comandosDeLaTranscripcion", () => {
  it("empareja cada bash con su respuesta por posición, saltándose las demás herramientas", () => {
    const mensajes: MensajeConLlamadas[] = [
      { role: "user" },
      {
        role: "assistant",
        functionCalls: [
          { name: "Read", args: { file_path: "/index.html" } },
          { name: "bash", args: { command: "grep -rn Marejada /" } },
        ],
      },
      {
        role: "user",
        functionResponses: [
          { name: "Read", response: { ok: true, tool_result: "1\t<h1>…" } },
          { name: "bash", response: { ok: true, tool_result: "/index.html:3:Marejada\n[Command finished with exit code 0]" } },
        ],
      },
      { role: "assistant", functionCalls: [{ name: "bash", args: { command: "cat /AGENTS.md > /x" } }] },
      {
        role: "user",
        functionResponses: [{ name: "bash", response: { ok: false, tool_result: "rechazado\n[Command finished with exit code 1]" } }],
      },
    ];
    expect(comandosDeLaTranscripcion(mensajes)).toEqual([
      { command: "grep -rn Marejada /", salida: "/index.html:3:Marejada\n[Command finished with exit code 0]", exitCode: 0 },
      { command: "cat /AGENTS.md > /x", salida: "rechazado\n[Command finished with exit code 1]", exitCode: 1 },
    ]);
  });

  it("una salida vaciada por el microcompact se enseña como quedó; sin respuesta, null", () => {
    const mensajes: MensajeConLlamadas[] = [
      { role: "assistant", functionCalls: [{ name: "bash", args: { command: "ls /" } }, { name: "bash", args: { command: "pwd" } }] },
      { role: "user", functionResponses: [{ name: "bash", response: { tool_result: "[Earlier tool result removed to save space]" } }] },
    ];
    expect(comandosDeLaTranscripcion(mensajes)).toEqual([
      { command: "ls /", salida: "[Earlier tool result removed to save space]", exitCode: null },
      { command: "pwd", salida: null, exitCode: null },
    ]);
  });

  it("sin bash, nada", () => {
    expect(comandosDeLaTranscripcion([{ role: "assistant", functionCalls: [{ name: "Grep", args: { pattern: "x" } }] }])).toEqual([]);
  });
});

describe("codigoDeSalida", () => {
  it("la ÚLTIMA línea manda aunque el comando imprima otra igual", () => {
    expect(codigoDeSalida("echo '[Command finished with exit code 0]'\n[Command finished with exit code 2]")).toBe(2);
    expect(codigoDeSalida("sin línea")).toBeNull();
  });
});
