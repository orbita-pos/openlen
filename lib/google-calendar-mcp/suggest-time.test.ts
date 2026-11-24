// lib/google-calendar-mcp/suggest-time.test.ts
// @vitest-environment node
//
// `suggest_time`'s free periods (spec local 2026-11-24-servidor-de-google-calendar, §5.3): gaps between the busy
// intervals of everyone asked, at least `durationMinutes` long, at most `pageSize`, inside the hours and days asked.
import { describe, expect, it } from "vitest";
import { freeSlots } from "./suggest-time";

const MX = "America/Mexico_City"; // -06:00 all year
const base = { durationMinutes: 30, pageSize: 5, timeZone: MX };

describe("freeSlots", () => {
  it("the gaps around a busy hour", () => {
    const busy = [{ start: "2026-11-25T10:00:00-06:00", end: "2026-11-25T11:00:00-06:00" }];
    expect(freeSlots(busy, { start: "2026-11-25T09:00:00-06:00", end: "2026-11-25T12:00:00-06:00" }, base)).toEqual([
      { start: "2026-11-25T09:00:00-06:00", end: "2026-11-25T10:00:00-06:00" },
      { start: "2026-11-25T11:00:00-06:00", end: "2026-11-25T12:00:00-06:00" },
    ]);
  });

  it("overlapping busy intervals of different people merge, and a gap shorter than the duration is not offered", () => {
    const busy = [
      { start: "2026-11-25T09:15:00-06:00", end: "2026-11-25T10:00:00-06:00" },
      { start: "2026-11-25T09:45:00-06:00", end: "2026-11-25T11:10:00-06:00" },
    ];
    expect(freeSlots(busy, { start: "2026-11-25T09:00:00-06:00", end: "2026-11-25T12:00:00-06:00" }, base)).toEqual([
      { start: "2026-11-25T11:10:00-06:00", end: "2026-11-25T12:00:00-06:00" },
    ]);
  });

  it("no more than pageSize", () => {
    const busy = [
      { start: "2026-11-25T09:30:00-06:00", end: "2026-11-25T10:00:00-06:00" },
      { start: "2026-11-25T10:30:00-06:00", end: "2026-11-25T11:00:00-06:00" },
      { start: "2026-11-25T11:30:00-06:00", end: "2026-11-25T12:00:00-06:00" },
    ];
    const slots = freeSlots(busy, { start: "2026-11-25T09:00:00-06:00", end: "2026-11-25T14:00:00-06:00" }, { ...base, pageSize: 2 });
    expect(slots).toEqual([
      { start: "2026-11-25T09:00:00-06:00", end: "2026-11-25T09:30:00-06:00" },
      { start: "2026-11-25T10:00:00-06:00", end: "2026-11-25T10:30:00-06:00" },
    ]);
  });

  it("only inside startHour–endHour, every day of the window", () => {
    const slots = freeSlots([], { start: "2026-11-25T00:00:00-06:00", end: "2026-11-27T00:00:00-06:00" }, { ...base, startHour: "09:00", endHour: "17:00" });
    expect(slots).toEqual([
      { start: "2026-11-25T09:00:00-06:00", end: "2026-11-25T17:00:00-06:00" },
      { start: "2026-11-26T09:00:00-06:00", end: "2026-11-26T17:00:00-06:00" },
    ]);
  });

  it("excludeWeekends skips Saturday and Sunday", () => {
    // 2026-11-27 is a Friday.
    const slots = freeSlots([], { start: "2026-11-27T00:00:00-06:00", end: "2026-12-01T00:00:00-06:00" }, { ...base, startHour: "09:00", endHour: "10:00", excludeWeekends: true });
    expect(slots.map((s) => s.start.slice(0, 10))).toEqual(["2026-11-27", "2026-11-30"]);
  });

  // Review Focus 1: hours are local hours, also on the day the clocks change.
  it("🔴 on Europe/Madrid's spring-forward day, 09:00–11:00 are local hours at +02:00", () => {
    const slots = freeSlots([], { start: "2026-03-29T00:00:00+01:00", end: "2026-03-30T00:00:00+02:00" }, { durationMinutes: 30, pageSize: 5, timeZone: "Europe/Madrid", startHour: "09:00", endHour: "11:00" });
    expect(slots).toEqual([{ start: "2026-03-29T09:00:00+02:00", end: "2026-03-29T11:00:00+02:00" }]);
  });
});
