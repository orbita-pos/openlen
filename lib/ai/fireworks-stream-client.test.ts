import { describe, expect, it, vi } from "vitest";

import { createFireworksStreamClient, type FireworksStreamEvent } from "./fireworks-stream-client";

const REQUEST = {
  messages: [{ role: "system" as const, content: "eres un editor" }, { role: "user" as const, content: "haz el hero azul" }],
  maxOutputTokens: 4096,
  temperature: 0.8,
  requestId: "project-1",
  operation: "page_edit" as const,
};

const chunk = (delta: Record<string, unknown>, finish: string | null = null) =>
  `data: ${JSON.stringify({ choices: [{ delta, ...(finish ? { finish_reason: finish } : {}) }] })}\n\n`;
const usageChunk = (input: number, output: number, reasoning = 0) =>
  `data: ${JSON.stringify({
    choices: [],
    usage: {
      prompt_tokens: input, completion_tokens: output, total_tokens: input + output,
      completion_tokens_details: { reasoning_tokens: reasoning },
    },
  })}\n\n`;

function client(body: string, init: ResponseInit = {}) {
  const fetchImpl = vi.fn(async () => new Response(body, { status: 200, ...init }));
  return {
    fetchImpl,
    client: createFireworksStreamClient({ apiKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch }),
  };
}

async function drain(events: AsyncIterableIterator<FireworksStreamEvent>): Promise<FireworksStreamEvent[]> {
  const out: FireworksStreamEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

describe("transporte de texto en streaming", () => {
  it("cede cada trozo en vez de esperar el turno entero", async () => {
    const { client: c } = client(
      chunk({ content: "pensando…" }) + chunk({ content: "---HTML---" }) + chunk({ content: "<edits>" }, "stop")
      + usageChunk(100, 20) + "data: [DONE]\n\n",
    );
    const events = await drain(c.stream(REQUEST));
    expect(events.filter((e) => e.type === "text_delta").map((e) => (e as { text: string }).text))
      .toEqual(["pensando…", "---HTML---", "<edits>"]);
    expect(events.at(-1)).toEqual({ type: "done", stopReason: { kind: "end_turn" } });
  });

  it("separa el pensamiento del modelo de su respuesta", async () => {
    const { client: c } = client(
      chunk({ reasoning_content: "el hero usa --accent" }) + chunk({ content: "<edits>" }, "stop") + "data: [DONE]\n\n",
    );
    const events = await drain(c.stream(REQUEST));
    expect(events[0]).toEqual({ type: "reasoning_delta", text: "el hero usa --accent" });
    expect(events[1]).toEqual({ type: "text_delta", text: "<edits>" });
  });

  it("reporta el gasto que el proveedor midió", async () => {
    const { client: c } = client(chunk({ content: "x" }, "stop") + usageChunk(1000, 300, 120) + "data: [DONE]\n\n");
    const events = await drain(c.stream(REQUEST));
    expect(events).toContainEqual({ type: "usage", inputTokens: 1000, outputTokens: 300, thinkingTokens: 120 });
  });

  it("distingue una respuesta truncada de una completa", async () => {
    const { client: c } = client(chunk({ content: "<!doctype html>" }, "length") + "data: [DONE]\n\n");
    const events = await drain(c.stream(REQUEST));
    expect(events.at(-1)).toEqual({ type: "done", stopReason: { kind: "max_tokens" } });
  });

  it("un stream que nunca dijo por qué terminó NO terminó", async () => {
    // Decir que sí entrega media página como si estuviera completa.
    const { client: c } = client(chunk({ content: "<!doctype html><html>" }));
    const events = await drain(c.stream(REQUEST));
    expect(events.at(-1)).toMatchObject({ type: "done", stopReason: { kind: "error" } });
  });

  it("conserva la razón real cuando el proveedor rechaza la petición", async () => {
    const fetchImpl = vi.fn(async () => new Response("model not found", { status: 404 }));
    const c = createFireworksStreamClient({ apiKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch });
    const events = await drain(c.stream(REQUEST));
    expect(events.at(-1)).toMatchObject({ type: "done", stopReason: { kind: "error", error: expect.stringContaining("model not found") } });
  });

  it("sin clave no llama a nadie", async () => {
    const fetchImpl = vi.fn();
    const c = createFireworksStreamClient({ apiKey: "  ", env: {}, fetchImpl: fetchImpl as unknown as typeof fetch });
    const events = await drain(c.stream(REQUEST));
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(events).toEqual([{ type: "done", stopReason: { kind: "error", error: "missing_key" } }]);
  });

  it("el modelo y el esfuerzo salen de la política, no de quien llama", async () => {
    const { client: c, fetchImpl } = client(chunk({ content: "x" }, "stop"));
    await drain(c.stream(REQUEST));
    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body.model).toContain("deepseek");
    expect(body.reasoning_effort).toBe("none");
    expect(body.stream).toBe(true);
    expect(body.max_tokens).toBe(4096);
    // La petición no puede nombrar un modelo: si pudiera, la tabla dejaría de
    // ser el único sitio donde se cambia de proveedor.
    expect(Object.keys(REQUEST)).not.toContain("model");
  });

  it("no inventa un final cuando el transporte se cae", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("socket hang up"); });
    const c = createFireworksStreamClient({ apiKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch });
    const events = await drain(c.stream(REQUEST));
    expect(events).toEqual([{ type: "done", stopReason: { kind: "error", error: "socket hang up" } }]);
  });
});
