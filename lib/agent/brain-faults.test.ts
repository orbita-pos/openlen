// @vitest-environment node
// (Node's fetch needs Node's AbortSignal; jsdom's is another class.)
// LAYER 1 OF LEN 3.1 (spec local 2026-10-24-len-3-1-layers-0-1, §5.4): the real
// brain, the real stream client and the real loop against scripted providers on
// real sockets (`testing/llm-fault-server.ts`). What a provider failure does to
// a turn — which provider answers, what is retried, what reaches the saved
// transcript — pinned as it is today.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFireworksStreamClient } from "@/lib/ai/fireworks-stream-client";
import { _resetProviderWarnings } from "@/lib/ai/providers";
import { createAgentBrain, RETRIES_BEFORE_FALLBACK, type BrainCall } from "./brain";
import { runAgentLoop } from "./loop";
import { _resetProviderHealth } from "./provider-health";
import { MAX_PROVIDER_RETRIES } from "./retry-policy";
import { startFaultServer, type FaultServer, type FaultStep } from "./testing/llm-fault-server";

let server: FaultServer | null = null;
beforeEach(() => {
  _resetProviderHealth();
  _resetProviderWarnings();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  await server?.close();
  server = null;
});

async function turn(script: Record<string, FaultStep[]>, providers = "deepinfra,fireworks") {
  server = await startFaultServer(script);
  const s = server;
  const calls: BrainCall[] = [];
  const sleeps: number[] = [];
  const events: { type: string }[] = [];
  const brain = createAgentBrain({
    tools: [],
    requestId: "p1",
    env: { OPENLEN_AGENT_PROVIDERS: providers, DEEPINFRA_API_KEY: "test", FIREWORKS_API_KEY: "test" },
    streamClientFor: (p) =>
      createFireworksStreamClient({
        endpoint: s.url(`/${p.id}`),
        apiKey: "test",
        modelId: p.modelId,
        affinityField: p.id === "deepinfra" ? "prompt_cache_key" : "user",
        effortStyle: p.id === "deepinfra" ? "word" : "budget",
      }),
    onCall: (c) => calls.push(c),
  });
  const result = await runAgentLoop({
    messages: [{ role: "system", content: "s" }, { role: "user", content: "hola" }],
    tools: [],
    openStream: brain.openStream,
    closeOut: brain.closeOut,
    runTool: async () => ({ response: { ok: true } }),
    emit: (ev) => events.push(ev),
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  return { result, calls, sleeps, events, brain, requests: (p: string) => s.requests(p) };
}

const ok = (text: string): FaultStep => ({ kind: "ok", text });

describe("provider faults against real sockets", () => {
  it(`a reset before the first event is retried on DeepInfra; ${RETRIES_BEFORE_FALLBACK} in a row move the turn to Fireworks, and onCall shows both`, async () => {
    const resets: FaultStep[] = Array.from({ length: RETRIES_BEFORE_FALLBACK }, () => ({ kind: "reset_before_first_event" }));
    const t = await turn({ "/deepinfra": resets, "/fireworks": [ok("Hecho.")] });
    expect(t.result.finalText).toBe("Hecho.");
    expect(t.calls.map((c) => c.provider)).toEqual([...resets.map(() => "deepinfra"), "fireworks"]);
    expect(t.calls.slice(0, -1).every((c) => c.usage === null && c.stop === "error")).toBe(true);
    expect(t.brain.lastProvider()).toBe("fireworks");
  });

  it(`${RETRIES_BEFORE_FALLBACK} retryable 503 on DeepInfra switch to Fireworks (RETRIES_BEFORE_FALLBACK)`, async () => {
    const errors: FaultStep[] = Array.from({ length: RETRIES_BEFORE_FALLBACK }, () => ({ kind: "http", status: 503 }));
    const t = await turn({ "/deepinfra": errors, "/fireworks": [ok("Hecho.")] });
    expect(t.requests("/deepinfra")).toBe(RETRIES_BEFORE_FALLBACK);
    expect(t.requests("/fireworks")).toBe(1);
    expect(t.result.finalText).toBe("Hecho.");
    // The switch itself does not wait: only the retries before it do.
    expect(t.sleeps).toHaveLength(RETRIES_BEFORE_FALLBACK - 1);
  });

  it("text streamed before a mid-stream disconnect never reaches the saved transcript", async () => {
    const t = await turn({ "/deepinfra": [{ kind: "disconnect_after", chunks: 3, text: "TEXTO A MEDIAS que se corta" }, ok("Listo.")] });
    expect(t.result.finalText).toBe("Listo.");
    expect(JSON.stringify(t.result.transcripcion)).not.toContain("TEXTO");
    expect(t.events.some((e) => e.type === "retry")).toBe(true);
    expect(t.requests("/deepinfra")).toBe(2);
  });

  // A4 of Len 3.1, DeepSeek's `empty-model-response-is-retryable`: a `stop` with no text, no reasoning
  // and no calls is a retryable EMPTY_RESPONSE failure, not an empty success. It used to close the turn
  // with nothing said and no retry.
  it("an empty completion is retried on the same provider and the turn gets the recovered answer", async () => {
    const t = await turn({ "/deepinfra": [{ kind: "empty_completion" }, ok("Hecho.")] });
    expect({ finalText: t.result.finalText, terminalError: t.result.terminalError, deepinfra: t.requests("/deepinfra"), fireworks: t.requests("/fireworks") }).toEqual({
      finalText: "Hecho.",
      terminalError: false,
      deepinfra: 2,
      fireworks: 0,
    });
    expect(t.events.some((e) => e.type === "retry")).toBe(true);
    expect(t.calls[0]).toMatchObject({ provider: "deepinfra", stop: "error" });
  });

  it("a provider that keeps answering empty moves the turn to the fallback, and one that never answers fails the turn out loud", async () => {
    const empty: FaultStep = { kind: "empty_completion" };
    // On the fallback the count starts over: the first try plus MAX_PROVIDER_RETRIES.
    const onFallback = MAX_PROVIDER_RETRIES + 1;
    const t = await turn({ "/deepinfra": Array.from({ length: RETRIES_BEFORE_FALLBACK }, () => empty), "/fireworks": Array.from({ length: onFallback }, () => empty) });
    expect(t.requests("/deepinfra")).toBe(RETRIES_BEFORE_FALLBACK);
    expect(t.requests("/fireworks")).toBe(onFallback);
    expect(t.result).toMatchObject({ finalText: "", terminalError: true });
    expect(t.events.filter((e) => e.type === "error")).toEqual([expect.objectContaining({ code: "upstream", message: expect.stringMatching(/empty response/) })]);
  });

  it("an answer that only thought is not empty: it is not retried", async () => {
    const t = await turn({ "/deepinfra": [{ kind: "ok", text: "", reasoning: "Nada que añadir." }] });
    expect({ terminalError: t.result.terminalError, deepinfra: t.requests("/deepinfra") }).toEqual({ terminalError: false, deepinfra: 1 });
  });

  // DeepSeek's `bounded-llm-request-recovery`: a provider Retry-After within the 10 s cap is the wait, exact
  // and unjittered; a longer one is never retried early — the turn goes to the fallback, or fails without one.
  // Until 25/10 the loop waited its own backoff (500 ms ± 10 %) and ignored the provider.
  it("a 429 with Retry-After within the cap waits exactly that, on the same provider", async () => {
    const t = await turn({ "/deepinfra": [{ kind: "http", status: 429, retryAfterS: 7 }, ok("Hecho.")] });
    expect(t.requests("/deepinfra")).toBe(2);
    expect(t.requests("/fireworks")).toBe(0);
    expect(t.sleeps).toEqual([7_000]);
    expect(t.result.finalText).toBe("Hecho.");
  });

  it("a Retry-After past the cap is not retried early: the turn moves to the fallback at once", async () => {
    const t = await turn({ "/deepinfra": [{ kind: "http", status: 429, retryAfterS: 30 }], "/fireworks": [ok("Hecho.")] });
    expect(t.requests("/deepinfra")).toBe(1);
    expect(t.requests("/fireworks")).toBe(1);
    expect(t.sleeps).toEqual([]);
    expect(t.result.finalText).toBe("Hecho.");
  });

  it("with no fallback, a Retry-After past the cap ends the turn instead of retrying early", async () => {
    const t = await turn({ "/deepinfra": [{ kind: "http", status: 429, retryAfterS: 30 }] }, "deepinfra");
    expect(t.requests("/deepinfra")).toBe(1);
    expect(t.sleeps).toEqual([]);
    expect(t.result.terminalError).toBe(true);
  });

  // Layer 0, as Claude Code watches for a slow first byte and a stalled stream: onCall says when the first event came and
  // the longest silence between two events, raw; whoever reads the rows applies the threshold.
  it("onCall reports the time to the first event and the longest gap between events", async () => {
    const t = await turn({ "/deepinfra": [{ kind: "ok", text: "Hecho del todo, gracias.", delayFirstMs: 150, pause: { after: 2, ms: 250 } }] });
    const c = t.calls[0]!;
    expect(c.firstEventMs).toBeGreaterThanOrEqual(140);
    expect(c.longestGapMs).toBeGreaterThanOrEqual(240);
    expect(c.longestGapMs!).toBeLessThan(c.durationMs);
  });

  it("a script that runs out fails loud: 500 «script exhausted»", async () => {
    const t = await turn({ "/deepinfra": [], "/fireworks": [] });
    expect(t.result.terminalError).toBe(true);
  });
});
