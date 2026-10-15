// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import type { FireworksStreamEvent } from "@/lib/ai/fireworks-stream-client";
import { hashSecretKey } from "@/lib/backend/keys";
import type { CreditRate } from "@/lib/credits";
import { ConcurrencyLimiter } from "@/lib/functions/concurrency";
import { WindowLimiter } from "@/lib/functions/window-limiter";
import type { Plan } from "@/lib/plan";

import { streamedCenticredits, worstCaseCenticredits } from "./billing";
import { CapReservations } from "./cap";
import { FreeDailyPool } from "./free-pool";
import { handleAppAiRequest, type AppAiDeps, type CapAlertInput, type ResolvedProject, type UpstreamCall } from "./gateway";
import { memoryAppAiStore } from "./store";

const SECRET = "sb_secret_abcdefghijklmnopqrstuv";
const PROJECT: ResolvedProject = { projectId: "p1", environment: "draft", secretKeyHash: hashSecretKey(SECRET) };
const RATE = "deepseek-flash-4p1" as CreditRate;
const NOW = new Date("2026-10-15T12:00:00Z");
const BODY = { model: "openlen-fast", messages: [{ role: "user", content: "dos de pastor" }] };
const WORST = worstCaseCenticredits({ inputBytes: Buffer.byteLength(JSON.stringify(BODY)), maxTokens: 2_048, rate: RATE });

type Script = (call: UpstreamCall) => FireworksStreamEvent[] | AsyncIterable<FireworksStreamEvent>;
const USAGE = { type: "usage", inputTokens: 600, outputTokens: 80, cachedTokens: 500, thinkingTokens: 0 } as const;
const answer = (text: string, usage: FireworksStreamEvent = USAGE): FireworksStreamEvent[] => [
  { type: "text_delta", text },
  usage,
  { type: "done", stopReason: { kind: "end_turn" } },
];

function fakeWallet(balance: number, plan: Plan = "pro", allotment = 30_000) {
  const w = {
    balance,
    async state() {
      return { plan, allotment };
    },
    async debitIfEnough(_u: string, n: number) {
      if (w.balance < n) return false;
      w.balance -= n;
      return true;
    },
    async debit(_u: string, n: number) {
      w.balance = Math.max(0, w.balance - n);
    },
    async refund(_u: string, n: number) {
      w.balance += n;
    },
  };
  return w;
}

function mount(script: Script = () => answer("hola"), change: Partial<AppAiDeps> = {}, wallet = fakeWallet(10_000)) {
  const calls: UpstreamCall[] = [];
  const capAlerts: CapAlertInput[] = [];
  const poolAlerts: unknown[] = [];
  const store = memoryAppAiStore();
  const deps: AppAiDeps = {
    enabled: () => true,
    resolve: async () => PROJECT,
    blocked: async () => false,
    ownerOf: async () => "u1",
    wallet,
    store,
    reservations: new CapReservations(),
    concurrency: new ConcurrencyLimiter(),
    rate: new WindowLimiter(() => 0),
    freePool: new FreeDailyPool(20_000, () => NOW),
    upstream: (call) => {
      calls.push(call);
      const s = script(call);
      return Array.isArray(s) ? (async function* () { yield* s; })() : s;
    },
    rateFor: () => RATE,
    alerts: { cap: (a) => void capAlerts.push(a), freePool: (a) => void poolAlerts.push(a) },
    now: () => NOW,
    ...change,
  };
  return { deps, calls, store, wallet, capAlerts, poolAlerts };
}

const send = (deps: AppAiDeps, body: unknown = BODY, o: { key?: string | null; header?: "authorization" | "apikey"; path?: string; method?: string } = {}) => {
  const method = o.method ?? "POST";
  const key = o.key === undefined ? SECRET : o.key;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (key !== null) headers[o.header ?? "authorization"] = (o.header ?? "authorization") === "authorization" ? `Bearer ${key}` : key;
  return handleAppAiRequest(
    new Request(`https://abcdefghijklmnopqrst.openlen.app${o.path ?? "/ai/v1/chat/completions"}`, {
      method,
      headers,
      body: method === "GET" ? undefined : JSON.stringify(body),
    }),
    deps,
  );
};

const sseEvents = async (r: Response) =>
  (await r.text())
    .split("\n\n")
    .filter(Boolean)
    .map((s) => s.replace(/^data: /, ""));

