// @vitest-environment node
// (the closing-call case drives the real stream client: Node's fetch needs Node's AbortSignal)
//
// THE AUDIT OF THE CACHE SUSPECTS (layer 1 of Len 3.1, spec local
// 2026-10-24-len-3-1-layers-0-1, §5.5), at $0: each suspect is built with the
// real code — the brain and the stream client against the fault server, the
// loop, buildAgentMessages, withPlanSection, plegarEquipo — and the requests
// are compared with `diffConsecutive`. Each verdict is pinned as it is TODAY;
// fix A7 changes them on purpose. The write-up: plans/len-3-1-pruebas/auditoria-sospechosos.md.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Message, StreamEvent } from "@/lib/ai-gateway";
import { createFireworksStreamClient, type WireBody } from "@/lib/ai/fireworks-stream-client";
import { _resetProviderWarnings } from "@/lib/ai/providers";
import { createAgentBrain, type BrainCall } from "@/lib/agent/brain";
import { buildAgentMessages } from "@/lib/agent/context";
import { messagesForFireworks } from "@/lib/agent/fireworks-bridge";
import { runAgentLoop } from "@/lib/agent/loop";
import { withPlanSection } from "@/lib/agent/plan-mode";
import { quienPide } from "@/lib/agent/equipo";
import { plegarEquipo } from "@/lib/agent/plegar-equipo";
import { _resetProviderHealth } from "@/lib/agent/provider-health";
import { checkReplay } from "@/lib/agent/testing/replay-invariant";
import { startFaultServer, type FaultServer } from "@/lib/agent/testing/llm-fault-server";
import { historialDesdeLaBase, type MensajeDelHistorial } from "@/lib/agent/transcripcion";
import { diffConsecutive } from "./request-diff";

const wire = (messages: readonly Message[], tools?: readonly Record<string, unknown>[]): WireBody => ({
  model: "m",
  messages: messagesForFireworks(messages) as unknown as Record<string, unknown>[],
  ...(tools ? { tools } : {}),
});

let server: FaultServer | null = null;
beforeEach(() => {
  _resetProviderHealth();
  _resetProviderWarnings();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  await server?.close();
  server = null;
});

function brainOn(s: FaultServer, calls: BrainCall[], extra: Partial<Parameters<typeof createAgentBrain>[0]> = {}) {
  return createAgentBrain({
    tools: [{ name: "Read", parameters: { type: "OBJECT", properties: { file_path: { type: "STRING" } } } }],
    requestId: "p1",
    env: { OPENLEN_AGENT_PROVIDERS: "deepinfra,fireworks", DEEPINFRA_API_KEY: "test", FIREWORKS_API_KEY: "test" },
    streamClientFor: (p) => createFireworksStreamClient({ endpoint: s.url(`/${p.id}`), apiKey: "test", modelId: p.modelId, affinityField: p.id === "deepinfra" ? "prompt_cache_key" : "user", effortStyle: p.id === "deepinfra" ? "word" : "budget" }),
    onCall: (c) => calls.push(c),
    ...extra,
  });
}

