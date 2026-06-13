// Bridge a stored service row to the pure availability engine, and the single
// server-side slot-legitimacy check used by the book route. A visitor can POST
// any instant they like; this is where we PROVE the instant is a real, bookable
// slot under the current rules (hours, lead time, horizon, DST gaps, busy) —
// never trust the client's claim that "this slot was offered".

import {
  generateSlots,
  type BookingRules,
  type BusyInterval,
} from "@/lib/bookings/availability";
import type { ServiceRow } from "@/lib/bookings/store";

export function serviceToRules(s: ServiceRow): BookingRules {
  return {
    durationMin: s.durationMin,
    slotIncrementMin: s.slotIncrementMin,
    bufferBeforeMin: s.bufferBeforeMin,
    bufferAfterMin: s.bufferAfterMin,
    minLeadTimeMin: s.minLeadTimeMin,
    maxDaysAhead: s.maxDaysAhead,
    creatorTz: s.creatorTz,
    weeklyHours: s.weeklyHours,
    exceptions: s.exceptions,
  };
}

/** True iff `startUtcMs` is an instant the engine WOULD have offered right now
 *  for this service, given the live busy set. Uses a one-minute window so only
 *  the exact aligned instant can match — an unaligned, past, blacked-out,
 *  spring-gap, or busy-overlapping time fails. */
export function isSlotBookable(params: {
  service: ServiceRow;
  startUtcMs: number;
  nowUtcMs: number;
  visitorTz: string;
  busy: BusyInterval[];
}): boolean {
  const slots = generateSlots(serviceToRules(params.service), {
    nowUtcMs: params.nowUtcMs,
    rangeStartUtcMs: params.startUtcMs,
    rangeEndUtcMs: params.startUtcMs + 60000,
    visitorTz: params.visitorTz,
    busy: params.busy,
  });
  return slots.some((s) => s.startUtcMs === params.startUtcMs);
}
