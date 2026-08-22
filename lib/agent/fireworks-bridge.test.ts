import { describe, expect, it } from "vitest";

import { messagesForFireworks, toolsForFireworks } from "./fireworks-bridge";
import { buildFunctionDeclarations } from "./catalog";

describe("puente del Agente al cable de Fireworks", () => {
  it("baja los tipos del esquema a minúsculas en toda su profundidad", () => {
    const tools = toolsForFireworks([{
      name: "editar_pagina",
      description: "edita",
      parameters: {
        type: "OBJECT",
        properties: { edits: { type: "ARRAY", items: { type: "OBJECT", properties: { op: { type: "STRING" } } } } },
      },
    }]);
    expect(tools[0]).toMatchObject({
      type: "function",
      function: {
        name: "editar_pagina",
        parameters: { type: "object", properties: { edits: { type: "array", items: { type: "object", properties: { op: { type: "string" } } } } } },
      },
    });
  });

  it("traduce el catálogo REAL del Agente sin dejar un tipo en mayúsculas", () => {
    const wire = JSON.stringify(toolsForFireworks(buildFunctionDeclarations()));
    expect(wire).not.toMatch(/"type":"(OBJECT|STRING|ARRAY|BOOLEAN|NUMBER|INTEGER)"/);
    expect(toolsForFireworks(buildFunctionDeclarations()).length).toBe(buildFunctionDeclarations().length);
  });

  it("empareja cada respuesta con su llamada por posición, no por nombre", () => {
    // Un turno puede llamar dos veces a la misma herramienta: el nombre no
    // distingue, y el cable exige un id distinto para cada una.
    const wire = messagesForFireworks([
      { role: "user", content: "activa reservas y publica" },
      {
        role: "assistant", content: "voy",
        functionCalls: [
          { name: "activar_modulo", args: { modulo: "bookings" } },
          { name: "activar_modulo", args: { modulo: "members" } },
        ],
      },
      {
        role: "user", content: "",
        functionResponses: [
          { name: "activar_modulo", response: { ok: true, modulo: "bookings" } },
          { name: "activar_modulo", response: { ok: true, modulo: "members" } },
        ],
      },
    ]);
    const calls = wire[1].toolCalls ?? [];
    expect(calls).toHaveLength(2);
    expect(new Set(calls.map((c) => c.id)).size).toBe(2);
    expect(wire[2]).toEqual({ role: "tool", content: '{"ok":true,"modulo":"bookings"}', toolCallId: calls[0].id });
    expect(wire[3]).toEqual({ role: "tool", content: '{"ok":true,"modulo":"members"}', toolCallId: calls[1].id });
  });

  it("una respuesta huérfana baja a texto en vez de tumbar el turno", () => {
    const wire = messagesForFireworks([
      { role: "user", content: "", functionResponses: [{ name: "leer_estado", response: { ok: true } }] },
    ]);
    expect(wire).toEqual([{ role: "user", content: 'leer_estado: {"ok":true}' }]);
  });

  it("deja en paz una conversación sin herramientas", () => {
    const wire = messagesForFireworks([
      { role: "system", content: "eres el agente" },
      { role: "user", content: "hola" },
      { role: "assistant", content: "hola" },
    ]);
    expect(wire).toEqual([
      { role: "system", content: "eres el agente" },
      { role: "user", content: "hola" },
      { role: "assistant", content: "hola" },
    ]);
  });
});
