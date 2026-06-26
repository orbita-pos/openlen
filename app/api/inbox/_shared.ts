// Shared plumbing for the owner Desk API (/api/inbox/*). All routes here are
// gated by Auth.js (session cookie), NOT the visitor ol_chat cookie.

import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import {
  getConversationForUser,
  getOrCreateOwnerChatUser,
} from "@/lib/chat/store";

export function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export interface OwnerContext {
  userId: string;
  projectId: string;
  ownerChatUserId: string;
}

/** Gate every inbox sub-route: Auth.js session → project ownership → privacy. */
export async function requireOwnerForConversation(
  conversationId: string,
): Promise<OwnerContext | { error: 401 | 404 }> {
  // 1. Auth.js session
  const session = await auth();
  if (!session?.user?.id) return { error: 401 };

  // 2. Load the conversation to learn its projectId
  const convRows = await db
    .select({
      projectId: schema.chatConversations.projectId,
    })
    .from(schema.chatConversations)
    .where(eq(schema.chatConversations.id, conversationId))
    .limit(1);
  const conv = convRows[0];
  if (!conv) return { error: 404 };
  const { projectId } = conv;

  // 3. Verify the session user OWNS this project
  const projRows = await db
    .select({ title: schema.projects.title })
    .from(schema.projects)
    .where(
      and(
        eq(schema.projects.id, projectId),
        eq(schema.projects.userId, session.user.id),
      ),
    )
    .limit(1);
  const project = projRows[0];
  if (!project) return { error: 404 };

  // 4. Provision the owner chat_user (idempotent)
  const { id: ownerChatUserId } = await getOrCreateOwnerChatUser(
    projectId,
    session.user.id,
    { displayName: project.title, email: session.user.email ?? null },
  );

  // 5. Privacy gate: the owner must be a PARTICIPANT of THIS conversation.
  //    getConversationForUser returns null when the user isn't aUserId/bUserId,
  //    which also stops the owner reading member↔member DMs in their own project.
  const participation = await getConversationForUser(
    projectId,
    conversationId,
    ownerChatUserId,
  );
  if (!participation) return { error: 404 };

  return { userId: session.user.id, projectId, ownerChatUserId };
}
