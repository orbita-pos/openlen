// What the clock's editor sends, shared by the web and the phone (spec local 2026-10-31-len-movil,
// §5.4): the same PATCH body as `schedule_update` for each kind of rule.
import { describe, expect, it } from "vitest";

import { editFromTask, freqOf, timingBody, zoneOf } from "./scheduled-format";

const WEEKLY = {
  kind: "weekly" as const,
  title: "Informe",
  prompt: "Haz el PDF",
  scheduledAtLocal: "2026-11-09T09:03:00-06:00[America/Mexico_City]",
  time: "09:03:00.000",
  timeZone: "America/Mexico_City",
  weekdays: [1],
};

describe("scheduled-format", () => {
  it("reads an edit from a task", () => {
    expect(editFromTask(WEEKLY)).toEqual({ title: "Informe", prompt: "Haz el PDF", freq: "weekly", time: "09:03", days: [1], hours: "1", expression: "", date: "2026-11-09", zone: "America/Mexico_City" });
  });

  it("the zone falls back to the one in the local next run", () => {
    expect(zoneOf({ scheduledAtLocal: "2026-11-09T09:03:00+01:00[Europe/Madrid]" })).toBe("Europe/Madrid");
  });

  it("every kind of rule becomes the body schedule_update takes", () => {
    const base = editFromTask(WEEKLY);
    expect(timingBody({ ...base, freq: "daily" })).toEqual({ daily: { time: "09:03:00", time_zone: "America/Mexico_City" } });
    expect(timingBody({ ...base, days: [5, 1] })).toEqual({ weekly: { time: "09:03:00", time_zone: "America/Mexico_City", weekdays: [1, 5] } });
    expect(timingBody({ ...base, freq: "hours", hours: "3" })).toEqual({ every_seconds: 10800 });
    expect(timingBody({ ...base, freq: "cron", expression: "0 9 * * 1" })).toEqual({ cron: { expression: "0 9 * * 1", time_zone: "America/Mexico_City" } });
    expect(timingBody({ ...base, freq: "once" })).toEqual({ at: { date: "2026-11-09", time: "09:03:00", time_zone: "America/Mexico_City" } });
  });

  it("freqOf maps the rule's kind", () => {
    expect([freqOf({ kind: "daily" }), freqOf({ kind: "every" }), freqOf({ kind: "at" }), freqOf({ kind: "after" })]).toEqual(["daily", "hours", "once", "once"]);
  });
});
