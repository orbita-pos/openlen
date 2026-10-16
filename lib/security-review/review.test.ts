// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { ModelReviewResult } from "./model-review";
import { createSecurityReviewer, ORPHAN_AFTER_MS, type ReviewDeps } from "./review";
import { memorySecurityReviewStore } from "./store";
import type { Finding, ReviewInputs } from "./types";

const NO_USAGE = { inputTokens: 0, outputTokens: 0, cachedTokens: 0, thinkingTokens: 0 };
const modelHigh: Finding = { key: "model:missing_authorization:/supabase/functions/x/index.ts", source: "model", severity: "HIGH", category: "missing_authorization", file: "/supabase/functions/x/index.ts", line: 4, description: "d", exploitScenario: "e", recommendation: "r" };

const page = (over: Partial<ReviewInputs> = {}): ReviewInputs => ({
  projectId: "p", ownerId: "owner", app: null, homeHtml: "<h1>Hola</h1>", pages: {}, files: {}, productionEnv: {}, hasBackend: false, schema: null, ...over,
});
const withBackend = (over: Partial<ReviewInputs> = {}) => page({ hasBackend: true, schema: { tables: [{ name: "pedidos", rls: true }], policies: [], buckets: [] }, ...over });
const rlsOff = (over: Partial<ReviewInputs> = {}) => page({ hasBackend: true, schema: { tables: [{ name: "productos", rls: false }], policies: [], buckets: [] }, ...over });

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

