// THE OWNER'S DAY (spec local 2026-11-06-asistente-propio, §6.9, phase 4D): today, the hour, and yesterday's bounds as
// instants, in the owner's zone — with Temporal, as Len's scheduled tasks (lib/scheduled-tasks/deepseek/, DeepSeek's).
// A zone that doesn't exist is Lima's, the default of the owners' notification preferences. Pure.
import { Temporal } from "@js-temporal/polyfill";

export const DEFAULT_TIME_ZONE = "America/Lima";

export interface DayBounds {
  /** The owner's local day, YYYY-MM-DD. */
  readonly today: string;
  /** The owner's local hour, 0–23. */
  readonly hour: number;
  readonly yesterdayStart: Date;
  readonly yesterdayEnd: Date;
}

export function dayBounds(now: Date, timeZone: string): DayBounds {
  let zoned: Temporal.ZonedDateTime;
  try {
    zoned = Temporal.Instant.fromEpochMilliseconds(now.getTime()).toZonedDateTimeISO(timeZone);
  } catch {
    zoned = Temporal.Instant.fromEpochMilliseconds(now.getTime()).toZonedDateTimeISO(DEFAULT_TIME_ZONE);
  }
  const today = zoned.toPlainDate();
  const zone = zoned.timeZoneId;
  return {
    today: today.toString(),
    hour: zoned.hour,
    yesterdayStart: new Date(today.subtract({ days: 1 }).toZonedDateTime({ timeZone: zone }).epochMilliseconds),
    yesterdayEnd: new Date(today.toZonedDateTime({ timeZone: zone }).epochMilliseconds),
  };
}