describe("cache suspects, pinned as they are today", () => {
  it("closeOut: the closing call sends no tools, so it shares no prefix with the loop's calls (A7)", async () => {
    server = await startFaultServer({
      "/deepinfra": [
        { kind: "ok", text: "", toolCalls: [{ name: "Read", arguments: '{"file_path":"/index.html"}' }] },
        { kind: "ok", text: "Cerrado por el tope." },
      ],
    });
    const calls: BrainCall[] = [];
    const brain = brainOn(server, calls);
    await runAgentLoop({
      messages: [{ role: "system", content: "s" }, { role: "user", content: "hola" }],
      tools: [],
      openStream: brain.openStream,
      closeOut: brain.closeOut,
      runTool: async () => ({ response: { ok: true, tool_result: "<h1>Hola</h1>" } }),
      emit: () => {},
      excedePresupuesto: (g) => g.inputTokens > 0,
    });
    expect(calls.map((c) => c.kind)).toEqual(["loop", "closeOut"]);
    const [loop, close] = calls.map((c) => c.wire!);
    expect(diffConsecutive(loop!, close!)).toMatchObject({ match: false, part: "tools" });
    // Without the tools, the closing call's messages do extend the loop's.
    expect(diffConsecutive({ ...loop!, tools: undefined }, close!)).toEqual({ match: true });
  });

  it("effort changed between turns: the messages still match; only reasoning_effort differs (provider-side, layer 0 will tell)", async () => {
    server = await startFaultServer({ "/deepinfra": [{ kind: "ok", text: "a" }, { kind: "ok", text: "b" }] });
    const calls: BrainCall[] = [];
    const messages: Message[] = [{ role: "system", content: "s" }, { role: "user", content: "hola" }];
    for (const effort of ["low", "high"] as const) {
      const brain = brainOn(server, calls, { esfuerzoDelTurno: effort });
      for await (const _ of brain.openStream(messages) as AsyncIterable<StreamEvent>) void _;
    }
    const [a, b] = calls.map((c) => c.wire!);
    expect(a!.reasoningEffort).not.toEqual(b!.reasoningEffort);
    expect(diffConsecutive(a!, b!)).toEqual({ match: true });
  });

  it("plan mode: entering or leaving it rewrites the system prompt (part system), as in DeepSeek", () => {
    const messages: Message[] = [{ role: "system", content: "base" }, { role: "user", content: "planea" }];
    expect(diffConsecutive(wire(withPlanSection(messages, false)), wire(withPlanSection(messages, true)))).toMatchObject({ match: false, part: "system", index: 0 });
    // Staying in plan mode keeps it identical.
    expect(diffConsecutive(wire(withPlanSection(messages, true)), wire(withPlanSection(messages, true)))).toEqual({ match: true });
  });

  it("reasoning pruned under pressure: the request is rewritten from the oldest message that loses its reasoning", () => {
    const history: MensajeDelHistorial[] = [];
    for (let i = 0; i < 6; i++) {
      history.push({ role: "user", content: `pide ${i}`, opensTurn: true });
      history.push({ role: "assistant", content: `hecho ${i}`, reasoning: "r".repeat(4_000) });
    }
    const roomy = buildAgentMessages({ state: {}, history, prompt: "otra", maxPromptTokens: 200_000 });
    if (!roomy.ok) throw new Error("no cupo");
    const contextChars = roomy.messages.reduce((n, m) => n + m.content.length + (m.reasoning?.length ?? 0), 0);
    // Room for everything but ~2 of the 6 reasonings.
    const tight = buildAgentMessages({ state: {}, history, prompt: "otra", maxPromptTokens: Math.ceil((contextChars - 8_500) / 3.5) });
    if (!tight.ok) throw new Error("no cupo apretado");
    // system, manual, then the history: index 3 is the first assistant message.
    expect(diffConsecutive(wire(roomy.messages), wire(tight.messages))).toMatchObject({ match: false, part: "messages", index: 3 });
  });

  it("screenshots: dropping old ones rewrites the turn's own request mid-turn, and the next turn loses all of them (images_dropped)", async () => {
    const shot = { mimeType: "image/png", dataBase64: "AAAA" };
    const requests: Message[][] = [];
    let step = 0;
    const initial: Message[] = [{ role: "system", content: "s" }, { role: "user", content: "mira" }];
    const result = await runAgentLoop({
      messages: initial,
      tools: [],
      openStream: (m) => {
        requests.push(structuredClone(m));
        const events: StreamEvent[] =
          step++ < 5 ? [{ type: "function_call", name: "view_page", args: { mode: "screenshot" } }, { type: "done", stopReason: { kind: "end_turn" } }] : [{ type: "text_delta", text: "Visto." }, { type: "done", stopReason: { kind: "end_turn" } }];
        return (async function* () {
          for (const e of events) yield e;
        })();
      },
      runTool: async () => ({ response: { ok: true, screenshot: "attached below" }, images: [shot] }),
      emit: () => {},
    });
    // Request 4 (after the 4th screenshot) no longer carries the 1st one's pixels.
    const inTurn = requests.slice(1).map((r, i) => diffConsecutive(wire(requests[i]!), wire(r)));
    expect(inTurn.slice(0, 3)).toEqual([{ match: true }, { match: true }, { match: true }]);
    expect(inTurn[3]).toMatchObject({ match: false, part: "messages" });
    // And across turns, the saved row keeps no screenshot at all.
    expect(checkReplay({ initialMessages: initial, lastRequest: requests.at(-1)!, transcript: result.transcripcion!, leidos: new Map() })).toMatchObject({ ok: false, cause: "images_dropped" });
  });

  it("team messages (plegarEquipo): the turn's request and its rebuilt history carry the same envelope", () => {
    const gente = [
      { userId: "u1", nombre: "Ana", rol: "dueno" as const },
      { userId: "u2", nombre: "Beto", rol: "editor" as const },
    ];
    const fila = (userText: string) => ({ userText, assistantReasoning: "", transcript: null });
    const persona = { tipo: "persona", autorId: "u2", menciones: [], createdAt: new Date(1), fila: fila("cambia el color") };
    // At the time of the turn: Beto's message is pending and goes before Ana's request.
    const ahora = plegarEquipo([persona as never], gente as never, "u1");
    // Next turn: that request is a row of the history.
    const despues = plegarEquipo([persona as never, { tipo: null, autorId: "u1", menciones: null, createdAt: new Date(2), fila: fila("hazlo") } as never], gente as never, "u1");
    expect(ahora.ahora).not.toBe("");
    // The route sends `${equipoAhora}${pideAhora}\n${prompt}`; the history rebuilds `${prefijoDelEquipo}${userText}`.
    expect(despues.filas[0]!.prefijoDelEquipo).toBe(`${ahora.ahora}${quienPide(gente[0]!)}\n`);
  });

  // FIXED (A7, like DeepSeek's `steering/message`): a correction is its own
  // message and the turn's opening message is never rewritten. The row's
  // userText still shows «↳ …» for the panel; the history rebuilds what was sent.
  it("a mid-turn correction: the next turn rebuilds your first message as it was sent, and the correction stays its own message", () => {
    const sent = "hazme la portada";
    const correction: Message = { role: "user", content: "[The user wrote while you were working] mejor en azul" };
    // What the route saves: the panel's userText, and the text that was sent.
    const [rebuilt, second] = historialDesdeLaBase([
      { userText: `${sent}\n↳ mejor en azul`, assistantReasoning: "", transcript: { mensajes: [correction], leidos: [], sentText: sent } },
    ]);
    expect(diffConsecutive(wire([{ role: "user", content: sent }, correction]), wire([rebuilt as Message, second as Message]))).toEqual({ match: true });
  });

  it("a provider fallback mid-turn sends the same messages to Fireworks (the miss is the other provider's cold cache, not a rewrite)", async () => {
    server = await startFaultServer({
      "/deepinfra": Array.from({ length: 4 }, () => ({ kind: "http" as const, status: 503 as const })),
      "/fireworks": [{ kind: "ok", text: "Hecho." }],
    });
    const calls: BrainCall[] = [];
    const brain = brainOn(server, calls);
    await runAgentLoop({
      messages: [{ role: "system", content: "s" }, { role: "user", content: "hola" }],
      tools: [],
      openStream: brain.openStream,
      runTool: async () => ({ response: { ok: true } }),
      emit: () => {},
      sleep: async () => {},
    });
    const di = calls.find((c) => c.provider === "deepinfra")!.wire!;
    const fw = calls.find((c) => c.provider === "fireworks")!.wire!;
    expect(di.model).not.toBe(fw.model);
    expect(diffConsecutive(di, fw)).toEqual({ match: true });
  });
});
