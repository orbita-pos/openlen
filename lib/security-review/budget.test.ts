import { describe, expect, it } from "vitest";

import { checkBudget, utcDayStart } from "./budget";
import { memorySecurityReviewStore } from "./store";

const NOW = new Date("2026-10-16T15:00:00Z");

async function storeWith(rows: { projectId: string; status: "running" | "done" | "skipped_budget"; cost: number; startedAt: Date }[]) {
  const store = memorySecurityReviewStore();
  for (const [k, r] of rows.entries()) {
    await store.insert({ projectId: r.projectId, fingerprint: `f${k}`, status: r.status === "done" ? "running" : r.status, phase0: [], fileHashes: {}, startedAt: r.startedAt });
    if (r.status === "done") await store.finish(r.projectId, `f${k}`, { status: "done", findings: [], costCentiCredits: r.cost, failReason: null, finishedAt: r.startedAt });
  }
  return store;
}

describe("checkBudget", () => {
  it("utcDayStart is midnight UTC", () => {
    expect(utcDayStart(new Date("2026-10-16T23:59:00-07:00")).toISOString()).toBe("2026-10-17T00:00:00.000Z");
  });

  it("lets the model run under both limits", async () => {
    const store = await storeWith([{ projectId: "p", status: "done", cost: 100, startedAt: NOW }]);
    expect(await checkBudget(store, "p", NOW, {})).toEqual({ ok: true });
  });

  it("stops at the day's global spend, whoever spent it", async () => {
    const store = await storeWith([{ projectId: "other", status: "done", cost: 2_900, startedAt: NOW }]);
    expect(await checkBudget(store, "p", NOW, { OPENLEN_SECURITY_REVIEW_DAILY_USD: "0.29" })).toEqual({ ok: false, reason: "daily" });
  });

  it("stops at 20 model runs of this project today; skipped ones and yesterday's don't count", async () => {
    const today = Array.from({ length: 20 }, () => ({ projectId: "p", status: "running" as const, cost: 0, startedAt: NOW }));
    expect(await checkBudget(await storeWith(today), "p", NOW, {})).toEqual({ ok: false, reason: "project" });
    const notCounted = [
      ...Array.from({ length: 19 }, () => ({ projectId: "p", status: "running" as const, cost: 0, startedAt: NOW })),
      { projectId: "p", status: "skipped_budget" as const, cost: 0, startedAt: NOW },
      { projectId: "p", status: "running" as const, cost: 0, startedAt: new Date("2026-10-15T23:00:00Z") },
    ];
    expect(await checkBudget(await storeWith(notCounted), "p", NOW, {})).toEqual({ ok: true });
  });

  it("a budget of 0 means no reviews with the model at all", async () => {
    expect(await checkBudget(memorySecurityReviewStore(), "p", NOW, { OPENLEN_SECURITY_REVIEW_DAILY_USD: "0" })).toEqual({ ok: false, reason: "daily" });
  });
});
