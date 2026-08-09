import { describe, expect, it } from "vitest";

import { createPilotBudgetGuard } from "./visual-engine-pilot-budget";

describe("Visual Engine pilot budget guard", () => {
  it("reserves before work and rejects an operation that could cross the limit", () => {
    const guard = createPilotBudgetGuard(30_000_000);

    const first = guard.acquire("intent", 20_000_000);
    expect(first).not.toBeNull();
    expect(guard.acquire("creative", 10_000_001)).toBeNull();
    expect(guard.snapshot()).toMatchObject({
      limitMicromxn: 30_000_000,
      reservedMicromxn: 20_000_000,
      exhausted: true,
    });
  });

  it("reconciles a complete cost exactly once and releases the unused reservation", () => {
    const guard = createPilotBudgetGuard(30_000_000);
    const lease = guard.acquire("intent", 5_000_000)!;

    lease.settle(750_000);
    lease.settle(1);

    expect(guard.snapshot()).toMatchObject({
      reservedMicromxn: 0,
      verifiedCostMicromxn: 750_000,
      conservativeCostMicromxn: 0,
      availableMicromxn: 29_250_000,
    });
  });

  it.each([undefined, Number.NaN, -1, 1.5])(
    "keeps the full reservation when settled cost is incomplete (%s)",
    (cost) => {
      const guard = createPilotBudgetGuard(30_000_000);
      const lease = guard.acquire("critic", 4_000_000)!;

      lease.settle(cost);

      expect(guard.snapshot()).toMatchObject({
        reservedMicromxn: 0,
        verifiedCostMicromxn: 0,
        conservativeCostMicromxn: 4_000_000,
        availableMicromxn: 26_000_000,
      });
    },
  );

  it("does not let concurrent callers spend the same available balance", async () => {
    const guard = createPilotBudgetGuard(30_000_000);

    const leases = await Promise.all(Array.from({ length: 4 }, async () =>
      guard.acquire("baseline", 10_000_000)));

    expect(leases.filter(Boolean)).toHaveLength(3);
    expect(guard.snapshot().reservedMicromxn).toBe(30_000_000);
  });
});
