// @vitest-environment node

import { describe, expect, it } from "vitest";
import { getZoneOffsetMs, wallTimeToUtc, utcToWallParts, isKnownTimeZone } from "./tz";
import { generateSlots, subtractBusy, type BookingRules } from "./availability";

const NY = "America/New_York";
const MIN = 60000;

function mkRules(o: Partial<BookingRules> = {}): BookingRules {
  return {
    durationMin: 45,
    slotIncrementMin: 15,
    bufferBeforeMin: 0,
    bufferAfterMin: 0,
    minLeadTimeMin: 0,
    maxDaysAhead: 60,
    creatorTz: "Etc/UTC",
    weeklyHours: {},
    exceptions: [],
    ...o,
  };
}
const labels = (slots: { label: string }[]) => slots.map((s) => s.label);

// ─── tz.ts primitives ────────────────────────────────────────────────────────

describe("tz primitives", () => {
  it("knows real zones, rejects garbage", () => {
    expect(isKnownTimeZone(NY)).toBe(true);
    expect(isKnownTimeZone("Asia/Kolkata")).toBe(true);
    expect(isKnownTimeZone("Mars/Phobos")).toBe(false);
    expect(isKnownTimeZone("")).toBe(false);
  });

  it("computes DST-aware offsets", () => {
    // NY June = EDT (-4h); NY January = EST (-5h).
    expect(getZoneOffsetMs(Date.UTC(2026, 5, 15, 12), NY)).toBe(-4 * 60 * MIN);
    expect(getZoneOffsetMs(Date.UTC(2026, 0, 15, 12), NY)).toBe(-5 * 60 * MIN);
    // Kolkata is a permanent +05:30.
    expect(getZoneOffsetMs(Date.UTC(2026, 5, 15, 12), "Asia/Kolkata")).toBe(330 * MIN);
  });

  it("wallTimeToUtc round-trips and flags the spring-forward GAP", () => {
    // NY 2026-03-08, clocks jump 02:00 → 03:00. 02:30 never happened.
    const gap = wallTimeToUtc(2026, 3, 8, 2, 30, NY);
    expect(gap.existed).toBe(false);
    // 01:30 EST = 06:30Z; exists.
    const before = wallTimeToUtc(2026, 3, 8, 1, 30, NY);
    expect(before.existed).toBe(true);
    expect(before.utcMs).toBe(Date.UTC(2026, 2, 8, 6, 30));
    // 03:30 EDT = 07:30Z; exists.
    const after = wallTimeToUtc(2026, 3, 8, 3, 30, NY);
    expect(after.existed).toBe(true);
    expect(after.utcMs).toBe(Date.UTC(2026, 2, 8, 7, 30));
  });

  it("flags the fall-back OVERLAP and returns the first occurrence", () => {
    // NY 2026-11-01, clocks fall 02:00 → 01:00. 01:30 happens twice.
    const r = wallTimeToUtc(2026, 11, 1, 1, 30, NY);
    expect(r.existed).toBe(true);
    expect(r.ambiguous).toBe(true);
    // First occurrence is still EDT (-4) → 05:30Z.
    expect(r.utcMs).toBe(Date.UTC(2026, 10, 1, 5, 30));
  });

  it("derives the weekday in the target zone", () => {
    // 2026-06-15 is a Monday.
    expect(utcToWallParts(Date.UTC(2026, 5, 15, 13), NY).weekday).toBe(1);
  });
});

// ─── subtractBusy (half-open) ────────────────────────────────────────────────

describe("subtractBusy", () => {
  const busy = [{ startUtcMs: Date.UTC(2026, 5, 15, 10), endUtcMs: Date.UTC(2026, 5, 15, 10, 30) }];
  it("blocks an overlapping candidate", () => {
    // 30-min svc, 15-min after-buffer, candidate 09:45 → [09:45,10:30) overlaps.
    expect(subtractBusy(Date.UTC(2026, 5, 15, 9, 45), 30, 0, 15, busy)).toBe(false);
  });
  it("allows adjacency (a slot ending exactly when busy starts)", () => {
    // candidate 09:30, 30-min, 0 buffers → [09:30,10:00); busy starts 10:00.
    expect(subtractBusy(Date.UTC(2026, 5, 15, 9, 30), 30, 0, 0, busy)).toBe(true);
  });
});

// ─── generateSlots ───────────────────────────────────────────────────────────

