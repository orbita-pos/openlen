// lib/google-calendar-mcp/time.test.ts
// @vitest-environment node
//
// The tools take Google's time convention: a local ISO 8601 time with no offset plus an IANA time zone (spec local
// 2026-11-24-servidor-de-google-calendar, §5.3).
import { describe, expect, it } from "vitest";
import { eventTime, toRfc3339 } from "./time";

describe("toRfc3339", () => {
  it("a local time in America/Mexico_City gets its -06:00", () => {
    expect(toRfc3339("2026-11-25T10:00:00", "America/Mexico_City")).toBe("2026-11-25T10:00:00-06:00");
  });

  // Review Focus 1: a daylight-saving change never shifts a time by an hour.
  it("🔴 across Europe/Madrid's daylight-saving changes, each date gets its own offset", () => {
    expect(toRfc3339("2026-03-29T01:30:00", "Europe/Madrid")).toBe("2026-03-29T01:30:00+01:00");
    expect(toRfc3339("2026-03-29T03:30:00", "Europe/Madrid")).toBe("2026-03-29T03:30:00+02:00");
    expect(toRfc3339("2026-10-24T12:00:00", "Europe/Madrid")).toBe("2026-10-24T12:00:00+02:00");
    expect(toRfc3339("2026-10-25T12:00:00", "Europe/Madrid")).toBe("2026-10-25T12:00:00+01:00");
  });

  it("a time that already carries an offset or Z is kept as it is", () => {
    expect(toRfc3339("2026-11-25T10:00:00Z", "Europe/Madrid")).toBe("2026-11-25T10:00:00Z");
    expect(toRfc3339("2026-11-25T10:00:00-05:00", "Europe/Madrid")).toBe("2026-11-25T10:00:00-05:00");
  });

  it("a date alone is midnight in that zone", () => {
    expect(toRfc3339("2026-11-25", "America/Mexico_City")).toBe("2026-11-25T00:00:00-06:00");
  });
});

describe("eventTime", () => {
  it("all day: a date with no time", () => {
    expect(eventTime("2026-11-25T00:00:00", "Europe/Madrid", true)).toEqual({ date: "2026-11-25" });
  });

  it("otherwise: the local time with its zone, as the Calendar API takes it", () => {
    expect(eventTime("2026-11-25T10:00:00", "Europe/Madrid", false)).toEqual({ dateTime: "2026-11-25T10:00:00", timeZone: "Europe/Madrid" });
  });
});