/** A script that waits until `open()` before answering. */
function gated(text = "ok") {
  let open!: () => void;
  const gate = new Promise<void>((r) => (open = r));
  const script: Script = () =>
    (async function* () {
      await gate;
      yield* answer(text);
    })();
  return { script, open: () => open() };
}

describe("the AI gateway: who gets in", () => {
  it("off: 503, and nothing is called", async () => {
    const { deps, calls } = mount(undefined, { enabled: () => false });
    const r = await send(deps);
    expect(r.status).toBe(503);
    expect((await r.json()).error.code).toBe("app_ai_disabled");
    expect(calls).toHaveLength(0);
  });

  it("an unknown endpoint: 404", async () => {
    const { deps } = mount();
    expect((await send(deps, BODY, { path: "/ai/v1/embeddings" })).status).toBe(404);
  });

  it("an unknown host: 404 project_not_found", async () => {
    const { deps } = mount(undefined, { resolve: async () => null });
    const r = await send(deps);
    expect(r.status).toBe(404);
    expect((await r.json()).error.code).toBe("project_not_found");
  });

  it("🔴 only the project's SECRET key: none, the publishable one or another project's is 401", async () => {
    const { deps, calls } = mount();
    for (const key of [null, "sb_publishable_abc", "sb_secret_someoneelsesprojectkey00"]) {
      const r = await send(deps, BODY, { key });
      expect(r.status).toBe(401);
      expect((await r.json()).error.message).toContain("server-only");
    }
    expect(calls).toHaveLength(0);
  });

  it("the secret key also works in the apikey header", async () => {
    const { deps } = mount();
    expect((await send(deps, BODY, { header: "apikey" })).status).toBe(200);
  });

  it("a project blocked for abuse: 503", async () => {
    const { deps } = mount(undefined, { blocked: async () => true });
    expect((await send(deps)).status).toBe(503);
  });

  it("GET /ai/v1/models lists the two aliases, with the key", async () => {
    const { deps } = mount();
    const r = await send(deps, null, { path: "/ai/v1/models", method: "GET" });
    expect((await r.json()).data.map((m: { id: string }) => m.id)).toEqual(["openlen-fast", "openlen-smart"]);
    expect((await send(deps, null, { path: "/ai/v1/models", method: "GET", key: null })).status).toBe(401);
  });

  it("a bad body: 400 naming the field, and nothing is charged", async () => {
    const { deps, calls, wallet } = mount();
    const r = await send(deps, { ...BODY, tools: [] });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatchObject({ code: "unsupported_parameter", param: "tools" });
    expect((await send(deps, { ...BODY, model: "gpt-4o" })).status).toBe(404);
    expect(calls).toHaveLength(0);
    expect(wallet.balance).toBe(10_000);
  });
});

