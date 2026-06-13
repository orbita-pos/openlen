// Comment-post anti-abuse. Members-only commenting already kills anonymous
// spam; these caps stop a logged-in member from flooding a thread. Per-member
// keys are project-scoped so a member of site A can't burn site B's budget.

import { createHash } from "node:crypto";
import type { LimitWindow } from "@/lib/limits";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

export const COMMENT_POST_LIMITS: LimitWindow[] = [
  { windowMs: MINUTE, max: 2, label: "cooldown" },
  { windowMs: HOUR, max: 30, label: "hourly" },
];

/** Per-member, project-scoped post key (memberId hashed — no PII in the
 *  rate-limit ledger, and bounded length). */
export function commentPostKey(projectId: string, memberId: string): string {
  const h = createHash("sha256").update(memberId).digest("hex").slice(0, 16);
  return `member:${projectId}:${h}:comment-post`;
}
