// Booking availability engine — PURE functions, no DB, no Date.now(). Every
// source of nondeterminism (now, busy intervals, visitor tz) is injected, so
// the whole thing is exhaustively unit-testable (see availability.test.ts).
//
// Pipeline: civil days in the creator's zone → that day's working ranges
// (exceptions override weekly) → step into candidate slots → resolve each wall
// time to UTC (drop spring-gap times) → subtract busy intervals (buffered,
// half-open) → re-assert lead/horizon → render labels in the visitor's zone.

import {
  getZoneOffsetMs,
  isKnownTimeZone,
  utcToWallParts,
  wallTimeToUtc,
} from "./tz";

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0=Sun

export interface DayRange {
  startMin: number; // minutes from creator-local midnight
  endMin: number; // may exceed 1440 (range crosses midnight)
}

export interface BookingException {
  date: string; // creator-local YYYY-MM-DD
  blackout?: boolean; // true → no availability that day
  ranges?: DayRange[]; // present → OVERRIDES the weekly hours
}

export interface BookingRules {
  durationMin: number;
  slotIncrementMin: number; // 0 → use durationMin
  bufferBeforeMin: number;
  bufferAfterMin: number;
  minLeadTimeMin: number;
  maxDaysAhead: number;
  creatorTz: string;
  weeklyHours: Partial<Record<Weekday, DayRange[]>>;
  exceptions: BookingException[];
}

export interface BusyInterval {
  startUtcMs: number;
  endUtcMs: number; // half-open [start, end)
}

export interface SlotUtc {
  startUtcMs: number;
  endUtcMs: number;
  label: string; // "HH:MM" in the visitor's zone
  localDate: string; // YYYY-MM-DD in the visitor's zone
}

const DAY_MS = 86400000;
const MIN_MS = 60000;

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
function ymd(y: number, mo: number, d: number): string {
  return `${y}-${pad(mo)}-${pad(d)}`;
}

/** Civil dates (in `tz`) touched by [startUtcMs, endUtcMs], inclusive of both
 *  endpoints' local dates. Walks civil dates, not UTC midnights (a UTC walk
 *  mislabels weekdays near zone boundaries). */
export function localCivilDaysInRange(
  startUtcMs: number,
  endUtcMs: number,
  tz: string,
): Array<{ y: number; mo: number; d: number; weekday: Weekday }> {
  const out: Array<{ y: number; mo: number; d: number; weekday: Weekday }> = [];
  if (endUtcMs < startUtcMs) return out;
  const startWall = utcToWallParts(startUtcMs, tz);
  const endWall = utcToWallParts(endUtcMs, tz);
  let cursor = Date.UTC(startWall.y, startWall.mo - 1, startWall.d);
  const last = Date.UTC(endWall.y, endWall.mo - 1, endWall.d);
  // Guard against a runaway loop on absurd inputs.
  let guard = 0;
  while (cursor <= last && guard < 800) {
    const dt = new Date(cursor);
    out.push({
      y: dt.getUTCFullYear(),
      mo: dt.getUTCMonth() + 1,
      d: dt.getUTCDate(),
      weekday: dt.getUTCDay() as Weekday,
    });
    cursor += DAY_MS;
    guard++;
  }
  return out;
}

/** The working ranges for one civil day: an exception for that date overrides
 *  the weekly hours (blackout → none); otherwise the weekday's weekly hours. */
export function rangesForDay(
  rules: BookingRules,
  day: { y: number; mo: number; d: number; weekday: Weekday },
): DayRange[] {
  const dateStr = ymd(day.y, day.mo, day.d);
  const exc = rules.exceptions.find((e) => e.date === dateStr);
  if (exc) {
    if (exc.blackout) return [];
    if (exc.ranges) return exc.ranges;
  }
  return rules.weeklyHours[day.weekday] ?? [];
}

/** True if a candidate (with its buffers) does NOT overlap any busy interval.
 *  Half-open intervals: adjacency (a ends exactly when b starts) is NOT an
 *  overlap. The candidate occupies [start-bufBefore, start+duration+bufAfter). */
