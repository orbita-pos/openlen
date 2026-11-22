// THE MAILBOX between Len and the person's agents (spec local 2026-11-21-len-y-el-agente-conversan, §3 and decisions 6 and
// 9): every message is written here before anything wakes, and counts as delivered only when a turn reads it — as Claude
// Code's teammate mailbox marks a message read once it was handed over, and DeepSeek's registry keeps a message for its
// target. This is the storage only: who sends, who wakes and what the turn is told live elsewhere.
//
// A message is for an agent (`to_agent`) or for Len (`to_len`), about one project. Its life: `pending` (written) →
// `delivering` (it woke a turn) → `delivered` (a turn read it); `held` when it was kept without waking anyone (the
// count's cap, no credits, agents off) and goes with the recipient's next turn; `expired` when nobody read it in time.
import "server-only";

import { and, asc, eq, gt, gte, inArray, isNull, lt, max, ne, notInArray, or, sql, type SQL } from "drizzle-orm";

import { db, schema } from "@/lib/db";

import { assistantConversationKey } from "../conversation";
import { HELD_DAYS, RESUME_HOURS, type HeldReason, type MessageDirection, type MessageStatus } from "./policy";

export type { HeldReason, MessageDirection, MessageStatus };

export interface AgentLenMessage {
  readonly id: string;
  readonly assistantId: string;
  readonly projectId: string;
  readonly direction: MessageDirection;
  readonly text: string;
  /** The person's own words, when the turn that sent it carried one. */
  readonly ownerWords: string | null;
  readonly status: MessageStatus;
  readonly heldReason: HeldReason | null;
  readonly createdAt: Date;
  readonly deliveringAt: Date | null;
  readonly deliveredAt: Date | null;
}

const m = schema.agentLenMessages;
const chat = schema.projectChatMessages;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function toMessage(r: typeof m.$inferSelect): AgentLenMessage {
  return {
    id: r.id,
    assistantId: r.assistantId,
    projectId: r.projectId,
    direction: r.direction,
    text: r.text,
    ownerWords: r.ownerWords,
    status: r.status,
    heldReason: r.heldReason,
    createdAt: r.createdAt,
    deliveringAt: r.deliveringAt,
    deliveredAt: r.deliveredAt,
  };
}

/** Keeps a message, `pending`, before anything else happens to it. */
export async function addMessage(message: {
  readonly assistantId: string;
  readonly projectId: string;
  readonly direction: MessageDirection;
  readonly text: string;
  readonly ownerWords: string | null;
}): Promise<AgentLenMessage> {
  const [row] = await db
    .insert(m)
    .values({ assistantId: message.assistantId, projectId: message.projectId, direction: message.direction, text: message.text, ownerWords: message.ownerWords })
    .returning();
  return toMessage(row!);
}

/** When the person last wrote in either of the two chats a pair of Len and an agent talks in: the project's own chat (the
 *  conversation with Len) or the agent's conversation at its home. A row Len's server wrote — an agent's request, a
 *  scheduled task, a thread — carries an `origen` and is not the person. Null when they never did. */
export async function lastPersonMessageAt(assistantId: string, projectId: string, homeProjectId: string): Promise<Date | null> {
  const [row] = await db
    .select({ at: max(chat.createdAt) })
    .from(chat)
    .where(
      and(
        isNull(chat.origen),
        or(
          and(eq(chat.projectId, projectId), isNull(chat.conversation)),
          and(eq(chat.projectId, homeProjectId), eq(chat.conversation, assistantConversationKey(assistantId))),
        ),
      ),
    );
  return row?.at ?? null;
}

/** How many messages the pair has exchanged since `since` (all of them when null), in either direction: the count the
 *  cap of four is read from. One that expired never counts — including a held or pending row older than `HELD_DAYS` that
 *  `toResume` hasn't marked expired yet. */