function setup(o: { inputs: () => ReviewInputs; env?: Record<string, string>; now?: () => Date }) {
  const store = memorySecurityReviewStore();
  const calls: { context: string; focus: string; signal: AbortSignal; answer: ReturnType<typeof deferred<ModelReviewResult & { costCentiCredits: number }>> }[] = [];
  const deps: ReviewDeps = {
    store,
    loadInputs: async () => o.inputs(),
    modelReview: (x) => {
      const answer = deferred<ModelReviewResult & { costCentiCredits: number }>();
      calls.push({ ...x, answer });
      return answer.promise;
    },
    now: o.now ?? (() => new Date("2026-10-16T12:00:00Z")),
    env: o.env ?? {},
  };
  return { reviewer: createSecurityReviewer(deps), store, calls };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("start", () => {
  it("is null when the review is switched off", async () => {
    const { reviewer } = setup({ inputs: () => rlsOff(), env: { OPENLEN_SECURITY_REVIEW: "0" } });
    expect(await reviewer.start("p", "es")).toBeNull();
    expect(await reviewer.gate({ projectId: "p", actorId: "u", locale: "es" })).toEqual({ kind: "open", view: null });
  });

  it("a page without backend or functions only gets the rules: skipped_scope, no model", async () => {
    const { reviewer, calls } = setup({ inputs: () => page({ files: { "/js/a.js": "const k='sk_live_51Habcdefghijklmnopqrst'" } }) });
    const v = await reviewer.start("p", "es");
    expect(v).toMatchObject({ status: "skipped_scope", blocking: [expect.objectContaining({ category: "secret_in_client" })] });
    expect(calls).toHaveLength(0);
  });

  it("with a backend the model runs in the background, in the owner's language, and its findings land when done", async () => {
    const { reviewer, calls } = setup({ inputs: () => withBackend() });
    const v = await reviewer.start("p", "es");
    expect(v?.status).toBe("running");
    await settle();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.context).toContain("table public.pedidos — RLS on");
    expect(calls[0]!.focus).toContain("in Spanish");
    calls[0]!.answer.resolve({ ok: true, findings: [modelHigh], usage: NO_USAGE, costCentiCredits: 321 });
    const done = await reviewer.wait("p", v!.fingerprint, 1_000);
    expect(done).toMatchObject({ status: "done", blocking: [modelHigh] });
  });

  it("the same fingerprint twice runs the model once", async () => {
    const { reviewer, calls } = setup({ inputs: () => withBackend() });
    const [a, b] = await Promise.all([reviewer.start("p", "es"), reviewer.start("p", "en")]);
    expect(a?.fingerprint).toBe(b?.fingerprint);
    await settle();
    expect(calls).toHaveLength(1);
  });

  it("a change while running aborts the old review (superseded) and starts the new one", async () => {
    let html = "<h1>uno</h1>";
    const { reviewer, store, calls } = setup({ inputs: () => withBackend({ homeHtml: html }) });
    const first = await reviewer.start("p", "es");
    await settle();
    html = "<h1>dos</h1>";
    const second = await reviewer.start("p", "es");
    await settle();
    expect(calls).toHaveLength(2);
    expect(calls[0]!.signal.aborted).toBe(true);
    calls[0]!.answer.resolve({ ok: false, reason: "aborted", usage: NO_USAGE, costCentiCredits: 5 });
    await settle();
    expect(await store.get("p", first!.fingerprint)).toMatchObject({ status: "failed", failReason: "superseded", costCentiCredits: 5 });
    expect((await reviewer.view("p", second!.fingerprint))?.status).toBe("running");
  });

  it("the second review is told what changed since the last one that finished", async () => {
    let html = "<h1>uno</h1>";
    const { reviewer, calls } = setup({ inputs: () => withBackend({ homeHtml: html, files: { "/js/a.js": "a" } }) });
    const first = await reviewer.start("p", "es");
    await settle();
    calls[0]!.answer.resolve({ ok: true, findings: [], usage: NO_USAGE, costCentiCredits: 1 });
    await reviewer.wait("p", first!.fingerprint, 1_000);
    html = "<h1>dos</h1>";
    await reviewer.start("p", "es");
    await settle();
    expect(calls[1]!.focus).toContain("CHANGED SINCE THE LAST REVIEW (look here first):\n/index.html");
  });

  it("a failed or crashed model review is failed, with its reason, and never blocks on its own", async () => {
    const { reviewer, calls } = setup({ inputs: () => withBackend() });
    const v = await reviewer.start("p", "es");
    await settle();
    calls[0]!.answer.resolve({ ok: false, reason: "scan: unreadable answer", usage: NO_USAGE, costCentiCredits: 2 });
    expect(await reviewer.wait("p", v!.fingerprint, 1_000)).toMatchObject({ status: "failed", blocking: [] });
    expect(await reviewer.gate({ projectId: "p", actorId: "u", locale: "es" })).toMatchObject({ kind: "open" });
  });

  it("over the day's budget only the rules run: skipped_budget", async () => {
    const { reviewer, calls } = setup({ inputs: () => withBackend(), env: { OPENLEN_SECURITY_REVIEW_DAILY_USD: "0" } });
    expect((await reviewer.start("p", "es"))?.status).toBe("skipped_budget");
    expect(calls).toHaveLength(0);
  });

  it("a review skipped for budget on an earlier day runs the model when asked again today", async () => {
    let now = new Date("2026-10-16T23:00:00Z");
    let env: Record<string, string> = { OPENLEN_SECURITY_REVIEW_DAILY_USD: "0" };
    const store = memorySecurityReviewStore();
    const calls: unknown[] = [];
    const reviewer = createSecurityReviewer({
      store,
      loadInputs: async () => withBackend(),
      modelReview: async () => { calls.push(1); return { ok: true, findings: [], usage: NO_USAGE, costCentiCredits: 1 }; },
      now: () => now,
      get env() { return env; },
    });
    expect((await reviewer.start("p", "es"))?.status).toBe("skipped_budget");
    // Same day, same project: still skipped, no model.
    env = {};
    expect((await reviewer.start("p", "es"))?.status).toBe("skipped_budget");
    // Next UTC day: the budget is back, and the same fingerprint gets the model.
    now = new Date("2026-10-17T01:00:00Z");
    const again = await reviewer.start("p", "es");
    expect(again?.status).toBe("running");
    expect(await reviewer.wait("p", again!.fingerprint, 1_000)).toMatchObject({ status: "done" });
    expect(calls).toHaveLength(1);
  });

  it("a failed review is retried after 10 minutes, a superseded one at once, and not sooner", async () => {
    let now = new Date("2026-10-16T12:00:00Z");
    const { reviewer, store, calls } = setup({ inputs: () => withBackend(), now: () => now });
    const v = await reviewer.start("p", "es");
    await settle();
    calls[0]!.answer.resolve({ ok: false, reason: "scan: fireworks_5xx", usage: NO_USAGE, costCentiCredits: 3 });
    await reviewer.wait("p", v!.fingerprint, 1_000);
    now = new Date(now.getTime() + 60_000);
    expect((await reviewer.start("p", "es"))?.status).toBe("failed");
    now = new Date(now.getTime() + 10 * 60_000);
    expect((await reviewer.start("p", "es"))?.status).toBe("running");
    await settle();
    expect(calls).toHaveLength(2);
    // A superseded review of this same content comes back at once.
    calls[1]!.answer.resolve({ ok: false, reason: "aborted", usage: NO_USAGE, costCentiCredits: 0 });
    await reviewer.wait("p", v!.fingerprint, 1_000);
    await store.finish("p", v!.fingerprint, { status: "failed", findings: [], costCentiCredits: 0, failReason: "superseded", finishedAt: now });
    const row = await store.get("p", v!.fingerprint);
    if (row?.status === "failed" && row.failReason !== "superseded") {
      // Mark it superseded the way a newer state of the project would.
      store.reviews[store.reviews.findIndex((r) => r.fingerprint === v!.fingerprint)] = { ...row, failReason: "superseded" };
    }
    expect((await reviewer.start("p", "es"))?.status).toBe("running");
  });

  it("a running row nobody here is running is closed as failed once it is old enough", async () => {
    let now = new Date("2026-10-16T12:00:00Z");
    const { reviewer, store } = setup({ inputs: () => withBackend(), now: () => now });
    await store.insert({ projectId: "p", fingerprint: "orphan", status: "running", phase0: [], fileHashes: {}, startedAt: now });
    expect((await reviewer.view("p", "orphan"))?.status).toBe("running");
    now = new Date(now.getTime() + ORPHAN_AFTER_MS + 1);
    expect(await reviewer.view("p", "orphan")).toMatchObject({ status: "failed" });
    expect((await store.get("p", "orphan"))?.failReason).toBe("interrupted");
  });
});

