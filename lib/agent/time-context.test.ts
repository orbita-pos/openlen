// DeepSeek's time context (spec local 2026-10-29-tareas-programadas, §7.3): the first-step reading,
// with its exact text, so «at 9» and «in an hour» mean something to Len.
import { describe, expect, it } from "vitest";

import { buildAgentContext } from "./context";
import { sinceLastTurn, timeContext } from "./time-context";

describe("timeContext", () => {
  it("is DeepSeek's three lines for a known zone", () => {
    expect(timeContext({ turn: 3, now: new Date("2026-11-02T15:03:07Z"), zone: "America/Mexico_City", sinceLast: 3_725_000 })).toBe(
      "Time sampled while preparing turn 3, step 1: 2026-11-02T09:03:07-06:00[America/Mexico_City]\n" +
        "Browser time zone for this request: America/Mexico_City. Interpret otherwise-unqualified dates and times in this zone.\n" +
        "Elapsed since the preceding model-visible message: 1h 2m 5s.",
    );
  });

  it("says unavailable, in UTC, when there is no zone and nothing before", () => {
    expect(timeContext({ turn: 1, now: new Date("2026-11-02T15:03:07Z"), zone: null, sinceLast: null })).toBe(
      "Time sampled while preparing turn 1, step 1: 2026-11-02T15:03:07+00:00[UTC]\n" +
        "Browser time zone for this request: unavailable. Ask the user to clarify otherwise-unqualified dates and times.\n" +
        "Elapsed since the preceding model-visible message: unavailable.",
    );
  });

  it("writes days and drops empty units, like DeepSeek", () => {
    expect(timeContext({ turn: 2, now: new Date("2026-11-02T15:03:07Z"), zone: "UTC", sinceLast: 90_061_000 })).toMatch(/: 1d 1h 1m 1s\.$/);
    expect(timeContext({ turn: 2, now: new Date("2026-11-02T15:03:07Z"), zone: "UTC", sinceLast: 4_000 })).toMatch(/: 4s\.$/);
  });
});

describe("sinceLastTurn", () => {
  it("counts from the end of the last turn (its start plus its duration)", () => {
    expect(sinceLastTurn({ createdAt: new Date("2026-11-02T14:00:00Z"), durationMs: 60_000 }, new Date("2026-11-02T15:03:07Z"))).toBe(3_727_000);
  });
  it("uses its start when the duration is unknown, and null without a last turn", () => {
    expect(sinceLastTurn({ createdAt: new Date("2026-11-02T15:00:00Z"), durationMs: null }, new Date("2026-11-02T15:03:07Z"))).toBe(187_000);
    expect(sinceLastTurn(null, new Date())).toBeNull();
  });
});

describe("buildAgentContext", () => {
  it("puts the time context right after TODAY IS, in the turn's context", () => {
    const tc = timeContext({ turn: 1, now: new Date("2026-11-02T15:03:07Z"), zone: "UTC", sinceLast: null });
    const ctx = buildAgentContext({ state: {}, now: new Date("2026-11-02T15:03:07Z"), zona: "UTC", timeContext: tc } as Parameters<typeof buildAgentContext>[0]);
    const today = ctx.indexOf("TODAY IS 2026-11-02");
    const at = ctx.indexOf(tc);
    expect(today).toBeGreaterThanOrEqual(0);
    expect(at).toBeGreaterThan(today);
    expect(ctx.slice(today, at)).not.toContain("PROJECT STATE");
  });
});
