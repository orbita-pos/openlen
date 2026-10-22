import { describe, expect, it } from "vitest";

import { sandboxBudgetOk } from "./budget";

const now = new Date("2026-10-21T15:00:00Z");

describe("sandboxBudgetOk", () => {
  it("refuses at or over the daily cap", async () => {
    expect(await sandboxBudgetOk({ now, dailyUsd: 5, spentTodayMicroUsd: async () => 4_999_999 })).toBe(true);
    expect(await sandboxBudgetOk({ now, dailyUsd: 5, spentTodayMicroUsd: async () => 5_000_000 })).toBe(false);
  });

  it("a cap of 0 means no sandbox today, without reading the ledger", async () => {
    let read = false;
    expect(await sandboxBudgetOk({ now, dailyUsd: 0, spentTodayMicroUsd: async () => ((read = true), 0) })).toBe(false);
    expect(read).toBe(false);
  });

  it("asks for today's spend from the start of the UTC day", async () => {
    let from: Date | null = null;
    await sandboxBudgetOk({ now, dailyUsd: 5, spentTodayMicroUsd: async (d) => ((from = d), 0) });
    expect(from).toEqual(new Date("2026-10-21T00:00:00Z"));
  });

  it("a ledger it cannot read refuses the box (the old terminal still works)", async () => {
    expect(
      await sandboxBudgetOk({ now, dailyUsd: 5, spentTodayMicroUsd: async () => { throw new Error("db down"); } }),
    ).toBe(false);
  });
});