describe("gate", () => {
  it("running is pending; a HIGH rule blocks once done", async () => {
    const { reviewer, calls } = setup({ inputs: () => rlsOff() });
    const g1 = await reviewer.gate({ projectId: "p", actorId: "u", locale: "es" });
    expect(g1.kind).toBe("pending");
    await settle();
    calls[0]!.answer.resolve({ ok: true, findings: [], usage: NO_USAGE, costCentiCredits: 1 });
    await reviewer.wait("p", g1.view!.fingerprint, 1_000);
    const g2 = await reviewer.gate({ projectId: "p", actorId: "u", locale: "es" });
    expect(g2).toMatchObject({ kind: "blocked", view: { blocking: [expect.objectContaining({ key: "rls_disabled:public.productos" })] } });
  });

  it("accepting with the wrong fingerprint still blocks; with the right one it opens and is remembered by key", async () => {
    let html = "<h1>uno</h1>";
    const { reviewer, store, calls } = setup({ inputs: () => rlsOff({ homeHtml: html }) });
    const pending = await reviewer.gate({ projectId: "p", actorId: "u", locale: "es" });
    await settle();
    calls[0]!.answer.resolve({ ok: true, findings: [], usage: NO_USAGE, costCentiCredits: 1 });
    await reviewer.wait("p", pending.view!.fingerprint, 1_000);
    expect((await reviewer.gate({ projectId: "p", accept: "0".repeat(64), actorId: "u", locale: "es" })).kind).toBe("blocked");
    const opened = await reviewer.gate({ projectId: "p", accept: pending.view!.fingerprint, actorId: "u-editor", locale: "es" });
    expect(opened).toMatchObject({ kind: "open", view: { blocking: [], accepted: [expect.objectContaining({ key: "rls_disabled:public.productos" })] } });
    expect(await store.get("p", pending.view!.fingerprint)).toMatchObject({ acceptedBy: "u-editor" });
    // The code changes: a new review, but the accepted rule doesn't block again.
    html = "<h1>dos</h1>";
    const next = await reviewer.gate({ projectId: "p", actorId: "u", locale: "es" });
    await settle();
    calls[1]!.answer.resolve({ ok: true, findings: [], usage: NO_USAGE, costCentiCredits: 1 });
    await reviewer.wait("p", next.view!.fingerprint, 1_000);
    expect((await reviewer.gate({ projectId: "p", actorId: "u", locale: "es" })).kind).toBe("open");
  });
});

describe("forAgent", () => {
  it("waits for the model, and tells Len about HIGH findings only the first time", async () => {
    const { reviewer, calls } = setup({ inputs: () => withBackend() });
    const first = reviewer.forAgent("p", "es", 1_000);
    await settle();
    calls[0]!.answer.resolve({ ok: true, findings: [modelHigh], usage: NO_USAGE, costCentiCredits: 1 });
    expect(await first).toMatchObject({ firstTimeForAgent: true, view: { status: "done", blocking: [modelHigh] } });
    expect(await reviewer.forAgent("p", "es", 1_000)).toMatchObject({ firstTimeForAgent: false, view: { blocking: [modelHigh] } });
  });

  it("without HIGH findings there is nothing to tell first", async () => {
    const { reviewer } = setup({ inputs: () => page() });
    expect(await reviewer.forAgent("p", "es", 1_000)).toMatchObject({ firstTimeForAgent: false, view: { status: "skipped_scope", blocking: [] } });
  });
});
