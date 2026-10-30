// Which notices go through the owner's quiet hours — like a pager's high urgency, or iOS's
// «Time Sensitive»: only what needs a person now.
import { describe, expect, it } from "vitest";

import { breaksQuietHours } from "./urgency";
import type { LenWatchEvent, LenWatchPhase } from "./types";

const watch = (phase: LenWatchPhase): LenWatchEvent => ({ type: "len_watch", projectId: "p1", recipientUserId: "u1", incidentId: "i1", phase, title: "t", body: "b", emailSubject: "s", emailText: "x" });

describe("breaksQuietHours", () => {
  it("the site is down and needs a person: it goes through", () => {
    for (const phase of ["down", "fix_ready", "fix_failed", "needs_owner"] as const) expect(breaksQuietHours(watch(phase)), phase).toBe(true);
  });

  it("Len is on it, or it's back: it waits for the morning", () => {
    for (const phase of ["fixing", "fixed", "recovered"] as const) expect(breaksQuietHours(watch(phase)), phase).toBe(false);
  });

  it("nothing else does", () => {
    expect(breaksQuietHours({ type: "len_turno", projectId: "p1", recipientUserId: "u1", preview: "x", pregunta: true })).toBe(false);
    expect(breaksQuietHours({ type: "functions_quota", projectId: "p1", recipientUserId: "u1", percent: 100, calls: 1, limit: 1 })).toBe(false);
  });
});
