// LOCAL TIMES (spec local 2026-11-24-servidor-de-google-calendar, §5.3): the tools take Google's convention, a local
// ISO 8601 time with no offset plus an IANA zone. The Calendar API takes that pair as it is for an event's start and
// end; a query bound (`timeMin`, `timeMax`, `freeBusy`) needs RFC 3339 with the offset that zone has ON THAT DATE.
import { Temporal } from "@js-temporal/polyfill";

const HAS_OFFSET = /(?:Z|[+-]\d{2}:?\d{2})$/i;

/** Whether a time already carries Z or an offset (then it is an instant, not a wall time in a zone). */
export const hasOffset = (local: string): boolean => HAS_OFFSET.test(local);

/** A local time in `timeZone` as RFC 3339 with its offset; a time that already carries one (or Z) is kept. */
export function toRfc3339(local: string, timeZone: string): string {
  if (HAS_OFFSET.test(local)) return local;
  const plain = local.includes("T") ? Temporal.PlainDateTime.from(local) : Temporal.PlainDate.from(local).toPlainDateTime();
  const zoned = plain.toZonedDateTime(timeZone, { disambiguation: "compatible" });
  return zoned.toString({ timeZoneName: "never", smallestUnit: "second" });
}

/** An event's start or end as the Calendar API takes it. */
export function eventTime(local: string, timeZone: string, allDay: boolean): { date: string } | { dateTime: string; timeZone: string } {
  if (allDay) return { date: local.slice(0, 10) };
  return { dateTime: local, timeZone };
}