describe("the AI gateway: answering and charging", () => {
  it("a whole answer: OpenAI's shape, the call the policy wants, and the REAL cost charged", async () => {
    const { deps, calls, store, wallet } = mount();
    const r = await send(deps, { ...BODY, response_format: { type: "json_object" } });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({
      object: "chat.completion",
      model: "openlen-fast",
      choices: [{ message: { role: "assistant", content: "hola" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 600, completion_tokens: 80, total_tokens: 680 },
    });
    expect(calls[0]!.request).toMatchObject({ maxTokens: 2_048, temperature: 1, jsonObject: true, model: { operation: "app_ai_fast" } });
    expect(wallet.balance).toBe(10_000 - 2);
    expect(await store.monthSpent("u1", "2026-10")).toBe(2);
    expect(await store.projectMonth("p1", "2026-10")).toEqual({ draft: { centicredits: 2, calls: 1 }, live: { centicredits: 0, calls: 0 } });
  });

  it("a call from production is counted as production", async () => {
    const { deps, store } = mount(undefined, { resolve: async () => ({ ...PROJECT, environment: "live" }) });
    await send(deps);
    expect((await store.projectMonth("p1", "2026-10")).live.calls).toBe(1);
  });

  it("🔴 the owner's balance below the worst case: 402 insufficient_credits, nothing called", async () => {
    const { deps, calls, wallet } = mount(undefined, {}, fakeWallet(WORST - 1));
    const r = await send(deps);
    expect(r.status).toBe(402);
    expect((await r.json()).error.code).toBe("insufficient_credits");
    expect(calls).toHaveLength(0);
    expect(wallet.balance).toBe(WORST - 1);
  });

  it("the cap reached: 402 app_ai_cap_reached and ONE alert at 100 %", async () => {
    const { deps, store, calls, capAlerts } = mount();
    await store.setExplicitCap("u1", WORST - 1);
    expect((await send(deps)).status).toBe(402);
    expect((await send(deps)).status).toBe(402);
    expect(calls).toHaveLength(0);
    await vi.waitFor(() => expect(capAlerts).toEqual([{ userId: "u1", projectId: "p1", month: "2026-10", percent: 100, spent: 0, cap: WORST - 1 }]));
  });

  it("🔴 calls at once near the cap: only those that fit get in", async () => {
    const g = gated();
    const { deps, store, calls } = mount(g.script);
    await store.setExplicitCap("u1", WORST * 2);
    const a = send(deps);
    const b = send(deps);
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    const c = await send(deps);
    expect(c.status).toBe(402);
    g.open();
    expect((await a).status).toBe(200);
    expect((await b).status).toBe(200);
  });

  it("80 %: one alert when the month crosses it", async () => {
    // 100 × 0.30 + 7000 × 1.20 = 8430 µ$ → 85 centicredits, over a cap of 100.
    const big = { type: "usage", inputTokens: 100, outputTokens: 7_000, cachedTokens: 0, thinkingTokens: 0 } as const;
    const { deps, store, capAlerts } = mount(() => answer("x", big));
    await store.setExplicitCap("u1", 100);
    expect((await send(deps)).status).toBe(200);
    await vi.waitFor(() => expect(capAlerts.map((a) => a.percent)).toEqual([80]));
    expect((await send(deps)).status).toBe(402);
    await vi.waitFor(() => expect(capAlerts.map((a) => a.percent)).toEqual([80, 100]));
  });

  it("🔴 the real cost above the worst case: the difference is charged, never below zero", async () => {
    const huge = { type: "usage", inputTokens: 600, outputTokens: 100_000, cachedTokens: 500, thinkingTokens: 0 } as const;
    const { deps, wallet } = mount(() => answer("x", huge), {}, fakeWallet(WORST));
    expect((await send(deps)).status).toBe(200);
    expect(wallet.balance).toBe(0);
  });

  it("🔴 the model fails before the first token: 502, everything given back, the slot released", async () => {
    let fail = true;
    const { deps, wallet, store } = mount(() => (fail ? [{ type: "done", stopReason: { kind: "error", error: "http_500" } }] : answer("ok")), {
      concurrency: new ConcurrencyLimiter(),
    }, fakeWallet(10_000, "free", 2_000));
    const r = await send(deps);
    expect(r.status).toBe(502);
    expect(wallet.balance).toBe(10_000);
    expect(await store.monthSpent("u1", "2026-10")).toBe(0);
    fail = false;
    expect((await send(deps)).status).toBe(200);
    expect((await send(deps)).status).toBe(200); // free allows 2 at once: nothing was left hanging
  });

  it("smart thinks: its operation and default max_tokens", async () => {
    const { deps, calls } = mount();
    await send(deps, { ...BODY, model: "openlen-smart" });
    expect(calls[0]!.request).toMatchObject({ maxTokens: 8_192, model: { operation: "app_ai_smart" } });
  });
});

describe("the AI gateway: limits", () => {
  it("the plan's requests per minute: then 429 with Retry-After", async () => {
    const { deps } = mount(undefined, {}, fakeWallet(10_000, "free", 2_000));
    for (let i = 0; i < 20; i++) expect((await send(deps)).status).toBe(200);
    const r = await send(deps);
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBe("60");
  });

  it("the plan's calls at once: the third free one is 429, and the slots come back", async () => {
    const g = gated();
    const { deps, calls } = mount(g.script, {}, fakeWallet(10_000, "free", 2_000));
    const a = send(deps);
    const b = send(deps);
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect((await send(deps)).status).toBe(429);
    g.open();
    await a;
    await b;
    expect((await send(deps)).status).toBe(200);
  });

  it("the free plan's daily pool: 503 app_ai_busy for free, paid plans go on", async () => {
    const free = mount(undefined, { freePool: new FreeDailyPool(0, () => NOW) }, fakeWallet(10_000, "free", 2_000));
    const r = await send(free.deps);
    expect(r.status).toBe(503);
    expect((await r.json()).error.code).toBe("app_ai_busy");
    expect(free.wallet.balance).toBe(10_000);
    const paid = mount(undefined, { freePool: new FreeDailyPool(0, () => NOW) });
    expect((await send(paid.deps)).status).toBe(200);
  });
});

describe("the AI gateway: streaming", () => {
  it("OpenAI's chunks, the usage when asked, and [DONE]", async () => {
    const { deps, wallet } = mount(() => [{ type: "reasoning_delta", text: "hmm" }, { type: "text_delta", text: "ho" }, { type: "text_delta", text: "la" }, USAGE, { type: "done", stopReason: { kind: "end_turn" } }]);
    const r = await send(deps, { ...BODY, stream: true, stream_options: { include_usage: true } });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/event-stream");
    const ev = await sseEvents(r);
    expect(ev.at(-1)).toBe("[DONE]");
    const parsed = ev.slice(0, -1).map((e) => JSON.parse(e));
    expect(parsed[0].choices[0].delta).toEqual({ role: "assistant", content: "" });
    expect(parsed.filter((p) => p.choices[0]?.delta?.content).map((p) => p.choices[0].delta.content).join("")).toBe("hola");
    expect(parsed.find((p) => p.choices[0]?.finish_reason)?.choices[0].finish_reason).toBe("stop");
    expect(parsed.at(-1).usage).toEqual({ prompt_tokens: 600, completion_tokens: 80, total_tokens: 680 });
    expect(JSON.stringify(parsed)).not.toContain("hmm");
    expect(wallet.balance).toBe(10_000 - 2);
  });

  it("an error before the first token is a plain 502, not a stream", async () => {
    const { deps, wallet } = mount(() => [{ type: "done", stopReason: { kind: "error", error: "x" } }]);
    const r = await send(deps, { ...BODY, stream: true });
    expect(r.status).toBe(502);
    expect(r.headers.get("content-type")).toContain("application/json");
    expect(wallet.balance).toBe(10_000);
  });

  it("an error halfway: an error event, [DONE], and what was streamed is charged", async () => {
    const { deps, wallet, store } = mount(() => [{ type: "text_delta", text: "a".repeat(300) }, { type: "done", stopReason: { kind: "error", error: "cut" } }]);
    const r = await send(deps, { ...BODY, stream: true });
    const ev = await sseEvents(r);
    expect(JSON.parse(ev.at(-2)!).error.code).toBe("upstream_error");
    expect(ev.at(-1)).toBe("[DONE]");
    const streamed = streamedCenticredits({ inputBytes: Buffer.byteLength(JSON.stringify({ ...BODY, stream: true })), outputChars: 300, rate: RATE });
    await vi.waitFor(async () => expect(await store.monthSpent("u1", "2026-10")).toBe(streamed));
    expect(wallet.balance).toBe(10_000 - streamed);
  });

  it("🔴 the client cuts halfway: the model is aborted, what was streamed is charged, the slot comes back", async () => {
    let signal: AbortSignal | null = null;
    const { deps, store } = mount(
      (call) =>
        (async function* () {
          signal = call.signal;
          yield { type: "text_delta", text: "a".repeat(300) } as FireworksStreamEvent;
          await new Promise<void>((r) => call.signal.addEventListener("abort", () => r()));
        })(),
      {},
      fakeWallet(10_000, "free", 2_000),
    );
    const r = await send(deps, { ...BODY, stream: true });
    const reader = r.body!.getReader();
    await reader.read(); // the role chunk
    await reader.read(); // the text
    await reader.cancel();
    const streamed = streamedCenticredits({ inputBytes: Buffer.byteLength(JSON.stringify({ ...BODY, stream: true })), outputChars: 300, rate: RATE });
    await vi.waitFor(async () => expect(await store.monthSpent("u1", "2026-10")).toBe(streamed));
    expect((signal as AbortSignal | null)?.aborted).toBe(true);
    expect(deps.concurrency.inFlight("ai|p1")).toBe(0);
    expect(deps.reservations.reserved("u1")).toBe(0);
  });
});
