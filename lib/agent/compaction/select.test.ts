import { describe, expect, it } from "vitest";
import type { Message } from "@/lib/ai-gateway";

import { selectSpan } from "./select";

const u = (content: string): Message => ({ role: "user", content });
const a = (content: string): Message => ({ role: "assistant", content });
const llama = (): Message => ({ role: "assistant", content: "", functionCalls: [{ name: "Read", args: {} }] });
const responde = (): Message => ({ role: "user", content: "", functionResponses: [{ name: "Read", response: { ok: true } }] });
const unoCadaUno = () => 1;

describe("el tramo a resumir", () => {
  const base = [{ role: "system", content: "s" } as Message, u("manual"), u("pide"), a("vale"), u("otra"), a("hecho"), u("y ahora")];

  it("va de firstIndex hasta antes de la cola literal", () => {
    expect(selectSpan(base, { firstIndex: 2, retainTokens: 2, estimate: unoCadaUno })).toEqual({ start: 2, end: 5 });
  });

  it("nunca empieza la cola en una respuesta: se lleva también su llamada", () => {
    const ms = [{ role: "system", content: "s" } as Message, u("manual"), u("pide"), a("vale"), llama(), responde(), u("sigue")];
    // Con cola de 2 caería en `responde`: retrocede a `llama`.
    expect(selectSpan(ms, { firstIndex: 2, retainTokens: 2, estimate: unoCadaUno })).toEqual({ start: 2, end: 4 });
  });

  it("con cola 0 (desborde) deja sólo la unidad más nueva", () => {
    expect(selectSpan(base, { firstIndex: 2, retainTokens: 0, estimate: unoCadaUno })).toEqual({ start: 2, end: 6 });
  });

  it("con cola 0 y la última una respuesta, la unidad más nueva es la llamada con su respuesta", () => {
    const ms = [{ role: "system", content: "s" } as Message, u("manual"), u("pide"), a("vale"), llama(), responde()];
    expect(selectSpan(ms, { firstIndex: 2, retainTokens: 0, estimate: unoCadaUno })).toEqual({ start: 2, end: 4 });
  });

  it("un solo mensaje viejo también es un tramo, como en DeepSeek (si el resumen no encoge, lo rechaza quien resume)", () => {
    const corto = [{ role: "system", content: "s" } as Message, u("manual"), u("pide"), a("vale")];
    expect(selectSpan(corto, { firstIndex: 2, retainTokens: 1, estimate: unoCadaUno })).toEqual({ start: 2, end: 3 });
  });

  it("BRAZO DE CONTROL: si no hay nada antes de la cola, no hay tramo", () => {
    const corto = [{ role: "system", content: "s" } as Message, u("manual"), u("pide")];
    expect(selectSpan(corto, { firstIndex: 2, retainTokens: 1, estimate: unoCadaUno })).toBeNull();
    // Ni cuando la única unidad es una llamada con su respuesta.
    const par = [{ role: "system", content: "s" } as Message, u("manual"), llama(), responde()];
    expect(selectSpan(par, { firstIndex: 2, retainTokens: 0, estimate: unoCadaUno })).toBeNull();
  });

  it("BRAZO DE CONTROL: nunca toca lo anterior a firstIndex (sistema y manual)", () => {
    const span = selectSpan(base, { firstIndex: 2, retainTokens: 0, estimate: unoCadaUno })!;
    expect(span.start).toBe(2);
  });

  it("si el historial empieza en una respuesta suelta, el tramo no la separa de nada: empieza después", () => {
    const ms = [{ role: "system", content: "s" } as Message, u("manual"), responde(), u("pide"), a("vale"), u("otra")];
    expect(selectSpan(ms, { firstIndex: 2, retainTokens: 1, estimate: unoCadaUno })).toEqual({ start: 3, end: 5 });
  });
});
