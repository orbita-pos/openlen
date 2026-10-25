import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Message, StreamEvent } from "@/lib/ai-gateway";
import type { FireworksStreamClient, FireworksStreamEvent, FireworksStreamRequest } from "@/lib/ai/fireworks-stream-client";
import { _resetProviderWarnings, type ProviderId, type ResolvedProvider } from "@/lib/ai/providers";
import { FIRST_EVENT_TIMEOUT_MS, RETRIES_BEFORE_FALLBACK, createAgentBrain } from "./brain";
import { _resetProviderHealth, coolDown, isCooling } from "./provider-health";

const TOOLS = [{ name: "Read", parameters: { type: "OBJECT", properties: {} } }];
const USER: Message = { role: "user", content: "haz el hero azul" };
const ENV = { DEEPINFRA_API_KEY: "di", FIREWORKS_API_KEY: "fw" };
const DI_MODEL = "deepseek-ai/DeepSeek-V4.1-Flash-1017";
const FW_MODEL = "accounts/fireworks/models/deepseek-v4p1-flash-1017";

type Script = FireworksStreamEvent[] | "hang";

const end: FireworksStreamEvent = { type: "done", stopReason: { kind: "end_turn" } };
const usage = (inputTokens: number, cachedTokens: number, outputTokens: number): FireworksStreamEvent => ({
  type: "usage",
  inputTokens,
  cachedTokens,
  outputTokens,
  thinkingTokens: 0,
});
const httpError = (httpStatus: number): FireworksStreamEvent => ({
  type: "done",
  stopReason: { kind: "error", error: `http_${httpStatus}`, httpStatus },
});
const coded = (code: "server" | "context_window_exceeded"): FireworksStreamEvent => ({
  type: "done",
  stopReason: { kind: "error", error: code, code },
});

/** One script list per provider; the last script repeats. */
function fakes(scripts: Partial<Record<ProviderId, Script[]>>) {
  const calls: { provider: ProviderId; request: FireworksStreamRequest }[] = [];
  const streamClientFor = (p: ResolvedProvider): FireworksStreamClient => ({
    modelId: p.modelId,
    async *stream(request, opts) {
      calls.push({ provider: p.id, request });
      const list = scripts[p.id] ?? [[end]];
      const script = list.length > 1 ? list.shift()! : list[0]!;
      if (script === "hang") {
        await new Promise<void>((resolve) => {
          if (opts?.signal?.aborted) resolve();
          opts?.signal?.addEventListener("abort", () => resolve(), { once: true });
        });
        yield { type: "done", stopReason: { kind: "cancelled" } };
        return;
      }
      for (const e of script) yield e;
    },
  });
  return { calls, streamClientFor };
}

async function drain(iterable: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const e of iterable) out.push(e);
  return out;
}

const lastDone = (events: StreamEvent[]) =>
  (events.at(-1) as Extract<StreamEvent, { type: "done" }>).stopReason as Record<string, unknown>;

