import { describe, expect, it, vi } from "vitest";
import type { Message } from "@/lib/ai-gateway";

import { compactIfNeeded } from "./compact";
import { COMPACTION_INSTRUCTION, SUMMARY_OPEN_TAG } from "./summary-prompt";

const policy = { thresholdTokens: 100, retainTokens: 20 };
const largo = (n: number): Message[] => [
  { role: "system", content: "s" }, { role: "user", content: "manual" },
  ...Array.from({ length: n }, (_, i): Message => ({ role: i % 2 ? "assistant" : "user", content: "x".repeat(70) })),
];

describe("compactIfNeeded", () => {
  it("BRAZO DE CONTROL: por debajo del umbral no hace nada ni llama al modelo", async () => {
    const summarize = vi.fn();
    const out = await compactIfNeeded({ messages: largo(4), firstIndex: 2, pressureTokens: 99, policy, trigger: "pressure", summarize });
    expect(out.changed).toBe(false);
    expect(summarize).not.toHaveBeenCalled();
  });

  it("por encima, resume lo más viejo con la instrucción de DeepSeek y deja la cola", async () => {
    const summarize = vi.fn(async (req: Message[]) => {
      expect(req.at(-1)?.content).toBe(COMPACTION_INSTRUCTION);
      return "## Primary Request and Intent\n- pide cosas";
    });
    const ms = largo(10);
    const out = await compactIfNeeded({ messages: ms, firstIndex: 2, pressureTokens: 400, policy, trigger: "pressure", summarize });
    expect(out.summarized).toBe(true);
    expect(out.messages[2]!.content).toContain(SUMMARY_OPEN_TAG);
    expect(out.messages.at(-1)).toEqual(ms.at(-1));
    expect(out.messages.slice(0, 2)).toEqual(ms.slice(0, 2));
  });

  it("si podar basta, no llama al modelo", async () => {
    const enorme = "a".repeat(200_000);
    const ms: Message[] = [
      { role: "system", content: "s" }, { role: "user", content: "manual" },
      { role: "assistant", content: "", functionCalls: [{ name: "Read", args: {} }] },
      { role: "user", content: "", functionResponses: [{ name: "Read", response: { ok: true, tool_result: enorme } }] },
      { role: "user", content: "sigue" },
    ];
    const summarize = vi.fn();
    const out = await compactIfNeeded({ messages: ms, firstIndex: 2, pressureTokens: 57_200, policy: { thresholdTokens: 50_000, retainTokens: 10 }, trigger: "pressure", summarize });
    expect(out.pruned).toBe(1);
    expect(out.summarized).toBe(false);
    expect(summarize).not.toHaveBeenCalled();
  });

  it("guarda el fichero de recuperación ANTES de podar y el aviso lo nombra", async () => {
    const ms: Message[] = [
      { role: "system", content: "s" }, { role: "user", content: "manual" },
      { role: "assistant", content: "", functionCalls: [{ name: "Read", args: {} }] },
      { role: "user", content: "", functionResponses: [{ name: "Read", response: { ok: true, tool_result: "a".repeat(20_000) } }] },
      { role: "user", content: "sigue" },
    ];
    const guardados: string[] = [];
    const out = await compactIfNeeded({
      messages: ms, firstIndex: 2, pressureTokens: 6_000, policy: { thresholdTokens: 5_000, retainTokens: 10 }, trigger: "pressure",
      summarize: vi.fn(), saveRecovery: async (path) => { guardados.push(path); return true; },
    });
    expect(guardados).toHaveLength(1);
    expect(out.messages[3]!.functionResponses![0]!.response.tool_result as string).toContain(guardados[0]!);
  });

  it("si el fichero no se pudo guardar, el aviso no nombra ninguno", async () => {
    const ms: Message[] = [
      { role: "system", content: "s" }, { role: "user", content: "manual" },
      { role: "user", content: "", functionResponses: [{ name: "Read", response: { ok: true, tool_result: "a".repeat(20_000) } }] },
      { role: "user", content: "sigue" },
    ];
    const out = await compactIfNeeded({
      messages: ms, firstIndex: 2, pressureTokens: 6_000, policy: { thresholdTokens: 5_000, retainTokens: 10 }, trigger: "pressure",
      summarize: vi.fn(), saveRecovery: async () => false,
    });
    expect(out.messages[2]!.functionResponses![0]!.response.tool_result as string).not.toContain("/tmp/pruned");
  });

  it("🔴 si guardar el fichero LANZA (la terminal se reinició), se poda igual, sin ruta, y no se lleva el turno por delante", async () => {
    const ms: Message[] = [
      { role: "system", content: "s" }, { role: "user", content: "manual" },
      { role: "user", content: "", functionResponses: [{ name: "Read", response: { ok: true, tool_result: "a".repeat(20_000) } }] },
      { role: "user", content: "sigue" },
    ];
    const out = await compactIfNeeded({
      messages: ms, firstIndex: 2, pressureTokens: 6_000, policy: { thresholdTokens: 5_000, retainTokens: 10 }, trigger: "pressure",
      summarize: vi.fn(), saveRecovery: async () => { throw new Error("worker terminated"); },
    });
    expect(out.pruned).toBe(1);
    expect(out.messages[2]!.functionResponses![0]!.response.tool_result as string).not.toContain("/tmp/pruned");
  });

  it("protectFrom: lo que el modelo aún no vio no se poda, aunque no sea el último mensaje", async () => {
    // Las respuestas de la vuelta y, detrás, la corrección del dueño: las dos sin ver.
    const ms: Message[] = [
      { role: "system", content: "s" }, { role: "user", content: "manual" },
      { role: "assistant", content: "", functionCalls: [{ name: "Read", args: {} }] },
      { role: "user", content: "", functionResponses: [{ name: "Read", response: { ok: true, tool_result: "a".repeat(20_000) } }] },
      { role: "user", content: "[corrección] mejor en azul" },
    ];
    const out = await compactIfNeeded({
      messages: ms, firstIndex: 2, pressureTokens: 6_000, policy: { thresholdTokens: 5_000, retainTokens: 10 }, trigger: "pressure",
      protectFrom: 3, summarize: async () => null,
    });
    expect(out.pruned).toBe(0);
  });

  it("un resumen que no encoge se rechaza (DeepSeek)", async () => {
    const out = await compactIfNeeded({
      messages: largo(10), firstIndex: 2, pressureTokens: 400, policy, trigger: "pressure",
      summarize: async () => "y".repeat(10_000),
    });
    expect(out.summarized).toBe(false);
  });

  it("si el modelo no devuelve resumen (null), sigue sin resumen", async () => {
    const out = await compactIfNeeded({ messages: largo(10), firstIndex: 2, pressureTokens: 400, policy, trigger: "pressure", summarize: async () => null });
    expect(out.summarized).toBe(false);
  });

  // A11: como el `compact_ptl_retry` de Claude Code. Sólo si la petición del
  // resumen tampoco cabe: un reintento sin la mitad más vieja del tramo y, en su
  // lugar, su marcador literal.
  it("🔴 A11: si el resumen no cabe, UN reintento con el marcador de Claude Code y sin la mitad más vieja", async () => {
    const peticiones: Message[][] = [];
    const respuestas: (string | null | "too_long")[] = ["too_long", "r"];
    const out = await compactIfNeeded({
      messages: largo(10), firstIndex: 2, pressureTokens: 400, policy, trigger: "pressure",
      summarize: async (m) => (peticiones.push(m), respuestas.shift()!),
    });
    expect(out.summarized).toBe(true);
    expect(peticiones).toHaveLength(2);
    expect(peticiones[1]![2]).toEqual({ role: "user", content: "[earlier conversation truncated for compaction retry]" });
    expect(peticiones[1]!.length).toBeLessThan(peticiones[0]!.length);
    expect(peticiones[1]!.at(-1)!.content).toBe(COMPACTION_INSTRUCTION);
  });

  it("A11: si el resumen falla por otra cosa (null), no se reintenta", async () => {
    const summarize = vi.fn(async () => null);
    await compactIfNeeded({ messages: largo(10), firstIndex: 2, pressureTokens: 400, policy, trigger: "pressure", summarize });
    expect(summarize).toHaveBeenCalledTimes(1);
  });

  // A11: qué ficheros vuelven tras resumir (como `Clr` de Claude Code): los
  // leídos en lo resumido, del más reciente al más viejo, sin los que siguen leídos en lo conservado.
  it("🔴 A11: readPaths son los Read del tramo resumido, del más reciente, sin repetir ni los del tramo conservado", async () => {
    const leer = (ruta: string): Message[] => [
      { role: "assistant", content: "", functionCalls: [{ name: "Read", args: { file_path: ruta } }] },
      { role: "user", content: "", functionResponses: [{ name: "Read", response: { ok: true, tool_result: "x".repeat(70) } }] },
    ];
    const ms: Message[] = [
      { role: "system", content: "s" }, { role: "user", content: "manual" },
      ...leer("/a"), ...leer("/b"), ...leer("/a"), ...leer("/c"),
      ...Array.from({ length: 6 }, (_, i): Message => ({ role: i % 2 ? "assistant" : "user", content: "x".repeat(70) })),
      ...leer("/c"),
    ];
    const out = await compactIfNeeded({ messages: ms, firstIndex: 2, pressureTokens: 400, policy: { thresholdTokens: 100, retainTokens: 60 }, trigger: "pressure", summarize: async () => "r" });
    expect(out.summarized).toBe(true);
    expect(out.readPaths).toEqual(["/a", "/b"]);
  });

  it("un desborde compacta aunque la presión estimada sea baja, y deja sólo la unidad más nueva", async () => {
    const ms = largo(10);
    const out = await compactIfNeeded({ messages: ms, firstIndex: 2, pressureTokens: 0, policy, trigger: "overflow", summarize: async () => "r" });
    expect(out.summarized).toBe(true);
    expect(out.messages).toHaveLength(4);
    expect(out.messages.at(-1)).toEqual(ms.at(-1));
  });
});
