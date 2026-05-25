// Per-project Chat-tab transcript — append-only log access.
//
// The transcript is an append-only message log (table projectChatMessages):
// a new turn is an INSERT, so concurrent browser tabs editing the same
// project interleave instead of overwriting a shared blob. Callers verify
// project ownership before invoking append/update — see the chat route.

import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { StoredChatTurn } from "@/lib/projects/types";

const CHAT_LIMIT = 50;

/** Load a project's transcript, oldest-first. Ownership is the caller's
 *  responsibility — `getProject` already scoped the project to the user. */
export async function getChatMessages(
  projectId: string,
): Promise<StoredChatTurn[]> {
  const rows = await db
    .select()
    .from(schema.projectChatMessages)
    .where(eq(schema.projectChatMessages.projectId, projectId))
    .orderBy(asc(schema.projectChatMessages.createdAt))
    .limit(CHAT_LIMIT);
  return rows.map(rowToTurn);
}

/** Append one settled turn. The turn id is the PK, so a retried append is an
 *  idempotent no-op. Trims the project's log to the most-recent CHAT_LIMIT. */
export async function appendChatMessage(
  projectId: string,
  turn: StoredChatTurn,
): Promise<void> {
  await db
    .insert(schema.projectChatMessages)
    .values({
      id: turn.id,
      projectId,
      userText: turn.userText.slice(0, 4000),
      attachedImage: turn.attachedImage ?? null,
      assistantReasoning: turn.assistantReasoning.slice(0, 20_000),
      status: turn.status === "reverted" ? "reverted" : "applied",
    })
    .onConflictDoNothing();
  await trim(projectId);
}

/** Flip a turn's status — the Undo path (applied → reverted). Scoped by
 *  projectId so a turn id from another project can't be touched. */
export async function updateChatMessageStatus(
  projectId: string,
  turnId: string,
  status: "applied" | "reverted",
): Promise<void> {
  await db
    .update(schema.projectChatMessages)
    .set({ status })
    .where(
      and(
        eq(schema.projectChatMessages.id, turnId),
        eq(schema.projectChatMessages.projectId, projectId),
      ),
    );
}

/** Evict the oldest rows beyond the cap — mirrors projectVersions' trim. */
async function trim(projectId: string): Promise<void> {
  const rows = await db
    .select({ id: schema.projectChatMessages.id })
    .from(schema.projectChatMessages)
    .where(eq(schema.projectChatMessages.projectId, projectId))
    .orderBy(desc(schema.projectChatMessages.createdAt));
  if (rows.length <= CHAT_LIMIT) return;
  const excess = rows.slice(CHAT_LIMIT).map((r) => r.id);
  await db
    .delete(schema.projectChatMessages)
    .where(inArray(schema.projectChatMessages.id, excess));
}

function rowToTurn(
  row: typeof schema.projectChatMessages.$inferSelect,
): StoredChatTurn {
  const turn: StoredChatTurn = {
    id: row.id,
    userText: row.userText,
    assistantReasoning: row.assistantReasoning,
    status: row.status === "reverted" ? "reverted" : "applied",
    // The row's createdAt doubles as the turn's applied-at timestamp.
    appliedAt: row.createdAt.getTime(),
  };
  if (row.attachedImage) turn.attachedImage = row.attachedImage;
  return turn;
}
