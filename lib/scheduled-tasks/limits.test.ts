// OpenLen's own limits on top of DeepSeek's schedule domain (spec local 2026-10-29-tareas-programadas, §7.2).
import { describe, expect, it } from "vitest";

import {
  ScheduleId,
  createAtScheduleRecord,
  createCronScheduleRecord,
  createDailyScheduleRecord,
  createEveryScheduleRecord,
  createWeeklyScheduleRecord,
} from "./deepseek/domain";
import { checkOpenLenLimits, OPENLEN_MIN_INTERVAL_SECONDS } from "./limits";

const NOW = Date.parse("2026-11-01T20:00:00Z");

describe("checkOpenLenLimits", () => {
  it("the minimum interval is one hour", () => {
    expect(OPENLEN_MIN_INTERVAL_SECONDS).toBe(3600);
  });

  it("rejects every_seconds below one hour", () => {
    const r = createEveryScheduleRecord(ScheduleId("e"), "p", 1800, NOW, "T");
    expect(() => checkOpenLenLimits(r)).toThrow(expect.objectContaining({ code: "frequency_too_high", message: expect.stringMatching(/1 hour/) }));
  });

  it("accepts every_seconds of exactly one hour", () => {
    expect(() => checkOpenLenLimits(createEveryScheduleRecord(ScheduleId("e"), "p", 3600, NOW, "T"))).not.toThrow();
  });

  it("rejects a cron that can fire twice within an hour", () => {
    for (const expression of ["*/30 * * * *", "0,30 9 * * *", "0-5 9 * * 1"]) {
      const r = createCronScheduleRecord(ScheduleId("c"), "p", { expression, time_zone: "UTC" }, NOW, "T");
      expect(() => checkOpenLenLimits(r), expression).toThrow(expect.objectContaining({ code: "invalid_rule", message: expect.stringMatching(/Minimum interval is 1 hour\./) }));
    }
  });

  it("accepts a cron with a single minute", () => {
    const r = createCronScheduleRecord(ScheduleId("c"), "p", { expression: "3 9 * * 1", time_zone: "America/Mexico_City" }, NOW, "T");
    expect(r.expression).toBe("3 9 * * 1");
    expect(() => checkOpenLenLimits(r)).not.toThrow();
  });

  it("accepts daily, weekly and one-shot rules", () => {
    expect(() => checkOpenLenLimits(createDailyScheduleRecord(ScheduleId("d"), "p", { time: "09:03:00", time_zone: "UTC" }, NOW, "T"))).not.toThrow();
    expect(() => checkOpenLenLimits(createWeeklyScheduleRecord(ScheduleId("w"), "p", { time: "09:03:00", time_zone: "UTC", weekdays: [1] }, NOW, "T"))).not.toThrow();
    expect(() => checkOpenLenLimits(createAtScheduleRecord(ScheduleId("a"), "p", "2026-11-02T09:03:00-06:00", NOW, "T"))).not.toThrow();
  });
});
