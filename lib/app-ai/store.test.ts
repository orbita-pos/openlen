import { describe, expect, it } from "vitest";

import { memoryAppAiStore } from "./store";

describe("memoryAppAiStore", () => {
  it("adds per project and environment, and sums the account's month", async () => {
    const s = memoryAppAiStore();
    await s.add({ userId: "u", month: "2026-10", projectId: "p", environment: "draft", centicredits: 3 });
    await s.add({ userId: "u", month: "2026-10", projectId: "p", environment: "draft", centicredits: 4 });
    await s.add({ userId: "u", month: "2026-10", projectId: "q", environment: "live", centicredits: 10 });
    await s.add({ userId: "u", month: "2026-11", projectId: "p", environment: "live", centicredits: 99 });
    expect(await s.monthSpent("u", "2026-10")).toBe(17);
    expect(await s.projectMonth("p", "2026-10")).toEqual({ draft: { centicredits: 7, calls: 2 }, live: { centicredits: 0, calls: 0 } });
    expect(await s.monthSpent("other", "2026-10")).toBe(0);
  });

  it("claims each alert once a month, and 100 swallows 80", async () => {
    const s = memoryAppAiStore();
    expect(await s.claimCapAlert("u", "2026-10", 80)).toBe(true);
    expect(await s.claimCapAlert("u", "2026-10", 80)).toBe(false);
    expect(await s.claimCapAlert("u", "2026-10", 100)).toBe(true);
    expect(await s.claimCapAlert("u", "2026-10", 80)).toBe(false);
    expect(await s.claimCapAlert("u", "2026-11", 80)).toBe(true);
  });

  it("keeps the explicit cap, and null brings the default back", async () => {
    const s = memoryAppAiStore();
    expect(await s.explicitCap("u")).toBeNull();
    await s.setExplicitCap("u", 5_000);
    expect(await s.explicitCap("u")).toBe(5_000);
    await s.setExplicitCap("u", null);
    expect(await s.explicitCap("u")).toBeNull();
  });
});