beforeEach(() => {
  _resetProviderHealth();
  _resetProviderWarnings();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("Len's brain and its providers", () => {
  it("starts on the preferred provider if enabled, else the first", async () => {
    const a = fakes({});
    const preferFireworks = createAgentBrain({ tools: TOOLS, requestId: "p1", env: ENV, preferredProvider: "fireworks", streamClientFor: a.streamClientFor });
    await drain(preferFireworks.openStream([USER]));
    expect(a.calls.map((c) => c.provider)).toEqual(["fireworks"]);
    expect(preferFireworks.modelId).toBe(FW_MODEL);
    expect(preferFireworks.firstProvider()).toBe("fireworks");

    const b = fakes({});
    const offPreferred = createAgentBrain({
      tools: TOOLS,
      requestId: "p1",
      env: { ...ENV, OPENLEN_AGENT_PROVIDERS: "fireworks" },
      preferredProvider: "deepinfra",
      streamClientFor: b.streamClientFor,
    });
    await drain(offPreferred.openStream([USER]));
    expect(b.calls.map((c) => c.provider)).toEqual(["fireworks"]);

    const c = fakes({});
    const noPreference = createAgentBrain({ tools: TOOLS, requestId: "p1", env: ENV, preferredProvider: null, streamClientFor: c.streamClientFor });
    await drain(noPreference.openStream([USER]));
    await drain(noPreference.closeOut([USER]));
    expect(c.calls.map((x) => x.provider)).toEqual(["deepinfra", "deepinfra"]);
    expect(noPreference.modelId).toBe(DI_MODEL);
  });

  it("skips a cooling provider", async () => {
    coolDown("deepinfra", Date.now());
    const f = fakes({});
    const brain = createAgentBrain({ tools: TOOLS, requestId: "p1", env: ENV, preferredProvider: "deepinfra", streamClientFor: f.streamClientFor });
    await drain(brain.openStream([USER]));
    expect(f.calls.map((c) => c.provider)).toEqual(["fireworks"]);
  });

  it("the providers option restricts the list (an operation pinned to one provider)", async () => {
    const f = fakes({});
    const brain = createAgentBrain({ tools: TOOLS, requestId: "p1", env: ENV, providers: ["fireworks"], streamClientFor: f.streamClientFor });
    await drain(brain.openStream([USER]));
    expect(f.calls.map((c) => c.provider)).toEqual(["fireworks"]);
  });

  // Medido el 17/10 (35 + 21 llamadas, .superpowers/spikes/effort-probe.ts): con un
  // encargo que pide pensar, `low` en DeepInfra piensa ~40 % menos que su auto
  // (2.916 frente a 4.916 tokens), lo mismo o menos que `low` en Fireworks (3.889),
  // y cuesta ~3 veces menos. La medición del 16/10 (una llamada por nivel) decía
  // que la palabra no recortaba: era ruido. Jesús: low y medium, a DeepInfra.
  it("a low or medium turn starts on DeepInfra like any other", async () => {
    const f = fakes({});
    const brain = createAgentBrain({ tools: TOOLS, requestId: "p1", env: ENV, esfuerzoDelTurno: "low", streamClientFor: f.streamClientFor });
    await drain(brain.openStream([USER]));
    expect(f.calls.map((c) => c.provider)).toEqual(["deepinfra"]);
    expect(f.calls[0]!.request.esfuerzo).toBe("low");

    const m = fakes({});
    const medium = createAgentBrain({ tools: TOOLS, requestId: "p1", env: ENV, esfuerzoDelTurno: "medium", streamClientFor: m.streamClientFor });
    await drain(medium.openStream([USER]));
    expect(m.calls.map((c) => c.provider)).toEqual(["deepinfra"]);

    const only = fakes({});
    const deepinfraOnly = createAgentBrain({
      tools: TOOLS,
      requestId: "p1",
      env: { ...ENV, OPENLEN_AGENT_PROVIDERS: "deepinfra" },
      esfuerzoDelTurno: "medium",
      streamClientFor: only.streamClientFor,
    });
    await drain(deepinfraOnly.openStream([USER]));
    expect(only.calls.map((c) => c.provider)).toEqual(["deepinfra"]);
  });

  it("a 4xx without code switches at once and asks the loop to retry", async () => {
    const f = fakes({ deepinfra: [[httpError(400)]], fireworks: [[{ type: "text_delta", text: "ok" }, usage(10, 0, 2), end]] });
    const brain = createAgentBrain({ tools: TOOLS, requestId: "p1", env: ENV, streamClientFor: f.streamClientFor });
    const first = await drain(brain.openStream([USER]));
    expect(lastDone(first)).toMatchObject({ kind: "error", code: "server", switchedProvider: true });
    const second = await drain(brain.openStream([USER]));
    expect(lastDone(second)).toEqual({ kind: "end_turn" });
    expect(f.calls.map((c) => c.provider)).toEqual(["deepinfra", "fireworks"]);
    expect(brain.fellBack()).toBe(true);
    expect(brain.firstProvider()).toBe("deepinfra");
    expect(brain.lastProvider()).toBe("fireworks");
  });

  it("a retryable error switches only after 4 failures", async () => {
    expect(RETRIES_BEFORE_FALLBACK).toBe(4);
    const f = fakes({ deepinfra: [[coded("server")]] });
    const brain = createAgentBrain({ tools: TOOLS, requestId: "p1", env: ENV, streamClientFor: f.streamClientFor });
    const stops: Record<string, unknown>[] = [];
    for (let i = 0; i < 4; i++) stops.push(lastDone(await drain(brain.openStream([USER]))));
    expect(stops.slice(0, 3).every((s) => s.code === "server" && s.switchedProvider === undefined)).toBe(true);
    expect(stops[3]).toMatchObject({ kind: "error", switchedProvider: true });
    await drain(brain.openStream([USER]));
    expect(f.calls.map((c) => c.provider)).toEqual(["deepinfra", "deepinfra", "deepinfra", "deepinfra", "fireworks"]);
  });

  it("402 cools DeepInfra and logs once, even when two turns fail", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const a = fakes({ deepinfra: [[httpError(402)]] });
    const b = fakes({ deepinfra: [[httpError(402)]] });
    const turnA = createAgentBrain({ tools: TOOLS, requestId: "p1", env: ENV, streamClientFor: a.streamClientFor });
    const turnB = createAgentBrain({ tools: TOOLS, requestId: "p2", env: ENV, streamClientFor: b.streamClientFor });
    expect(lastDone(await drain(turnA.openStream([USER])))).toMatchObject({ switchedProvider: true });
    expect(lastDone(await drain(turnB.openStream([USER])))).toMatchObject({ switchedProvider: true });
    expect(isCooling("deepinfra", Date.now())).toBe(true);
    const lines = errors.mock.calls.map((c) => String(c[0])).filter((l) => l.includes("[agent] deepinfra sin saldo (402)"));
    expect(lines).toEqual(["[agent] deepinfra sin saldo (402): turnos a Fireworks"]);
  });

  it("a call with no event in 60 s switches", async () => {
    vi.useFakeTimers();
    expect(FIRST_EVENT_TIMEOUT_MS).toBe(60_000);
    const f = fakes({ deepinfra: ["hang"] });
    const brain = createAgentBrain({ tools: TOOLS, requestId: "p1", env: ENV, streamClientFor: f.streamClientFor });
    const pending = drain(brain.openStream([USER]));
    await vi.advanceTimersByTimeAsync(FIRST_EVENT_TIMEOUT_MS);
    expect(lastDone(await pending)).toMatchObject({ kind: "error", switchedProvider: true });
    await drain(brain.openStream([USER]));
    expect(f.calls.map((c) => c.provider)).toEqual(["deepinfra", "fireworks"]);
  });

  it("with no fallback, a slow call is never cut", async () => {
    vi.useFakeTimers();
    const f = fakes({ deepinfra: ["hang"] });
    const owner = new AbortController();
    const brain = createAgentBrain({
      tools: TOOLS,
      requestId: "p1",
      env: { ...ENV, OPENLEN_AGENT_PROVIDERS: "deepinfra" },
      signal: owner.signal,
      streamClientFor: f.streamClientFor,
    });
    const pending = drain(brain.openStream([USER]));
    await vi.advanceTimersByTimeAsync(FIRST_EVENT_TIMEOUT_MS * 3);
    owner.abort();
    expect(lastDone(await pending)).toEqual({ kind: "cancelled" });
  });

  it("the owner's stop and context_window_exceeded never switch", async () => {
    const f = fakes({ deepinfra: ["hang"] });
    const owner = new AbortController();
    const brain = createAgentBrain({ tools: TOOLS, requestId: "p1", env: ENV, signal: owner.signal, streamClientFor: f.streamClientFor });
    const pending = drain(brain.openStream([USER]));
    await Promise.resolve();
    owner.abort();
    expect(lastDone(await pending)).toEqual({ kind: "cancelled" });
    expect(brain.fellBack()).toBe(false);

    const g = fakes({ deepinfra: [[coded("context_window_exceeded")], [end]] });
    const full = createAgentBrain({ tools: TOOLS, requestId: "p1", env: ENV, streamClientFor: g.streamClientFor });
    const stop = lastDone(await drain(full.openStream([USER])));
    expect(stop).toMatchObject({ code: "context_window_exceeded" });
    expect(stop.switchedProvider).toBeUndefined();
    await drain(full.openStream([USER]));
    expect(g.calls.map((c) => c.provider)).toEqual(["deepinfra", "deepinfra"]);
  });

  it("both failing ends the turn as today, with no going back", async () => {
    const f = fakes({ deepinfra: [[httpError(400)]], fireworks: [[httpError(400)]] });
    const brain = createAgentBrain({ tools: TOOLS, requestId: "p1", env: ENV, streamClientFor: f.streamClientFor });
    expect(lastDone(await drain(brain.openStream([USER])))).toMatchObject({ switchedProvider: true });
    const second = lastDone(await drain(brain.openStream([USER])));
    expect(second).toEqual({ kind: "error", error: "http_400", httpStatus: 400 });
    await drain(brain.openStream([USER]));
    expect(f.calls.map((c) => c.provider)).toEqual(["deepinfra", "fireworks", "fireworks"]);
  });

  it("usage is kept per provider; a switch is forgiven", async () => {
    const f = fakes({
      deepinfra: [[usage(100, 0, 10), coded("server")], [coded("server")]],
      fireworks: [
        [{ type: "text_delta", text: "ok" }, usage(1000, 200, 50), end],
        [usage(1100, 1000, 20), end],
      ],
    });
    const brain = createAgentBrain({ tools: TOOLS, requestId: "p1", env: ENV, streamClientFor: f.streamClientFor });
    for (let i = 0; i < 4; i++) await drain(brain.openStream([USER]));
    await drain(brain.openStream([USER]));
    await drain(brain.openStream([USER]));
    expect(brain.providersUsed()).toEqual([
      { provider: "deepinfra", model: DI_MODEL, inputTokens: 100, cachedTokens: 0, outputTokens: 10, thinkingTokens: 0 },
      { provider: "fireworks", model: FW_MODEL, inputTokens: 2100, cachedTokens: 1200, outputTokens: 70, thinkingTokens: 0 },
    ]);
    expect(brain.billingAdjustment()).toEqual({
      minus: { inputTokens: 100, cachedTokens: 0, outputTokens: 10, thinkingTokens: 0 },
      extraCached: 800,
    });
  });

  it("a turn with no switch owes nothing back", async () => {
    const f = fakes({ deepinfra: [[usage(500, 400, 20), end]] });
    const brain = createAgentBrain({ tools: TOOLS, requestId: "p1", env: ENV, streamClientFor: f.streamClientFor });
    await drain(brain.openStream([USER]));
    expect(brain.billingAdjustment()).toEqual({ minus: { inputTokens: 0, cachedTokens: 0, outputTokens: 0, thinkingTokens: 0 }, extraCached: 0 });
    expect(brain.fellBack()).toBe(false);
  });
});

// LAYER 0 OF LEN 3.1 (spec local 2026-10-24-len-3-1-layers-0-1, §4.1): one report
// per call, with its kind, provider and usage — the raw material of the step rows.
describe("onCall", () => {
  it("reports each call once, with kind, provider and usage; a fallback gives the calls on both providers", async () => {
    const f = fakes({
      deepinfra: [[coded("server")], [coded("server")], [coded("server")], [coded("server")]],
      fireworks: [[usage(100, 0, 5), end]],
    });
    const seen: { kind: string; provider: string; usage: unknown }[] = [];
    const brain = createAgentBrain({
      tools: TOOLS, requestId: "p1", env: ENV, streamClientFor: f.streamClientFor,
      onCall: (c) => seen.push({ kind: c.kind, provider: c.provider, usage: c.usage }),
    });
    for (let i = 0; i <= RETRIES_BEFORE_FALLBACK; i++) await drain(brain.openStream([USER]));
    expect(seen.map((c) => [c.kind, c.provider])).toEqual([
      ...Array.from({ length: RETRIES_BEFORE_FALLBACK }, () => ["loop", "deepinfra"]),
      ["loop", "fireworks"],
    ]);
    expect(seen.at(-1)!.usage).toEqual({ inputTokens: 100, cachedTokens: 0, outputTokens: 5, thinkingTokens: 0 });
  });

  it("closeOut calls are reported with kind closeOut, with model and timing", async () => {
    const f = fakes({});
    const seen: { kind: string; model: string; durationMs: number; stop: string }[] = [];
    const brain = createAgentBrain({ tools: TOOLS, requestId: "p1", env: ENV, streamClientFor: f.streamClientFor, onCall: (c) => seen.push(c) });
    await drain(brain.closeOut([USER]));
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ kind: "closeOut", model: DI_MODEL, stop: "end_turn" });
    expect(seen[0]!.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("an onCall that throws does not break the stream", async () => {
    const f = fakes({});
    const brain = createAgentBrain({
      tools: TOOLS, requestId: "p1", env: ENV, streamClientFor: f.streamClientFor,
      onCall: () => { throw new Error("boom"); },
    });
    expect(lastDone(await drain(brain.openStream([USER])))).toMatchObject({ kind: "end_turn" });
  });
});