export async function messagesSince(assistantId: string, projectId: string, since: Date | null, now: Date = new Date()): Promise<number> {
  const keptUntil = new Date(now.getTime() - HELD_DAYS * DAY);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(m)
    .where(
      and(
        eq(m.assistantId, assistantId),
        eq(m.projectId, projectId),
        ne(m.status, "expired"),
        or(notInArray(m.status, ["held", "pending"]), gte(m.createdAt, keptUntil)),
        since ? gt(m.createdAt, since) : undefined,
      ),
    );
  return row?.n ?? 0;
}

/** The message woke a turn. Only a `pending` one: a turn that already read it (`delivered`) is not taken back. */
export async function markDelivering(id: string, at: Date): Promise<void> {
  await db.update(m).set({ status: "delivering", deliveringAt: at }).where(and(eq(m.id, id), eq(m.status, "pending")));
}

/** Keeps these waiting without waking anyone, with the reason; they go with the recipient's next turn. Only what is still
 *  `pending` or `delivering`: one a turn already read, or that expired, stays as it is. */
export async function hold(ids: readonly string[], reason: HeldReason): Promise<void> {
  if (ids.length === 0) return;
  await db
    .update(m)
    .set({ status: "held", heldReason: reason })
    .where(and(inArray(m.id, [...ids]), inArray(m.status, ["pending", "delivering"])));
}

/** Takes, in one statement, every message of this recipient a turn has not read yet — written, woken or held, and not
 *  older than `HELD_DAYS` as of `at` — and marks it read by the turn's chat row: two turns at once can't both take one.
 *  Oldest first. */
async function claim(recipient: SQL, direction: MessageDirection, rowId: string, at: Date): Promise<AgentLenMessage[]> {
  const rows = await db
    .update(m)
    .set({ status: "delivered", deliveredAt: at, readByRow: rowId })
    .where(and(recipient, eq(m.direction, direction), inArray(m.status, ["pending", "delivering", "held"]), gte(m.createdAt, new Date(at.getTime() - HELD_DAYS * DAY))))
    .returning();
  // UPDATE … RETURNING has no order of its own.
  return rows.sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime() || x.id.localeCompare(y.id)).map(toMessage);
}

/** What a turn of this agent reads: everything for it, from any of its projects. */
export function claimForAgent(assistantId: string, rowId: string, at: Date): Promise<AgentLenMessage[]> {
  return claim(eq(m.assistantId, assistantId), "to_agent", rowId, at);
}

/** What a turn of Len reads in this project: everything for him there, from any agent. */
export function claimForLen(projectId: string, rowId: string, at: Date): Promise<AgentLenMessage[]> {
  return claim(eq(m.projectId, projectId), "to_len", rowId, at);
}

/** A turn claimed these and then didn't run (no credits): they go back to waiting for the next one. Only what was
 *  claimed — `delivered` — moves. */
export async function releaseToHeld(ids: readonly string[], reason: "no_credits"): Promise<void> {
  if (ids.length === 0) return;
  await db
    .update(m)
    .set({ status: "held", heldReason: reason, deliveredAt: null, readByRow: null })
    .where(and(inArray(m.id, [...ids]), eq(m.status, "delivered")));
}

/** What to do again when the server starts: the messages that woke a turn within `RESUME_HOURS` and no turn read. Held
 *  ones never wake anything by themselves (decision 9). As it goes, what can't be resumed or delivered any more
 *  expires: a message that woke a turn longer ago, and one held or pending for over `HELD_DAYS`. */
export async function toResume(now: Date): Promise<AgentLenMessage[]> {
  const resumable = new Date(now.getTime() - RESUME_HOURS * HOUR);
  const keptUntil = new Date(now.getTime() - HELD_DAYS * DAY);
  await db
    .update(m)
    .set({ status: "expired" })
    .where(
      or(
        and(eq(m.status, "delivering"), or(isNull(m.deliveringAt), lt(m.deliveringAt, resumable))),
        and(inArray(m.status, ["held", "pending"]), lt(m.createdAt, keptUntil)),
      ),
    );
  const rows = await db
    .select()
    .from(m)
    .where(and(eq(m.status, "delivering"), gte(m.deliveringAt, resumable)))
    .orderBy(asc(m.createdAt), asc(m.id));
  return rows.map(toMessage);
}
