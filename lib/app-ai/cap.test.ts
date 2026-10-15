import { describe, expect, it } from "vitest";

import { CapReservations } from "./cap";
import { FreeDailyPool } from "./free-pool";

describe("CapReservations", () => {
  it("🔴 calls at once near the cap: only those that fit get in", () => {
    const r = new CapReservations();
    const got = [1, 2, 3].map(() => r.tryReserve("u", 40, 25, 100));
    expect(got.map((g) => g !== null)).toEqual([true, true, false]);
    expect(r.reserved("u")).toBe(50);
  });

  it("releasing gives the room back, once", () => {
    const r = new CapReservations();
    const release = r.tryReserve("u", 0, 60, 100)!;
    expect(r.tryReserve("u", 0, 60, 100)).toBeNull();
    release();
    release();
    expect(r.reserved("u")).toBe(0);
    expect(r.tryReserve("u", 0, 60, 100)).not.toBeNull();
  });

  it("each account is separate, and a cap of 0 lets nothing in", () => {
    const r = new CapReservations();
    expect(r.tryReserve("a", 0, 10, 10)).not.toBeNull();
    expect(r.tryReserve("b", 0, 10, 10)).not.toBeNull();
    expect(r.tryReserve("c", 0, 1, 0)).toBeNull();
  });
});

describe("FreeDailyPool", () => {
  it("reserves under the cap and settles the real spend", () => {
    const p = new FreeDailyPool(100, () => new Date("2026-10-15T10:00:00Z"));
    expect(p.tryReserve(60)).toBe(true);
    expect(p.tryReserve(60)).toBe(false);
    expect(p.settle(60, 10)).toBe(false);
    expect(p.spent).toBe(10);
    expect(p.tryReserve(60)).toBe(true);
  });

  it("alerts once a day when the spend crosses 80 %", () => {
    const p = new FreeDailyPool(100, () => new Date("2026-10-15T10:00:00Z"));
    p.tryReserve(90);
    expect(p.settle(90, 85)).toBe(true);
    p.tryReserve(5);
    expect(p.settle(5, 5)).toBe(false);
  });

  it("a new UTC day starts empty", () => {
    let now = new Date("2026-10-15T23:59:00Z");
    const p = new FreeDailyPool(100, () => now);
    p.tryReserve(100);
    p.settle(100, 100);
    expect(p.tryReserve(1)).toBe(false);
    now = new Date("2026-10-16T00:00:01Z");
    expect(p.day).toBe("2026-10-16");
    expect(p.tryReserve(100)).toBe(true);
  });
});
