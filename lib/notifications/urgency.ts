// WHAT GOES THROUGH QUIET HOURS. The owner's quiet hours hold every notice back until the morning —
// except a published site that is down and needs a person now, like a pager's high urgency or iOS's
// «Time Sensitive». Len at work («fixing») and good news («fixed», «recovered») wait; with «fix and
// publish on its own», a 3 a.m. crash that Len fixes wakes nobody (spec local 2026-10-30-len-watch).
import type { NotificationEvent } from "./types";

const URGENT_LEN_WATCH = new Set(["down", "fix_ready", "fix_failed", "needs_owner"]);

export function breaksQuietHours(event: NotificationEvent): boolean {
  return event.type === "len_watch" && URGENT_LEN_WATCH.has(event.phase);
}