describe("generateSlots", () => {
  const allWeek = { 0: [{ startMin: 540, endMin: 780 }], 1: [{ startMin: 540, endMin: 780 }], 2: [{ startMin: 540, endMin: 780 }], 3: [{ startMin: 540, endMin: 780 }], 4: [{ startMin: 540, endMin: 780 }], 5: [{ startMin: 540, endMin: 780 }], 6: [{ startMin: 540, endMin: 780 }] };

  it("normal single range: 09:00–13:00, 45-min @ :15 → 14 slots ending by 13:00", () => {
    const now = Date.UTC(2026, 5, 14); // Sun 00:00Z
    const slots = generateSlots(mkRules({ weeklyHours: { 1: [{ startMin: 540, endMin: 780 }] } }), {
      nowUtcMs: now,
      rangeStartUtcMs: now,
      rangeEndUtcMs: now + 2 * 86400000,
      visitorTz: "Etc/UTC",
      busy: [],
    });
    expect(slots).toHaveLength(14);
    expect(slots[0].label).toBe("09:00");
    expect(slots[slots.length - 1].label).toBe("12:15");
    expect(slots[0].startUtcMs).toBe(Date.UTC(2026, 5, 15, 9));
  });

  it("multi-range day skips the lunch gap", () => {
    const now = Date.UTC(2026, 5, 14);
    const slots = generateSlots(
      mkRules({ durationMin: 60, slotIncrementMin: 60, weeklyHours: { 1: [{ startMin: 540, endMin: 780 }, { startMin: 900, endMin: 1080 }] } }),
      { nowUtcMs: now, rangeStartUtcMs: now, rangeEndUtcMs: now + 2 * 86400000, visitorTz: "Etc/UTC", busy: [] },
    );
    // 09,10,11,12 then 15,16,17 — nothing in 13:00–15:00.
    expect(labels(slots)).toEqual(["09:00", "10:00", "11:00", "12:00", "15:00", "16:00", "17:00"]);
  });

  it("buffer-after blocks the slots that would crowd a booking", () => {
    const now = Date.UTC(2026, 5, 14);
    const slots = generateSlots(
      mkRules({ durationMin: 30, slotIncrementMin: 15, bufferAfterMin: 15, weeklyHours: { 1: [{ startMin: 540, endMin: 720 }] } }),
      { nowUtcMs: now, rangeStartUtcMs: now, rangeEndUtcMs: now + 2 * 86400000, visitorTz: "Etc/UTC", busy: [{ startUtcMs: Date.UTC(2026, 5, 15, 10), endUtcMs: Date.UTC(2026, 5, 15, 10, 30) }] },
    );
    const ls = labels(slots);
    expect(ls).not.toContain("09:30");
    expect(ls).not.toContain("09:45");
    expect(ls).not.toContain("10:00");
    expect(ls).not.toContain("10:15");
    expect(ls).toContain("10:30");
    expect(ls).toContain("09:15"); // [09:15,10:00) is clear of [10:00,10:30)
  });

  it("min lead time cuts off early slots (boundary included)", () => {
    const now = Date.UTC(2026, 5, 15, 8); // 08:00Z
    const slots = generateSlots(
      mkRules({ minLeadTimeMin: 120, durationMin: 30, slotIncrementMin: 30, weeklyHours: { 1: [{ startMin: 540, endMin: 720 }] } }),
      { nowUtcMs: now, rangeStartUtcMs: now, rangeEndUtcMs: now + 2 * 86400000, visitorTz: "Etc/UTC", busy: [] },
    );
    // leadFloor = 10:00Z → first slot 10:00 (>=), no 09:00/09:30.
    expect(labels(slots)).not.toContain("09:00");
    expect(slots[0].label).toBe("10:00");
  });

  it("max-days-ahead horizon excludes a slot past the ceiling", () => {
    const now = Date.UTC(2026, 5, 15, 0); // Mon 00:00Z
    const slots = generateSlots(
      mkRules({ maxDaysAhead: 1, durationMin: 60, slotIncrementMin: 60, weeklyHours: allWeek }),
      { nowUtcMs: now, rangeStartUtcMs: now, rangeEndUtcMs: now + 10 * 86400000, visitorTz: "Etc/UTC", busy: [] },
    );
    // horizon = now+24h. Mon 09:00–12:00 ok; Tue 09:00 = now+33h excluded.
    expect(slots.every((s) => s.startUtcMs < now + 86400000)).toBe(true);
    expect(slots.some((s) => s.localDate === "2026-06-16")).toBe(false);
  });

  it("blackout exception yields zero slots that day", () => {
    const now = Date.UTC(2026, 5, 14);
    const slots = generateSlots(
      mkRules({ weeklyHours: { 1: [{ startMin: 540, endMin: 780 }] }, exceptions: [{ date: "2026-06-15", blackout: true }] }),
      { nowUtcMs: now, rangeStartUtcMs: now, rangeEndUtcMs: now + 2 * 86400000, visitorTz: "Etc/UTC", busy: [] },
    );
    expect(slots).toHaveLength(0);
  });

  it("exception ranges OVERRIDE the weekly hours", () => {
    const now = Date.UTC(2026, 5, 14);
    const slots = generateSlots(
      mkRules({ durationMin: 60, slotIncrementMin: 60, weeklyHours: { 1: [{ startMin: 540, endMin: 1020 }] }, exceptions: [{ date: "2026-06-15", ranges: [{ startMin: 780, endMin: 900 }] }] }),
      { nowUtcMs: now, rangeStartUtcMs: now, rangeEndUtcMs: now + 2 * 86400000, visitorTz: "Etc/UTC", busy: [] },
    );
    expect(labels(slots)).toEqual(["13:00", "14:00"]);
  });

  it("DST spring-forward: the 02:xx slots that never existed are dropped", () => {
    const now = Date.UTC(2026, 2, 8, 0); // around the NY transition
    const slots = generateSlots(
      mkRules({ durationMin: 15, slotIncrementMin: 15, creatorTz: NY, weeklyHours: { 0: [{ startMin: 60, endMin: 240 }] } }),
      { nowUtcMs: now, rangeStartUtcMs: now, rangeEndUtcMs: now + 86400000, visitorTz: NY, busy: [] },
    );
    const ls = labels(slots);
    expect(ls).not.toContain("02:00");
    expect(ls).not.toContain("02:30");
    expect(ls).toContain("01:45");
    expect(ls).toContain("03:00");
  });

  it("DST fall-back: one 01:30 slot, no duplicate wall label", () => {
    const now = Date.UTC(2026, 10, 1, 0);
    const slots = generateSlots(
      mkRules({ durationMin: 30, slotIncrementMin: 30, creatorTz: NY, weeklyHours: { 0: [{ startMin: 60, endMin: 180 }] } }),
      { nowUtcMs: now, rangeStartUtcMs: now, rangeEndUtcMs: now + 86400000, visitorTz: NY, busy: [] },
    );
    const at0130 = slots.filter((s) => s.label === "01:30");
    expect(at0130).toHaveLength(1);
    expect(at0130[0].startUtcMs).toBe(Date.UTC(2026, 10, 1, 5, 30)); // first occurrence, EDT
  });

  it("visitor in a different zone sees their own labels; instants are tz-independent", () => {
    const now = Date.UTC(2026, 5, 14);
    const slots = generateSlots(
      mkRules({ durationMin: 60, slotIncrementMin: 60, creatorTz: NY, weeklyHours: { 1: [{ startMin: 540, endMin: 600 }] } }),
      { nowUtcMs: now, rangeStartUtcMs: now, rangeEndUtcMs: now + 2 * 86400000, visitorTz: "Europe/Madrid", busy: [] },
    );
    // Creator 09:00 EDT = 13:00Z; Madrid June (+2) = 15:00.
    expect(slots[0].startUtcMs).toBe(Date.UTC(2026, 5, 15, 13));
    expect(slots[0].label).toBe("15:00");
  });

  it("half-hour zone (Kolkata +05:30) maps correctly", () => {
    const now = Date.UTC(2026, 5, 14);
    const slots = generateSlots(
      mkRules({ durationMin: 60, slotIncrementMin: 60, creatorTz: "Asia/Kolkata", weeklyHours: { 1: [{ startMin: 540, endMin: 600 }] } }),
      { nowUtcMs: now, rangeStartUtcMs: now, rangeEndUtcMs: now + 2 * 86400000, visitorTz: "Asia/Kolkata", busy: [] },
    );
    // 09:00 IST = 03:30Z.
    expect(slots[0].startUtcMs).toBe(Date.UTC(2026, 5, 15, 3, 30));
    expect(slots[0].label).toBe("09:00");
  });

  it("garbage visitor tz falls back to creator tz without throwing", () => {
    const now = Date.UTC(2026, 5, 14);
    const slots = generateSlots(
      mkRules({ durationMin: 60, slotIncrementMin: 60, creatorTz: NY, weeklyHours: { 1: [{ startMin: 540, endMin: 600 }] } }),
      { nowUtcMs: now, rangeStartUtcMs: now, rangeEndUtcMs: now + 2 * 86400000, visitorTz: "Mars/Phobos", busy: [] },
    );
    expect(slots.length).toBeGreaterThan(0);
    expect(slots[0].label).toBe("09:00"); // rendered in creator tz (NY)
  });

  it("fully-booked day yields no slots; empty weekday too", () => {
    const now = Date.UTC(2026, 5, 14);
    const fully = generateSlots(
      mkRules({ durationMin: 60, slotIncrementMin: 60, weeklyHours: { 1: [{ startMin: 540, endMin: 660 }] } }),
      { nowUtcMs: now, rangeStartUtcMs: now, rangeEndUtcMs: now + 2 * 86400000, visitorTz: "Etc/UTC", busy: [{ startUtcMs: Date.UTC(2026, 5, 15, 9), endUtcMs: Date.UTC(2026, 5, 15, 11) }] },
    );
    expect(fully).toHaveLength(0);
    const empty = generateSlots(mkRules({ weeklyHours: {} }), { nowUtcMs: now, rangeStartUtcMs: now, rangeEndUtcMs: now + 2 * 86400000, visitorTz: "Etc/UTC", busy: [] });
    expect(empty).toHaveLength(0);
  });
});
