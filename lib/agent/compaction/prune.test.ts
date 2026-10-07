import { describe, expect, it } from "vitest";
import type { Message } from "@/lib/ai-gateway";

import { estimateMessageTokens, estimateTokens } from "./estimate";
import { PRUNE_MARKER, oversizedResults, pruneToolResults } from "./prune";

const grande = "a".repeat(4_096) + "MEDIO".repeat(1_000) + "z".repeat(1_024);
const resultado = (texto: string): Message => ({ role: "user", content: "", functionResponses: [{ name: "Read", response: { ok: true, tool_result: texto } }] });

describe("estimar", () => {
  it("cuenta caracteres / 3,5 de texto, razonamiento, llamadas y respuestas", () => {
    const m: Message = { role: "assistant", content: "x".repeat(35), reasoning: "y".repeat(35) };
    expect(estimateMessageTokens(m)).toBe(20);
  });

  it("cada foto cuenta 1.024", () => {
    const m: Message = { role: "user", content: "", images: [{ mimeType: "image/png", data: "" }] as never };
    expect(estimateMessageTokens(m)).toBe(1_024);
  });

  it("suma la lista", () => {
    expect(estimateTokens([{ role: "user", content: "x".repeat(7) }, { role: "user", content: "x".repeat(7) }])).toBe(4);
  });
});

describe("podar resultados grandes (la de DeepSeek)", () => {
  it("se queda con los primeros 4.096 + el aviso + los últimos 1.024", () => {
    const ms = [resultado(grande), { role: "user", content: "último" } as Message];
    const { messages, count } = pruneToolResults(ms, 1, new Map());
    const texto = messages[0]!.functionResponses![0]!.response.tool_result as string;
    expect(count).toBe(1);
    expect(texto).toBe("a".repeat(4_096) + PRUNE_MARKER + "z".repeat(1_024));
  });

  it("si hay fichero de recuperación, el aviso dice dónde", () => {
    const ms = [resultado(grande), { role: "user", content: "último" } as Message];
    const { messages } = pruneToolResults(ms, 1, new Map([["0:0", "/tmp/pruned/1-0-0.txt"]]));
    expect(messages[0]!.functionResponses![0]!.response.tool_result as string).toContain("the full result is in /tmp/pruned/1-0-0.txt");
  });

  it("BRAZO DE CONTROL: no toca lo que el modelo todavía no ha visto (desde protectFrom)", () => {
    const ms = [resultado(grande)];
    expect(pruneToolResults(ms, 0, new Map()).count).toBe(0);
    expect(oversizedResults(ms, 0)).toEqual([]);
  });

  it("BRAZO DE CONTROL: un resultado de 8.192 o menos se queda entero", () => {
    const ms = [resultado("b".repeat(8_192)), { role: "user", content: "x" } as Message];
    expect(pruneToolResults(ms, 1, new Map()).count).toBe(0);
  });

  it("lista lo que podaría con su clave, para guardar el fichero ANTES de podar", () => {
    const ms = [resultado(grande), { role: "user", content: "x" } as Message];
    expect(oversizedResults(ms, 1)).toEqual([{ key: "0:0", text: grande }]);
  });

  it("cuenta y corta por puntos de código, como DeepSeek: un emoji no se parte ni cuenta doble", () => {
    // 5.000 emojis son 10.000 unidades UTF-16 pero 5.000 puntos de código: caben.
    const ms = [resultado("😀".repeat(5_000)), { role: "user", content: "x" } as Message];
    expect(pruneToolResults(ms, 1, new Map()).count).toBe(0);
    const muchos = "😀".repeat(9_000);
    const { messages } = pruneToolResults([resultado(muchos), { role: "user", content: "x" } as Message], 1, new Map());
    expect(messages[0]!.functionResponses![0]!.response.tool_result as string).toBe("😀".repeat(4_096) + PRUNE_MARKER + "😀".repeat(1_024));
  });

  it("una respuesta que viaja como objeto se poda por el JSON que ve el modelo", () => {
    const respuesta = { ok: true, envios: Array.from({ length: 400 }, (_, i) => ({ id: i, mensaje: "hola ".repeat(10) })) };
    const json = JSON.stringify(respuesta);
    const ms: Message[] = [{ role: "user", content: "", functionResponses: [{ name: "list_form_submissions", response: respuesta }] }, { role: "user", content: "x" }];
    expect(oversizedResults(ms, 1)).toEqual([{ key: "0:0", text: json }]);
    const { messages, count } = pruneToolResults(ms, 1, new Map());
    expect(count).toBe(1);
    expect(messages[0]!.functionResponses![0]!.response).toEqual({ tool_result: json.slice(0, 4_096) + PRUNE_MARKER + json.slice(-1_024) });
  });
});
