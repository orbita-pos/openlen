import { describe, expect, it } from "vitest";

import { appAiOverview, parseCapUpdate } from "./overview";
import { memoryAppAiStore } from "./store";

const NOW = new Date("2026-10-15T12:00:00Z");

describe("appAiOverview", () => {
  it("the account's month against its default cap, and this project by environment", async () => {
    const store = memoryAppAiStore();
    await store.add({ userId: "u", month: "2026-10", projectId: "p", environment: "draft", centicredits: 200 });
    await store.add({ userId: "u", month: "2026-10", projectId: "q", environment: "live", centicredits: 1_000 });
    expect(await appAiOverview({ projectId: "p", ownerId: "u", allotment: 30_000, now: NOW, store })).toEqual({
      available: true,
      month: "2026-10",
      capCenticredits: 7_500,
      defaultCapCenticredits: 7_500,
      allotmentCenticredits: 30_000,
      explicit: false,
      spentCenticredits: 1_200,
      project: { draft: { centicredits: 200, calls: 1 }, live: { centicredits: 0, calls: 0 } },
    });
  });

  it("with the owner's own cap", async () => {
    const store = memoryAppAiStore();
    await store.setExplicitCap("u", 5_000);
    expect(await appAiOverview({ projectId: "p", ownerId: "u", allotment: 30_000, now: NOW, store })).toMatchObject({ capCenticredits: 5_000, explicit: true });
  });
});

describe("parseCapUpdate", () => {
  it("whole credits from 0 to the plan, or null for the default", () => {
    expect(parseCapUpdate({ capCredits: 50 }, 30_000)).toEqual({ ok: true, cap: 5_000 });
    expect(parseCapUpdate({ capCredits: 0 }, 30_000)).toEqual({ ok: true, cap: 0 });
    expect(parseCapUpdate({ capCredits: 300 }, 30_000)).toEqual({ ok: true, cap: 30_000 });
    expect(parseCapUpdate({ capCredits: null }, 30_000)).toEqual({ ok: true, cap: null });
  });

  it("refuses the rest", () => {
    for (const body of [{}, null, { capCredits: 301 }, { capCredits: -1 }, { capCredits: 1.5 }, { capCredits: "50" }]) {
      expect(parseCapUpdate(body, 30_000).ok).toBe(false);
    }
  });
});
