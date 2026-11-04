// THE OWNER'S REPLY TO A PERSON (spec local 2026-11-04-hazlo-que-se-puede-y-mas-fuentes, §7.3, §7.6.3, §7.6.6): DeepSeek's
// channel writes, as stored work. The attempt is recorded BEFORE it is made, the email goes with the card's idempotency
// key (Resend keeps one email per key, so a retry after a restart can't send a second), and a passing failure (429, 5xx)
// is tried again by the watcher's pass with a backoff of 5 s doubling to 300 s, until it goes out or the owner withdraws
// it. A final refusal is failed with Resend's own message. It is its own kind of email, `reply`: the project's domain,
// the owner's Reply-To, the plan's hourly cap and monthly allowance, not the form reply's brakes.
import "server-only";

import type { SendInput, SendOutcome } from "@/lib/project-email/send";

import type { EventTaskCardRow } from "../store";
import type { ActionLog } from "./log";
import { EXPIRED, WITHDRAWN, type ActionState, type CardActionRecord } from "./types";

export interface SendReplyDeps {
  send(i: SendInput): Promise<SendOutcome>;
  /** The project's sending address, null while its email isn't ready. */
  fromOf(projectId: string): Promise<string | null>;
  record(cardId: string, index: number, patch: Partial<Omit<CardActionRecord, "action">>): Promise<void>;
  /** Who was written to, in the task's Registros too (spec §7.3). */
  log: ActionLog;
}

const FIRST_WAIT_S = 5;
const LONGEST_WAIT_S = 300;

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const html = (body: string) =>
  body
    .split(/\r?\n\s*\r?\n/)
    .map((p) => `<p>${escapeHtml(p).replace(/\r?\n/g, "<br>")}</p>`)
    .join("");
/** Resend keeps an idempotency key for a day: past it, another try could send a second email, and a day late is out
 *  of context anyway (final review I2). */
const SEND_DEADLINE_MS = 86_400_000;
/** Refusals that waiting minutes won't change: the plan's month or day is spent (lib/project-email/send.ts). */
const QUOTA = new Set(["monthly_quota_exceeded", "daily_quota_exceeded"]);
/** Worth another try: the hourly cap or Resend itself; anything else is final. */
const passing = (e: { statusCode: number; name: string }) => (e.statusCode === 429 && !QUOTA.has(e.name)) || e.statusCode >= 500;

export async function sendReply(card: EventTaskCardRow, index: number, deps: SendReplyDeps, now: Date): Promise<{ state: ActionState; error: string | null }> {
  const rec = card.actions?.[index];
  if (!rec || rec.action.kind !== "reply") return { state: "failed", error: "This card has no reply there." };
  if (rec.state === "done" || rec.state === "failed" || rec.state === "blocked") return { state: rec.state, error: rec.error };
  const a = rec.action;
  const attempts = rec.attempts + 1;
  const fail = async (error: string) => {
    await deps.record(card.id, index, { state: "failed", nextAttemptAt: null, error });
    return { state: "failed" as const, error };
  };
  if (card.decidedAt && now.getTime() - card.decidedAt.getTime() > SEND_DEADLINE_MS) return fail(EXPIRED);
  // Recorded first: a restart finds it «sending» and tries again with the same key.
  await deps.record(card.id, index, { state: "sending", attempts, nextAttemptAt: null });
  const from = await deps.fromOf(card.projectId);
  if (!from) return fail("The project's email isn't ready.");
  const r = await deps.send({
    projectId: card.projectId,
    environment: "live",
    kind: "reply",
    idempotencyKey: `event-card:${card.id}:reply`,
    email: { from, to: [a.to], subject: a.subject, text: a.body, html: html(a.body) },
  });
  if (r.kind === "sent") {
    await deps.record(card.id, index, { state: "done", nextAttemptAt: null, error: null, result: a.to });
    await deps.log(card, "sent", a.to);
    return { state: "done", error: null };
  }
  if (r.kind !== "rejected") return fail("The email wasn't sent.");
  if (!passing(r.error)) return fail(r.error.message);
  const wait = Math.min(LONGEST_WAIT_S, FIRST_WAIT_S * 2 ** (attempts - 1));
  await deps.record(card.id, index, { state: "sending", nextAttemptAt: new Date(now.getTime() + wait * 1000).toISOString(), error: r.error.message });
  return { state: "sending", error: r.error.message };
}

/** The watcher's pass: every reply still sending whose wait is over. */
export async function retryPendingSends(now: Date, deps: SendReplyDeps & { sending(): Promise<EventTaskCardRow[]> }): Promise<void> {
  for (const card of await deps.sending()) {
    for (const [index, rec] of (card.actions ?? []).entries()) {
      if (rec.action.kind !== "reply" || rec.state !== "sending") continue;
      if (rec.nextAttemptAt && Date.parse(rec.nextAttemptAt) > now.getTime()) continue;
      try {
        await sendReply(card, index, deps, now);
      } catch (err) {
        console.error(`[event-tasks] the reply of card ${card.id} could not be retried`, err);
      }
    }
  }
}

/** «Retirar»: the owner stops a send that keeps failing. */
export async function withdrawSend(cardId: string, index: number, deps: Pick<SendReplyDeps, "record">): Promise<void> {
  await deps.record(cardId, index, { state: "failed", nextAttemptAt: null, error: WITHDRAWN });
}

/** The real parts: the project email's sending core, its address, the card's record. */
export async function defaultSendReplyDeps(): Promise<SendReplyDeps & { sending(): Promise<EventTaskCardRow[]> }> {
  const [{ sendProjectEmail }, { realSendDeps }, { emailStateFor }, cards, { defaultActionLog }] = await Promise.all([
    import("@/lib/project-email/send"),
    import("@/lib/project-email/real"),
    import("@/lib/project-email/state"),
    import("../cards"),
    import("./log"),
  ]);
  return {
    log: await defaultActionLog(),
    send: (i) => sendProjectEmail(i, realSendDeps()),
    fromOf: async (projectId) => (await emailStateFor(projectId))?.from ?? null,
    record: cards.updateCardAction,
    sending: cards.cardsWithSendingActions,
  };
}
