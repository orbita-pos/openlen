// WHAT THE VISITORS COST THE OWNER (spec local 2026-11-06-asistente-propio, §4.7, §6.2): the owner's credits, within a
// monthly cap of the ACCOUNT — a quarter of the plan unless the owner chose another —, as the apps' AI does
// (`lib/app-ai/limits.ts`, `lib/app-ai/cap.ts`). A viral page can't drain what the owner keeps for building with Len.
// Out of credits or out of room, the assistant falls asleep: the visitor reads «I'm not here now» and never anything
// about billing.
//
// Pure (the reservations live in this process, like the apps').
import { CapReservations } from "@/lib/app-ai/cap";
import { monthlyCap } from "@/lib/app-ai/limits";

/** What a visitor's turn holds while it runs, in centicredits: the most one may cost (Task 10 measures it). */
export const VISITOR_TURN_RESERVE = 50;

export type Sleep = "cap" | "credits";

/** "YYYY-MM", UTC. */
export function visitorMonth(now: Date): string {
  return now.toISOString().slice(0, 7);
}

/** The month's cap in centicredits: the owner's own (0 … the whole plan) or a quarter of the plan. */
export function visitorCap(explicit: number | null, allotment: number): number {
  return monthlyCap(explicit, allotment);
}

/** Why the assistant sleeps now, or null when one more turn fits. */
export function sleepReason(o: { readonly balance: number; readonly spent: number; readonly inFlight: number; readonly cap: number }): Sleep | null {
  if (o.balance <= 0) return "credits";
  if (o.spent + o.inFlight + VISITOR_TURN_RESERVE > o.cap) return "cap";
  return null;
}

/** The turns in flight against each account's cap, in this process. */
export const visitorReservations = new CapReservations();
