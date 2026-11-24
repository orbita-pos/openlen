// `suggest_time`'s FREE PERIODS (spec local 2026-11-24-servidor-de-google-calendar, §5.3). Pure, so it is tested with no
// network: the busy intervals of everyone asked (from freeBusy) are merged, and the gaps left inside the window — and
// inside `startHour`–`endHour` of each LOCAL day, weekends skipped if asked — that last at least `durationMinutes` are
// the periods, the first `pageSize` of them. Day boundaries are computed in the zone, so a daylight-saving change never
// moves the hours.
import { Temporal } from "@js-temporal/polyfill";

export interface Interval {
  readonly start: string;
  readonly end: string;
}

export interface FreeSlotOptions {
  readonly durationMinutes: number;
  readonly pageSize: number;
  readonly startHour?: string;
  readonly endHour?: string;
  readonly excludeWeekends?: boolean;
  readonly timeZone: string;
}

const ms = (iso: string) => Temporal.Instant.from(iso).epochMilliseconds;

function local(epochMs: number, timeZone: string): string {
  return Temporal.Instant.fromEpochMilliseconds(epochMs).toZonedDateTimeISO(timeZone).toString({ timeZoneName: "never", smallestUnit: "second" });
}

/** "HH:mm" as minutes since midnight; "24:00" is the end of the day. */
function minutesOf(hhmm: string | undefined, fallback: number): number {
  if (!hhmm) return fallback;
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return fallback;
  return Math.min(24 * 60, Number(m[1]) * 60 + Number(m[2]));
}

/** The [start, end) of each local day's allowed hours that the window touches, in epoch ms. */
function allowedRanges(window: Interval, o: FreeSlotOptions): [number, number][] {
  const from = ms(window.start);
  const to = ms(window.end);
  const fromHour = minutesOf(o.startHour, 0);
  const toHour = minutesOf(o.endHour, 24 * 60);
  const ranges: [number, number][] = [];
  let day = Temporal.Instant.fromEpochMilliseconds(from).toZonedDateTimeISO(o.timeZone).toPlainDate();
  for (;;) {
    const dayStart = day.toZonedDateTime({ timeZone: o.timeZone }).epochMilliseconds;
    if (dayStart >= to) break;
    const weekend = day.dayOfWeek === 6 || day.dayOfWeek === 7;
    if (!(o.excludeWeekends && weekend)) {
      const at = (minutes: number) =>
        minutes >= 24 * 60
          ? day.add({ days: 1 }).toZonedDateTime({ timeZone: o.timeZone }).epochMilliseconds
          : day.toZonedDateTime({ timeZone: o.timeZone, plainTime: Temporal.PlainTime.from({ hour: Math.floor(minutes / 60), minute: minutes % 60 }) }).epochMilliseconds;
      const start = Math.max(from, at(fromHour));
      const end = Math.min(to, at(toHour));
      if (end > start) ranges.push([start, end]);
    }
    day = day.add({ days: 1 });
  }
  return ranges;
}

export function freeSlots(busy: readonly Interval[], window: Interval, o: FreeSlotOptions): Interval[] {
  const merged = busy
    .map((b) => [ms(b.start), ms(b.end)] as [number, number])
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0])
    .reduce<[number, number][]>((acc, cur) => {
      const last = acc.at(-1);
      if (last && cur[0] <= last[1]) last[1] = Math.max(last[1], cur[1]);
      else acc.push([cur[0], cur[1]]);
      return acc;
    }, []);
  const minMs = o.durationMinutes * 60_000;
  const out: Interval[] = [];
  for (const [rangeStart, rangeEnd] of allowedRanges(window, o)) {
    let cursor = rangeStart;
    for (const [bs, be] of merged) {
      if (be <= cursor) continue;
      if (bs >= rangeEnd) break;
      if (bs - cursor >= minMs) out.push({ start: local(cursor, o.timeZone), end: local(Math.min(bs, rangeEnd), o.timeZone) });
      cursor = Math.max(cursor, be);
      if (cursor >= rangeEnd) break;
    }
    if (rangeEnd - cursor >= minMs) out.push({ start: local(cursor, o.timeZone), end: local(rangeEnd, o.timeZone) });
    if (out.length >= o.pageSize) break;
  }
  return out.slice(0, o.pageSize);
}