export function subtractBusy(
  candidateUtcMs: number,
  durationMin: number,
  bufferBeforeMin: number,
  bufferAfterMin: number,
  busy: BusyInterval[],
): boolean {
  const blockStart = candidateUtcMs - bufferBeforeMin * MIN_MS;
  const blockEnd = candidateUtcMs + (durationMin + bufferAfterMin) * MIN_MS;
  for (const b of busy) {
    if (blockStart < b.endUtcMs && b.startUtcMs < blockEnd) return false;
  }
  return true;
}

/** Roll a creator-local "minutes from midnight" (possibly ≥1440) into a civil
 *  wall date+time, carrying days over. */
function minToWall(
  day: { y: number; mo: number; d: number },
  totalMin: number,
): { y: number; mo: number; d: number; h: number; mi: number } {
  const carryDays = Math.floor(totalMin / 1440);
  const dayMin = totalMin - carryDays * 1440;
  const base = new Date(Date.UTC(day.y, day.mo - 1, day.d) + carryDays * DAY_MS);
  return {
    y: base.getUTCFullYear(),
    mo: base.getUTCMonth() + 1,
    d: base.getUTCDate(),
    h: Math.floor(dayMin / 60),
    mi: dayMin % 60,
  };
}

export function generateSlots(
  rules: BookingRules,
  opts: {
    nowUtcMs: number;
    rangeStartUtcMs: number;
    rangeEndUtcMs: number;
    visitorTz: string;
    busy: BusyInterval[];
  },
): SlotUtc[] {
  const increment = rules.slotIncrementMin > 0 ? rules.slotIncrementMin : rules.durationMin;
  if (increment <= 0 || rules.durationMin <= 0) return [];

  const leadFloor = opts.nowUtcMs + rules.minLeadTimeMin * MIN_MS;
  const horizonCeil = opts.nowUtcMs + rules.maxDaysAhead * DAY_MS;
  const effStart = Math.max(opts.rangeStartUtcMs, leadFloor);
  const effEnd = Math.min(opts.rangeEndUtcMs, horizonCeil);
  if (effEnd <= effStart) return [];

  const visTz = isKnownTimeZone(opts.visitorTz) ? opts.visitorTz : rules.creatorTz;

  // Iterate the creator-local civil days the window touches, plus the previous
  // day (a midnight-crossing range can spill its slots into the window).
  const days = localCivilDaysInRange(effStart - DAY_MS, effEnd, rules.creatorTz);

  const out: SlotUtc[] = [];
  const seen = new Set<number>();
  for (const day of days) {
    for (const range of rangesForDay(rules, day)) {
      for (
        let startMin = range.startMin;
        startMin + rules.durationMin <= range.endMin;
        startMin += increment
      ) {
        const w = minToWall(day, startMin);
        const r = wallTimeToUtc(w.y, w.mo, w.d, w.h, w.mi, rules.creatorTz);
        if (!r.existed) continue; // spring-forward gap — never happened
        const startUtcMs = r.utcMs;
        if (startUtcMs < effStart || startUtcMs >= effEnd) continue;
        if (seen.has(startUtcMs)) continue;
        if (
          !subtractBusy(
            startUtcMs,
            rules.durationMin,
            rules.bufferBeforeMin,
            rules.bufferAfterMin,
            opts.busy,
          )
        )
          continue;
        seen.add(startUtcMs);
        const vw = utcToWallParts(startUtcMs, visTz);
        out.push({
          startUtcMs,
          endUtcMs: startUtcMs + rules.durationMin * MIN_MS,
          label: `${pad(vw.h)}:${pad(vw.mi)}`,
          localDate: ymd(vw.y, vw.mo, vw.d),
        });
      }
    }
  }
  out.sort((a, b) => a.startUtcMs - b.startUtcMs);
  return out;
}

// Re-export for callers that need to validate a creator tz at the edge.
export { isKnownTimeZone, getZoneOffsetMs };
