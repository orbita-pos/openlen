// A PRESS CUT OFF HALF WAY (spec local 2026-11-04-hazlo-que-se-puede-y-mas-fuentes, §7.3; final review I1). Accepting a
// card commits first and its actions run after, so a deploy or a restart in between leaves an action `pending` on an
// accepted card, and nothing would ever finish it. The watcher's pass does, a little after the press (PRESS_GRACE_MS, so
// a press still under way is left alone), and never by applying late: a change is recorded done only if the row already
// has it, otherwise as cut off with what the row has now; a reply goes out only if its change is done or there was none
// (DeepSeek's «check before repeating an outside action»); a project action is done if its turn started.
import "server-only";

import type { EventTaskCardRow } from "../store";
import { asText, changeLine } from "./apply";
import { sendReply, type SendReplyDeps } from "./send";
import { INTERRUPTED, NOT_SENT_CHANGE, type CardActionRecord } from "./types";

/** Longer than a press takes to apply and to record its first send attempt. */
export const PRESS_GRACE_MS = 120_000;

export interface ResumeDeps extends SendReplyDeps {
  /** Accepted cards decided before `before` with an action still `pending` (../cards.ts). */
  interrupted(before: Date): Promise<EventTaskCardRow[]>;
  readRow(projectId: string, table: string, keyColumn: string, key: string): Promise<Record<string, unknown> | null>;
}

async function finish(card: EventTaskCardRow, deps: ResumeDeps, now: Date): Promise<void> {
  const records: CardActionRecord[] = [...(card.actions ?? [])];
  let changeDone = true;
  for (const [i, rec] of records.entries()) {
    if (rec.action.kind !== "data_change") continue;
    if (rec.state === "pending") {
      const a = rec.action;
      const [keyColumn, key] = Object.entries(a.key)[0]!;
      const row = await deps.readRow(card.projectId, a.table, keyColumn, key).catch(() => null);
      const applied = row !== null && Object.entries(a.set).every(([col, value]) => asText(row[col]) === value);
      const patch = applied
        ? { state: "done" as const, result: changeLine(a), error: null }
        : { state: "failed" as const, error: INTERRUPTED, result: row ? Object.keys(a.set).map((col) => `${col} ${asText(row[col])}`).join(", ") : null };
      await deps.record(card.id, i, patch);
      if (applied) await deps.log(card, "applied", changeLine(a));
      records[i] = { ...rec, ...patch };
    }
    changeDone &&= records[i]!.state === "done";
  }
  for (const [i, rec] of records.entries()) {
    if (rec.state !== "pending") continue;
    if (rec.action.kind === "reply") {
      if (changeDone) await sendReply({ ...card, actions: records }, i, deps, now);
      else await deps.record(card.id, i, { state: "failed", error: NOT_SENT_CHANGE });
    } else if (rec.action.kind === "project") {
      await deps.record(card.id, i, card.acceptedRowId ? { state: "done", result: card.acceptedRowId, error: null } : { state: "failed", error: INTERRUPTED });
    }
  }
}

/** The watcher's pass: every card a press left half done. One card's failure never stops the others. */
export async function resumeInterrupted(now: Date, deps: ResumeDeps): Promise<void> {
  for (const card of await deps.interrupted(new Date(now.getTime() - PRESS_GRACE_MS))) {
    try {
      await finish(card, deps, now);
    } catch (err) {
      console.error(`[event-tasks] card ${card.id} could not be finished after its press was cut off`, err);
    }
  }
}

export async function defaultResumeDeps(): Promise<ResumeDeps> {
  const [{ defaultSendReplyDeps }, { readRow }, cards] = await Promise.all([import("./send"), import("./production"), import("../cards")]);
  return { ...(await defaultSendReplyDeps()), interrupted: cards.interruptedCards, readRow };
}
