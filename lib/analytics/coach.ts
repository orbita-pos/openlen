// Page Coach — turns the conversion funnel into ONE highest-leverage page
// improvement. Deterministic (no AI, no hallucination): a small priority
// ruleset over the funnel numbers. The "action" tips carry an apply-via-chat
// CTA whose instruction is a localized string (panelsB.coach.instruction.<id>)
// fed to the existing ai-design Chat flow — the AI does the actual page edit.
//
// This is the P3 product surface: the raw funnel is a secondary view; the
// coach tip is the headline the non-technical creator can act on in one tap.

import type { Funnel } from "@/lib/analytics/queries";

export type CoachTipId =
  | "no-clicks"
  | "low-ctr"
  | "no-leads"
  | "healthy"
  | "insufficient";

export type CoachTone = "action" | "good" | "info";

export interface CoachTip {
  id: CoachTipId;
  tone: CoachTone;
  /** ICU params for the localized message (panelsB.coach.tip.<id>). */
  params: Record<string, number>;
}

/** Minimum views before the coach offers advice — below this it's noise. */
export const COACH_MIN_VIEWS = 10;
/** CTR below this (with ≥1 click) reads as a weak call-to-action. */
const LOW_CTR = 0.1;

/** Derive the single highest-leverage page improvement from the funnel.
 *  Priority order: no traffic → no clicks → weak CTR → no leads → healthy.
 *  tone==="action" tips render an "Apply with AI" button in the UI. */
export function getCoachTip(f: Funnel): CoachTip {
  if (f.saw < COACH_MIN_VIEWS) {
    return { id: "insufficient", tone: "info", params: { views: f.saw } };
  }
  const ctr = f.saw > 0 ? f.clicked / f.saw : 0;
  if (f.clicked === 0) {
    return { id: "no-clicks", tone: "action", params: { views: f.saw } };
  }
  if (ctr < LOW_CTR) {
    return { id: "low-ctr", tone: "action", params: { pct: Math.round(ctr * 100) } };
  }
  // Count EVERY conversion signal, not just cid-tracked form leads: bookings
  // and untracked (native no-JS) submissions/bookings all mean the page is
  // converting. Otherwise a Bookings-only page (or a native-POST form) gets the
  // wrong "add a form" advice while its own funnel bar shows conversions.
  const conversions =
    f.submitted + f.booked + f.untrackedLeads + f.untrackedBookings;
  if (conversions === 0) {
    return { id: "no-leads", tone: "action", params: { clicks: f.clicked } };
  }
  return {
    id: "healthy",
    tone: "good",
    params: { views: f.saw, leads: f.submitted + f.booked },
  };
}

/** True for tips that carry an apply-via-chat action (have an instruction). */
export function isActionable(tip: CoachTip): boolean {
  return tip.tone === "action";
}
