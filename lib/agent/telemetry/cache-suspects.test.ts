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
import { PLAN_POLICY, systemUpdateFor, withPlanSection } from "@/lib/agent/plan-mode";
import { quienPide } from "@/lib/agent/equipo";
import { plegarEquipo } from "@/lib/agent/plegar-equipo";
import { _resetProviderHealth } from "@/lib/agent/provider-health";
import { checkReplay } from "@/lib/agent/testing/replay-invariant";
import { startFaultServer, type FaultServer } from "@/lib/agent/testing/llm-fault-server";
import { historialDesdeLaBase, screenshotAddresses, transcripcionParaGuardar, type MensajeDelHistorial } from "@/lib/agent/transcripcion";
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

describe("cache suspects, pinned as they are today (A7: closeOut and screenshots in jumps; 14/11: no pruning of what was thought)", () => {
  // A7 (25/10): fixed. The closing call sends the SAME tools with tool_choice "none" — it still cannot
  // call one — so its prefix is the loop's. Before, it sent none: `part=tools`, the whole call uncached.
  it("closeOut: the closing call keeps the loop's tools (tool_choice none), so it shares the loop's prefix", async () => {
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
    expect(diffConsecutive(loop!, close!)).toEqual({ match: true });
    expect(close!.tools).toEqual(loop!.tools);
    expect([loop!.toolChoice, close!.toolChoice]).toEqual(["auto", "none"]);
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

  // FIXED (14/11, DeepSeek's in-history system prompt replacement, checked on both providers with the wire
  // probe): entering or leaving plan mode APPENDS the new prompt, whole, as a later system message. Before, it
  // rewrote message 0 (`part=system`) and the whole conversation was paid again on each change of mode.
  it("plan mode: entering or leaving it appends the prompt at the end; everything sent before still matches", () => {
    const messages: Message[] = [{ role: "system", content: "base" }, { role: "user", content: "planea" }];
    const entered = withPlanSection(messages, true);
    expect(diffConsecutive(wire(messages), wire(entered))).toEqual({ match: true });
    const left = withPlanSection([...entered, { role: "assistant", content: "plan" }], false);
    expect(diffConsecutive(wire(entered), wire(left))).toEqual({ match: true });
    // Staying in plan mode adds nothing.
    expect(withPlanSection(entered, true)).toEqual(entered);
    // With the lever off it is the rewrite of before, and it shows as a changed system prompt.
    const off = { OPENLEN_PLAN_IN_HISTORY: "0" };
    expect(diffConsecutive(wire(withPlanSection(messages, false, off)), wire(withPlanSection(messages, true, off)))).toMatchObject({ match: false, part: "system", index: 0 });
  });

  it("🔴 plan mode in a turn: the loop appends the prompt when the mode changes and keeps it where it was sent; the saved turn rebuilds the same bytes", async () => {
    let active = false;
    let step = 0;
    const requests: Message[][] = [];
    const initial: Message[] = [{ role: "system", content: "base" }, { role: "user", content: "planea y hazlo" }];
    const tools = ["enter_plan_mode", "exit_plan_mode", "Read"];
    const result = await runAgentLoop({
      messages: initial,
      tools: [],
      openStream: (m) => {
        requests.push(structuredClone(m));
        const name = tools[step++];
        const events: StreamEvent[] = name
          ? [{ type: "function_call", name, args: name === "Read" ? { file_path: "/index.html" } : {} }, { type: "done", stopReason: { kind: "end_turn" } }]
          : [{ type: "text_delta", text: "Hecho." }, { type: "done", stopReason: { kind: "end_turn" } }];
        return (async function* () {
          for (const e of events) yield e;
        })();
      },
      runTool: async (name) => {
        if (name === "enter_plan_mode") active = true;
        if (name === "exit_plan_mode") active = false;
        return { response: { ok: true } };
      },
      systemUpdate: (m) => systemUpdateFor(m, active),
      emit: () => {},
    });
    expect(requests).toHaveLength(4);
    // Nothing sent before is ever rewritten: each request extends the one before it.
    for (let i = 1; i < requests.length; i++) expect(diffConsecutive(wire(requests[i - 1]!), wire(requests[i]!))).toEqual({ match: true });
    const systems = (r: Message[]) => r.flatMap((m, i) => (m.role === "system" ? [`${i}:${m.content === "base" ? "base" : m.content === `base\n\n${PLAN_POLICY}` ? "plan" : "?"}`] : []));
    expect(systems(requests[0]!)).toEqual(["0:base"]);
    // After entering: the plan prompt, whole, right behind the tool's result.
    expect(systems(requests[1]!)).toEqual(["0:base", "4:plan"]);
    // After leaving: the base prompt again as the latest; the plan one stays where it was.
    expect(systems(requests[2]!)).toEqual(["0:base", "4:plan", "7:base"]);
    // And with no change of mode, nothing more.
    expect(systems(requests[3]!)).toEqual(["0:base", "4:plan", "7:base"]);
    // What the row keeps is which prompt it was, never its text.
    const saved = transcripcionParaGuardar(result.transcripcion!, new Map());
    expect(saved.mensajes.filter((m) => m.role === "system")).toEqual([
      { role: "system", content: "", systemUpdate: "plan" },
      { role: "system", content: "", systemUpdate: "default" },
    ]);
    expect(JSON.stringify(saved)).not.toContain("PLAN MODE");
    // And the next turn rebuilds, byte for byte, what this one sent.
    expect(checkReplay({ initialMessages: initial, lastRequest: requests.at(-1)!, transcript: result.transcripcion!, leidos: new Map() })).toEqual({ ok: true });
  });

  it("a system message without the marker — nothing the loop ever saved — still has no place in a rebuilt history", () => {
    const [first, ...rest] = historialDesdeLaBase([
      { userText: "hola", assistantReasoning: "", transcript: { mensajes: [{ role: "system", content: "viejo" }, { role: "assistant", content: "hecho" }], leidos: [] } },
    ]);
    expect(first).toMatchObject({ role: "user", content: "hola" });
    expect(rest).toEqual([{ role: "assistant", content: "hecho" }]);
  });

  // FIXED (14/11, as DeepSeek's harness and Claude Code: neither prunes what was thought to fit, both
  // compact). Before, a history over the ceiling lost its oldest reasoning — the request was rewritten from
  // the first assistant message — right before a compaction that would have read it from the cache.
  it("over the ceiling nothing is pruned: the request keeps every byte and the turn compacts first", () => {
    const history: MensajeDelHistorial[] = [];
    for (let i = 0; i < 6; i++) {
      history.push({ role: "user", content: `pide ${i}`, opensTurn: true });
      history.push({ role: "assistant", content: `hecho ${i}`, reasoning: "r".repeat(4_000) });
    }
    const roomy = buildAgentMessages({ state: {}, history, prompt: "otra", maxPromptTokens: 200_000 });
    if (!roomy.ok) throw new Error("no cupo");
    expect(roomy.compactFirst).toBeUndefined();
    const contextChars = roomy.messages.reduce((n, m) => n + m.content.length + (m.reasoning?.length ?? 0), 0);
    const tight = buildAgentMessages({ state: {}, history, prompt: "otra", maxPromptTokens: Math.ceil((contextChars - 8_500) / 3.5) });
    if (!tight.ok) throw new Error("no cupo apretado");
    expect(tight.compactFirst).toBe(true);
    expect(diffConsecutive(wire(roomy.messages), wire(tight.messages))).toEqual({ match: true });
  });

  // FIXED (14/11, as Claude Code and DeepSeek keep images): screenshots stay where they were sent, in the turn
  // and in the turns after it. Before, past three, every batch but the newest lost its pixels (in jumps since
  // A7), and the saved row kept none: the next turn paid again from the first screenshot of the one before.
  // Now the row keeps each picture's stored address and the next turn sends the same bytes.
  it("🔴 screenshots across turns: the row keeps their addresses, never their pixels, and the next turn sends the same pictures", async () => {
    const requests: Message[][] = [];
    const stored = new Map<string, { mimeType: string; dataBase64: string }>();
    let step = 0;
    const initial: Message[] = [{ role: "system", content: "s" }, { role: "user", content: "mira" }];
    const result = await runAgentLoop({
      messages: initial,
      tools: [],
      openStream: (m) => {
        requests.push(structuredClone(m));
        const events: StreamEvent[] =
          step++ < 3 ? [{ type: "function_call", name: "view_page", args: { mode: "screenshot" } }, { type: "done", stopReason: { kind: "end_turn" } }] : [{ type: "text_delta", text: "Visto." }, { type: "done", stopReason: { kind: "end_turn" } }];
        return (async function* () {
          for (const e of events) yield e;
        })();
      },
      runTool: async () => ({ response: { ok: true, screenshot: "attached below" }, images: [{ mimeType: "image/jpeg", dataBase64: `PIXELS${step}` }] }),
      // What the route's `storeStepScreenshots` does: each picture stored, its address given back in order.
      storeScreenshots: async (images) =>
        images.map((image) => {
          const url = `https://files.example/uploads/p1/screenshot-${stored.size + 1}.jpg`;
          stored.set(url, { ...image });
          return url;
        }),
      emit: () => {},
    });
    const saved = transcripcionParaGuardar(result.transcripcion!, new Map());
    const withPictures = saved.mensajes.filter((m) => m.screenshots?.length);
    expect(withPictures.map((m) => m.screenshots)).toEqual([...stored.keys()].map((url) => [url]));
    expect(JSON.stringify(saved)).not.toContain("PIXELS");
    // What the next turn has to load: exactly those.
    const rows = [{ userText: "mira", assistantReasoning: "", transcript: saved }];
    expect(screenshotAddresses(historialDesdeLaBase(rows))).toEqual([...stored.keys()]);
    // With them loaded, the turn replays byte for byte: no allowance for dropped images.
    expect(checkReplay({ initialMessages: initial, lastRequest: requests.at(-1)!, transcript: result.transcripcion!, leidos: new Map(), photos: stored })).toEqual({ ok: true });
  });

  it("a stored screenshot that cannot be loaded: its message says they were dropped, the others keep theirs", () => {
    const shot = (n: number): Message => ({ role: "user", content: `Screenshots below ${n}`, functionResponses: [{ name: "view_page", response: { ok: true } }], screenshots: [`https://files.example/${n}.jpg`] });
    const rows = [{ userText: "mira", assistantReasoning: "", transcript: { mensajes: [{ role: "assistant" as const, content: "" }, shot(1), { role: "assistant" as const, content: "" }, shot(2)], leidos: [] } }];
    const pixels = { mimeType: "image/jpeg", dataBase64: "AAAA" };
    const history = historialDesdeLaBase(rows, undefined, new Map([["https://files.example/1.jpg", null], ["https://files.example/2.jpg", pixels]]));
    const [, , first, , second] = history;
    expect(first).toMatchObject({ screenshotsDropped: 1 });
    expect(first!.images).toBeUndefined();
    expect(first!.content).toMatch(/^Screenshots below 1\n\n\(The screenshots that were here were dropped/);
    expect(second!.images).toEqual([pixels]);
    expect(second!.screenshotsDropped).toBeUndefined();
    // Nobody asked for the pictures (a reader that is not the model): the addresses stay, nothing is said.
    const unread = historialDesdeLaBase(rows);
    expect(unread[2]).toMatchObject({ content: "Screenshots below 1", screenshots: ["https://files.example/1.jpg"] });
    expect(unread[2]!.images).toBeUndefined();
  });

  it("the forty-screenshot budget holds across turns: a later turn drops the same oldest twenty, whatever was loaded", () => {
    const shot = (n: number): Message => ({ role: "user", content: "", functionResponses: [{ name: "view_page", response: { ok: true } }], screenshots: [`https://files.example/${n}.jpg`] });
    const row = (from: number, count: number) => ({ userText: "mira", assistantReasoning: "", transcript: { mensajes: Array.from({ length: count }, (_, i) => shot(from + i)), leidos: [] } });
    const history = historialDesdeLaBase([row(1, 30), row(31, 11)]);
    expect(screenshotAddresses(history)).toEqual(Array.from({ length: 21 }, (_, i) => `https://files.example/${21 + i}.jpg`));
    expect(history.filter((m) => m.screenshotsDropped === 1)).toHaveLength(20);
  });

  it("screenshots: a turn that looks eight times rewrites nothing; without stored addresses the next turn still loses them", async () => {
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
          step++ < 8 ? [{ type: "function_call", name: "view_page", args: { mode: "screenshot" } }, { type: "done", stopReason: { kind: "end_turn" } }] : [{ type: "text_delta", text: "Visto." }, { type: "done", stopReason: { kind: "end_turn" } }];
        return (async function* () {
          for (const e of events) yield e;
        })();
      },
      runTool: async () => ({ response: { ok: true, screenshot: "attached below" }, images: [shot] }),
      emit: () => {},
    });
    const inTurn = requests.slice(1).map((r, i) => diffConsecutive(wire(requests[i]!), wire(r)).match);
    expect(inTurn).toEqual([true, true, true, true, true, true, true, true]);
    expect(requests.at(-1)!.reduce((n, m) => n + (m.images?.length ?? 0), 0)).toBe(8);
    // And across turns, the saved row keeps no screenshot at all.
    expect(checkReplay({ initialMessages: initial, lastRequest: requests.at(-1)!, transcript: result.transcripcion!, leidos: new Map() })).toMatchObject({ ok: false, cause: "images_dropped" });
  });

  it("screenshots: past forty in a conversation the oldest twenty go at once — one break, not one per look", async () => {
    const shot = { mimeType: "image/png", dataBase64: "AAAA" };
    const requests: Message[][] = [];
    let step = 0;
    await runAgentLoop({
      messages: [{ role: "system", content: "s" }, { role: "user", content: "mira" }],
      tools: [],
      openStream: (m) => {
        requests.push(structuredClone(m));
        const events: StreamEvent[] =
          step++ < 45 ? [{ type: "function_call", name: "view_page", args: { mode: "screenshot" } }, { type: "done", stopReason: { kind: "end_turn" } }] : [{ type: "text_delta", text: "Visto." }, { type: "done", stopReason: { kind: "end_turn" } }];
        return (async function* () {
          for (const e of events) yield e;
        })();
      },
      runTool: async () => ({ response: { ok: true, screenshot: "attached below" }, images: [shot] }),
      emit: () => {},
      maxTurns: 100,
    });
    const breaks = requests.slice(1).flatMap((r, i) => (diffConsecutive(wire(requests[i]!), wire(r)).match ? [] : [i + 1]));
    // The request after the 41st screenshot is the only one that does not extend the one before it.
    expect(breaks).toEqual([41]);
    expect(Math.max(...requests.map((r) => r.reduce((n, m) => n + (m.images?.length ?? 0), 0)))).toBe(40);
    expect(requests.at(-1)!.reduce((n, m) => n + (m.images?.length ?? 0), 0)).toBe(25);
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
