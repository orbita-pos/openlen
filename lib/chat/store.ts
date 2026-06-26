// Private-chat storage — per-project chat users, opaque sessions, conversations,
// messages. Mirrors lib/members/store.ts (sha256 tokens at rest, single-pair
// conversations, snapshot author ids). Every query is scoped by projectId.

import { and, asc, desc, eq, gt, ilike, ne, or, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { decodeCursor } from "@/lib/chat/cursor";
import {
  SESSION_TTL_MS,
  generateSessionToken,
  hashSessionToken,
} from "@/lib/chat/session";

const SEARCH_LIMIT = 12;
const CONVO_LIMIT = 200;
const MESSAGE_PAGE = 50;
const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export interface ChatUserRow {
  id: string;
  projectId: string;
  username: string;
  passwordHash: string;
  displayName: string | null;
  role: "member" | "agent" | "owner";
  status: "active" | "blocked";
}
export interface PublicChatUser { id: string; username: string; displayName: string | null; }
export interface MessageRow {
  id: string; conversationId: string; authorId: string; body: string; createdAt: Date;
}
export interface ConversationSummary {
  id: string; otherUserId: string; otherUsername: string;
  otherDisplayName: string | null; lastMessageAt: Date | null;
}

const USER_COLS = {
  id: schema.chatUsers.id,
  projectId: schema.chatUsers.projectId,
  username: schema.chatUsers.username,
  passwordHash: schema.chatUsers.passwordHash,
  displayName: schema.chatUsers.displayName,
  role: schema.chatUsers.role,
  status: schema.chatUsers.status,
};

export async function registerChatUser(
  projectId: string,
  username: string,
  passwordHash: string,
  opts: { email?: string | null; displayName?: string | null; role?: "member" | "agent" | "owner" } = {},
): Promise<{ id: string } | { error: "taken" }> {
  const rows = await db
    .insert(schema.chatUsers)
    .values({
      projectId,
      username,
      passwordHash,
      email: opts.email ?? null,
      displayName: opts.displayName ?? null,
      role: opts.role ?? "member",
    })
    .onConflictDoNothing({ target: [schema.chatUsers.projectId, schema.chatUsers.username] })
    .returning({ id: schema.chatUsers.id });
  if (rows.length === 0) return { error: "taken" };
  return { id: rows[0].id };
}

export async function getChatUserByUsername(projectId: string, username: string): Promise<ChatUserRow | null> {
  const rows = await db
    .select(USER_COLS)
    .from(schema.chatUsers)
    .where(and(eq(schema.chatUsers.projectId, projectId), eq(schema.chatUsers.username, username)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getChatUserById(id: string): Promise<ChatUserRow | null> {
  const rows = await db.select(USER_COLS).from(schema.chatUsers).where(eq(schema.chatUsers.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function createChatSession(projectId: string, chatUserId: string): Promise<string> {
  const { raw, hash } = generateSessionToken();
  await db.insert(schema.chatSessions).values({
    tokenHash: hash,
    projectId,
    chatUserId,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  return raw;
}

export async function getChatSession(rawToken: string): Promise<{ projectId: string; chatUserId: string } | null> {
  const rows = await db
    .select({ projectId: schema.chatSessions.projectId, chatUserId: schema.chatSessions.chatUserId })
    .from(schema.chatSessions)
    .where(and(eq(schema.chatSessions.tokenHash, hashSessionToken(rawToken)), gt(schema.chatSessions.expiresAt, new Date())))
    .limit(1);
  return rows[0] ?? null;
}

export function touchChatSession(rawToken: string): void {
  void db
    .update(schema.chatSessions)
    .set({ lastSeenAt: new Date() })
    .where(and(
      eq(schema.chatSessions.tokenHash, hashSessionToken(rawToken)),
      sql`${schema.chatSessions.lastSeenAt} < ${new Date(Date.now() - SESSION_TOUCH_INTERVAL_MS)}`,
    ))
    .catch(() => {});
}

export async function deleteChatSessionByRaw(rawToken: string): Promise<void> {
  await db.delete(schema.chatSessions).where(eq(schema.chatSessions.tokenHash, hashSessionToken(rawToken)));
}

export async function searchChatUsers(projectId: string, q: string, selfId: string): Promise<PublicChatUser[]> {
  const term = q.trim().replace(/^@+/, "").toLowerCase();
  if (term.length === 0) return [];
  const rows = await db
    .select({ id: schema.chatUsers.id, username: schema.chatUsers.username, displayName: schema.chatUsers.displayName })
    .from(schema.chatUsers)
    .where(and(
      eq(schema.chatUsers.projectId, projectId),
      eq(schema.chatUsers.status, "active"),
      ne(schema.chatUsers.id, selfId),
      ilike(schema.chatUsers.username, `${term}%`),
    ))
    .orderBy(asc(schema.chatUsers.username))
    .limit(SEARCH_LIMIT);
  return rows;
}

export async function getOrCreateConversation(projectId: string, u1: string, u2: string): Promise<{ id: string }> {
  const [aUserId, bUserId] = u1 <= u2 ? [u1, u2] : [u2, u1];
  await db
    .insert(schema.chatConversations)
    .values({ projectId, aUserId, bUserId })
    .onConflictDoNothing({ target: [schema.chatConversations.projectId, schema.chatConversations.aUserId, schema.chatConversations.bUserId] });
  const rows = await db
    .select({ id: schema.chatConversations.id })
    .from(schema.chatConversations)
    .where(and(
      eq(schema.chatConversations.projectId, projectId),
      eq(schema.chatConversations.aUserId, aUserId),
      eq(schema.chatConversations.bUserId, bUserId),
    ))
    .limit(1);
  return rows[0];
}

export async function getConversationForUser(
  projectId: string, conversationId: string, userId: string,
): Promise<{ id: string; otherUserId: string } | null> {
  const rows = await db
    .select({ id: schema.chatConversations.id, a: schema.chatConversations.aUserId, b: schema.chatConversations.bUserId })
    .from(schema.chatConversations)
    .where(and(eq(schema.chatConversations.id, conversationId), eq(schema.chatConversations.projectId, projectId)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (row.a !== userId && row.b !== userId) return null; // not a participant
  return { id: row.id, otherUserId: row.a === userId ? row.b : row.a };
}

export async function listConversations(projectId: string, userId: string): Promise<ConversationSummary[]> {
  const rows = await db
    .select({
      id: schema.chatConversations.id,
      a: schema.chatConversations.aUserId,
      b: schema.chatConversations.bUserId,
      lastMessageAt: schema.chatConversations.lastMessageAt,
    })
    .from(schema.chatConversations)
    .where(and(
      eq(schema.chatConversations.projectId, projectId),
      or(eq(schema.chatConversations.aUserId, userId), eq(schema.chatConversations.bUserId, userId)),
    ))
    .orderBy(desc(schema.chatConversations.lastMessageAt))
    .limit(CONVO_LIMIT);

  const others = rows.map((r) => (r.a === userId ? r.b : r.a));
  const usersById = new Map<string, { username: string; displayName: string | null }>();
  for (const oid of others) {
    const u = await getChatUserById(oid);
    if (u) usersById.set(oid, { username: u.username, displayName: u.displayName });
  }
  return rows.map((r) => {
    const otherUserId = r.a === userId ? r.b : r.a;
    const u = usersById.get(otherUserId);
    return {
      id: r.id, otherUserId,
      otherUsername: u?.username ?? "?",
      otherDisplayName: u?.displayName ?? null,
      lastMessageAt: r.lastMessageAt,
    };
  });
}

export async function insertMessage(conversationId: string, authorId: string, body: string): Promise<MessageRow> {
  // Use client-side ms-precision timestamp so cursor comparisons (which also
  // use ms) are exact. DB defaultNow() has us precision, creating a mismatch.
  const createdAt = new Date();
  const rows = await db
    .insert(schema.chatMessages)
    .values({ conversationId, authorId, body, createdAt })
    .returning({
      id: schema.chatMessages.id,
      conversationId: schema.chatMessages.conversationId,
      authorId: schema.chatMessages.authorId,
      body: schema.chatMessages.body,
      createdAt: schema.chatMessages.createdAt,
    });
  await db
    .update(schema.chatConversations)
    .set({ lastMessageAt: rows[0].createdAt })
    .where(eq(schema.chatConversations.id, conversationId));
  return rows[0];
}

export async function listMessagesSince(
  conversationId: string, cursor: string | null, limit = MESSAGE_PAGE,
): Promise<MessageRow[]> {
  const cols = {
    id: schema.chatMessages.id,
    conversationId: schema.chatMessages.conversationId,
    authorId: schema.chatMessages.authorId,
    body: schema.chatMessages.body,
    createdAt: schema.chatMessages.createdAt,
  };
  const decoded = cursor ? decodeCursor(cursor) : null;
  const base = eq(schema.chatMessages.conversationId, conversationId);
  // Explicit OR is more reliable than the Postgres row-value `(a,b)>(c,d)`
  // form because Drizzle's sql`` interpolation of column refs inside a raw
  // template can produce mismatched aliases in some driver versions.
  const where = decoded
    ? and(
        base,
        or(
          gt(schema.chatMessages.createdAt, new Date(decoded.ms)),
          and(
            eq(schema.chatMessages.createdAt, new Date(decoded.ms)),
            gt(schema.chatMessages.id, decoded.id),
          ),
        ),
      )
    : base;
  return db
    .select(cols)
    .from(schema.chatMessages)
    .where(where)
    .orderBy(asc(schema.chatMessages.createdAt), asc(schema.chatMessages.id))
    .limit(limit);
}

export function recordChatEvent(projectId: string, type: string, chatUserId?: string | null): void {
  void db.insert(schema.chatEvents).values({ projectId, type, chatUserId: chatUserId ?? null }).catch(() => {});
}
