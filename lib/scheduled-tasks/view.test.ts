// What the model reads of a task: DeepSeek's view plus the next run in local time (spec §7.1, Claude
// Code's "give that time, not the minute in the cron expression").
import { describe, expect, it } from "vitest";

import {
  ScheduleId,
  createDailyScheduleRecord,
  createEveryScheduleRecord,
  createWeeklyScheduleRecord,
  resolveRecurringOccurrence,
} from "./deepseek/domain";
import { viewForModel } from "./view";

describe("viewForModel", () => {
  it("gives the next run in the rule's zone", () => {
    const now = Date.parse("2026-11-01T20:00:00Z");
    const r = createDailyScheduleRecord(ScheduleId("d"), "p", { time: "09:03:00", time_zone: "America/Mexico_City" }, now, "T");
    const v = viewForModel(r, now, "Europe/Madrid");
    expect(v.scheduledAtLocal).toBe("2026-11-02T09:03:00-06:00[America/Mexico_City]");
    expect(v.state).toBe("scheduled");
    expect(v.id).toBe("d");
  });

  it("uses the task's zone for rules that carry none", () => {
    const now = Date.parse("2026-11-01T20:00:00Z");
    const r = createEveryScheduleRecord(ScheduleId("e"), "p", 3600, now, "T");
    expect(viewForModel(r, now, "America/Mexico_City").scheduledAtLocal).toBe("2026-11-01T15:00:00-06:00[America/Mexico_City]");
  });
});

describe("DeepSeek's weekly rule across a DST change", () => {
  it("keeps Monday 09:03 local in Madrid after the October change", () => {
    const r = createWeeklyScheduleRecord(ScheduleId("w"), "p", { time: "09:03:00", time_zone: "Europe/Madrid", weekdays: [1] }, Date.parse("2026-10-20T12:00:00Z"), "T");
    expect(r.scheduledAt).toBe("2026-10-26T08:03:00.000Z");
    expect(resolveRecurringOccurrence(r, Date.parse("2026-10-26T08:04:00Z")).nextScheduledAt).toBe("2026-11-02T08:03:00.000Z");
  });
});
