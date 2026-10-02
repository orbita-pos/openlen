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

  it("una herramienta de ficheros devuelve TEXTO, y va tal cual: el cat -n no llega escapado", () => {
    // Claude Code: el `tool_result` de Read es el texto que el modelo lee, con
    // sus saltos de línea y tabuladores. Serializado como JSON le llegaría
    // `"1\\t<html>\\n2\\t…"`, otra cosa de por medio.
    const wire = messagesForFireworks([
      { role: "user", content: "lee la home" },
      { role: "assistant", content: "", functionCalls: [{ name: "Read", args: { file_path: "/index.html" } }] },
      {
        role: "user", content: "",
        functionResponses: [
          { name: "Read", response: { ok: true, tool_result: "1\t<html>\n2\t<body>" } },
        ],
      },
    ]);
    expect(wire[2]).toEqual({
      role: "tool",
      content: "1\t<html>\n2\t<body>",
      toolCallId: wire[1].toolCalls?.[0]?.id,
    });
  });

  it("🔴 el CONTENT del mensaje de respuestas viaja: es donde va lo medido", () => {
    // MEDIDO el 2026-09-06 pagando 6 corridas del Agente: las seis recibieron
    // una página rota, el bucle midió y redactó el aviso con su `data-op-id`, y
    // las seis cerraron sin tocarlo ni mencionarlo. No era que el modelo lo
    // ignorase: este puente hacía `return` tras emitir los `role:"tool"` y el
    // `content` del mensaje —que es DONDE VIVE EL AVISO— se quedaba fuera del
    // cable. La función entera que lo redacta llevaba desde el 2026-09-05 sin
    // llegar a ningún modelo.
    //
    // Va DESPUÉS de los `tool` y como mensaje aparte, que es la forma de Claude
    // Code: sus diagnósticos nuevos son un mensaje hermano del resultado, jamás
    // parte de su payload.
    const wire = messagesForFireworks([
      { role: "user", content: "arregla el movil" },
      { role: "assistant", content: "voy", functionCalls: [{ name: "editar_pagina", args: {} }] },
      {
        role: "user",
        content: "<medido-tras-editar>algo se sale [data-op-id=bm]</medido-tras-editar>",
        functionResponses: [{ name: "editar_pagina", response: { ok: true } }],
      },
    ]);
    expect(wire).toHaveLength(4);
    expect(wire[2].role).toBe("tool");
    expect(wire[3]).toEqual({
      role: "user",
      content: "<medido-tras-editar>algo se sale [data-op-id=bm]</medido-tras-editar>",
    });
  });

  it("y un content VACÍO no añade un mensaje: el turno normal sale como salía", () => {
    // La inmensa mayoría de las tandas no tienen nada que decir, y el bucle
    // empuja `content: ""`. Un mensaje de usuario vacío por cada tanda sería
    // ruido en cada turno del producto.
    const wire = messagesForFireworks([
      { role: "assistant", content: "voy", functionCalls: [{ name: "leer_estado", args: {} }] },
      { role: "user", content: "", functionResponses: [{ name: "leer_estado", response: { ok: true } }] },
    ]);
    expect(wire).toHaveLength(2);
    expect(wire[1].role).toBe("tool");
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

  // 🔴 H15 (01/10), como el arnés de DeepSeek: el razonamiento de cada paso
  // vuelve con SU mensaje del asistente, con llamadas o sin ellas.
  it("🔴 el razonamiento de cada paso viaja con su mensaje del asistente", () => {
    const wire = messagesForFireworks([
      { role: "user", content: "cambia la marca" },
      { role: "assistant", content: "voy", reasoning: "primero busco dónde sale", functionCalls: [{ name: "Grep", args: {} }] },
      { role: "user", content: "", functionResponses: [{ name: "Grep", response: { ok: true } }] },
      { role: "assistant", content: "listo", reasoning: "ya no queda ninguna" },
    ]);
    expect(wire[1]).toMatchObject({ role: "assistant", content: "voy", reasoning: "primero busco dónde sale" });
    expect(wire[3]).toEqual({ role: "assistant", content: "listo", reasoning: "ya no queda ninguna" });
  });

  it("un razonamiento vacío no añade campo", () => {
    const wire = messagesForFireworks([
      { role: "user", content: "hola" },
      { role: "assistant", content: "hola", reasoning: "" },
    ]);
    expect(wire[1]).toEqual({ role: "assistant", content: "hola" });
  });

  it("las imágenes de un mensaje de usuario viajan con él", () => {
    const foto = { mimeType: "image/jpeg", dataBase64: "AAAA" };
    const wire = messagesForFireworks([
      { role: "user", content: "mira", images: [foto] },
      { role: "assistant", content: "la vi" },
    ]);
    expect(wire[0]).toEqual({ role: "user", content: "mira", images: [foto] });
    expect(wire[1]).toEqual({ role: "assistant", content: "la vi" });
  });
});
