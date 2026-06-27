// Private-chat storage — per-project chat users, opaque sessions, conversations,
// messages. Mirrors lib/members/store.ts (sha256 tokens at rest, single-pair
// conversations, snapshot author ids). Every query is scoped by projectId.

import crypto from "node:crypto";
import { and, asc, desc, eq, gt, ilike, ne, or, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { decodeCursor } from "@/lib/chat/cursor";
import {
  SESSION_TTL_MS,
  generateSessionToken,
  hashSessionToken,
} from "@/lib/chat/session";
import { deriveOwnerUsername, hashPassword } from "@/lib/chat/identity";

const SEARCH_LIMIT = 12;
const CONVO_LIMIT = 200;
const MESSAGE_PAGE = 50;
const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export interface ChatUserRow {
  id: string;
  projectId: string;
  username: string;
  passwordHash: string | null;
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
  assignedUserId: string | null; assigneeName: string | null; assignedAt: Date | null;
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
      assignedUserId: schema.chatConversations.assignedUserId,
      assignedAt: schema.chatConversations.assignedAt,
      assigneeName: schema.users.name,
    })
    .from(schema.chatConversations)
    .leftJoin(schema.users, eq(schema.chatConversations.assignedUserId, schema.users.id))
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
      assignedUserId: r.assignedUserId ?? null,
      assigneeName: r.assigneeName ?? null,
      assignedAt: r.assignedAt ?? null,
    };
  });
}

/** Assign (or release) a conversation to a platform user. Scoped by
 *  (projectId, conversationId) so a bad actor can't reassign across projects.
 *  Pass userId=null to release. Returns the new state or {error:"not_found"}. */
export async function assignConversation(
  projectId: string,
  conversationId: string,
  userId: string | null,
): Promise<{ assignedUserId: string | null; assignedAt: Date | null } | { error: "not_found" }> {
  const now = userId ? new Date() : null;
  const rows = await db
    .update(schema.chatConversations)
    .set({ assignedUserId: userId, assignedAt: now })
    .where(and(
      eq(schema.chatConversations.id, conversationId),
      eq(schema.chatConversations.projectId, projectId),
    ))
    .returning({
      assignedUserId: schema.chatConversations.assignedUserId,
      assignedAt: schema.chatConversations.assignedAt,
    });
  if (rows.length === 0) return { error: "not_found" };
  return { assignedUserId: rows[0].assignedUserId ?? null, assignedAt: rows[0].assignedAt ?? null };
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
  // Keyset paging on (createdAt, id): strictly-after the cursor. Correctness relies on createdAt being millisecond-precision (see insertMessage + the timestamp(3) column) so getTime() round-trips exactly against the boundary.
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

/** Mark a conversation read for `userId` (sets aReadAt or bReadAt, no-op if
 *  not a participant). One UPDATE scoped to projectId+conversationId. */
export async function markConversationRead(
  projectId: string,
  conversationId: string,
  userId: string,
  readAt: Date,
): Promise<void> {
  const rows = await db
    .select({
      id: schema.chatConversations.id,
      a: schema.chatConversations.aUserId,
      b: schema.chatConversations.bUserId,
    })
    .from(schema.chatConversations)
    .where(and(
      eq(schema.chatConversations.id, conversationId),
      eq(schema.chatConversations.projectId, projectId),
    ))
    .limit(1);
  const row = rows[0];
  if (!row) return;
  if (userId === row.a) {
    await db.update(schema.chatConversations).set({ aReadAt: readAt }).where(eq(schema.chatConversations.id, conversationId));
  } else if (userId === row.b) {
    await db.update(schema.chatConversations).set({ bReadAt: readAt }).where(eq(schema.chatConversations.id, conversationId));
  }
  // no-op if userId is not a participant
}

/** Return the OTHER participant's last-read timestamp (null if never read or
 *  userId is not a participant). */
export async function getOtherReadAt(
  projectId: string,
  conversationId: string,
  selfUserId: string,
): Promise<Date | null> {
  const rows = await db
    .select({
      a: schema.chatConversations.aUserId,
      b: schema.chatConversations.bUserId,
      aReadAt: schema.chatConversations.aReadAt,
      bReadAt: schema.chatConversations.bReadAt,
    })
    .from(schema.chatConversations)
    .where(and(
      eq(schema.chatConversations.id, conversationId),
      eq(schema.chatConversations.projectId, projectId),
    ))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (selfUserId === row.a) return row.bReadAt ?? null;
  if (selfUserId === row.b) return row.aReadAt ?? null;
  return null;
}

/** The space's owner chat_user, or null. */
export async function getChatOwner(projectId: string): Promise<ChatUserRow | null> {
  const rows = await db
    .select(USER_COLS)
    .from(schema.chatUsers)
    .where(and(eq(schema.chatUsers.projectId, projectId), eq(schema.chatUsers.role, "owner")))
    .limit(1);
  return rows[0] ?? null;
}

/** Idempotently ensure the project's owner chat_user exists. The owner never
 *  logs in with a password (Auth.js only) — passwordHash is an unusable random
 *  sentinel. Username derived from the display name; 'owner' fallback; uniqueness
 *  resolved by suffixing on collision. */
export async function getOrCreateOwnerChatUser(
  projectId: string,
  _ownerUserId: string,
  opts: { email?: string | null; displayName?: string | null } = {},
): Promise<{ id: string }> {
  const existing = await getChatOwner(projectId);
  if (existing) return { id: existing.id };
  const base = deriveOwnerUsername(opts.displayName ?? "");
  const passwordHash = await hashPassword(crypto.randomUUID());
  for (let i = 0; i < 5; i++) {
    const username = i === 0 ? base : `${base.slice(0, 17)}_${i}`;
    const r = await registerChatUser(projectId, username, passwordHash, {
      role: "owner",
      email: opts.email ?? null,
      displayName: opts.displayName ?? null,
    });
    if ("id" in r) return { id: r.id };
    // 'taken' on this username — another owner may have just been created; re-check
    const now = await getChatOwner(projectId);
    if (now) return { id: now.id };
  }
  // extremely unlikely — last resort with a random handle
  const r = await registerChatUser(projectId, `owner_${crypto.randomUUID().slice(0, 8)}`, passwordHash, { role: "owner", email: opts.email ?? null, displayName: opts.displayName ?? null });
  if ("id" in r) return { id: r.id };
  const fallback = await getChatOwner(projectId);
  if (fallback) return { id: fallback.id };
  throw new Error("could not provision owner chat user");
}

/** Inbox across ALL of one platform-user's chat-enabled projects: every
 *  conversation the owner participates in, tagged with its project. */
export async function listOwnerInbox(ownerUserId: string): Promise<Array<{ projectId: string; projectTitle: string; conversations: ConversationSummary[] }>> {
  const projects = await db
    .select({ id: schema.projects.id, title: schema.projects.title, data: schema.projects.data })
    .from(schema.projects)
    .where(eq(schema.projects.userId, ownerUserId));
  const out: Array<{ projectId: string; projectTitle: string; conversations: ConversationSummary[] }> = [];
  for (const p of projects) {
    if (p.data?.settings?.chat?.enabled !== true) continue;
    const owner = await getChatOwner(p.id);
    if (!owner) continue;
    const conversations = await listConversations(p.id, owner.id);
    if (conversations.length > 0) out.push({ projectId: p.id, projectTitle: p.title ?? p.id, conversations });
  }
  return out;
}

/** Full inbox for a platform user: their OWNED projects + projects where they are
 *  an active agent. Agents see conversations via the project's owner chat_user.
 *  Results are deduped by projectId (in the unlikely case owner + agent rows coexist). */
export async function listInbox(
  userId: string,
): Promise<Array<{ projectId: string; projectTitle: string; conversations: ConversationSummary[] }>> {
  // Import here to avoid a circular dep at module load time (agents imports schema, not store)
  const { listAgentProjectIds } = await import("@/lib/chat/agents");

  const owned = await listOwnerInbox(userId);
  const ownedIds = new Set(owned.map((e) => e.projectId));

  const agentProjectIds = await listAgentProjectIds(userId);
  const agentEntries: Array<{ projectId: string; projectTitle: string; conversations: ConversationSummary[] }> = [];

  for (const pid of agentProjectIds) {
    if (ownedIds.has(pid)) continue; // already in owned list
    const projRows = await db
      .select({ title: schema.projects.title, data: schema.projects.data })
      .from(schema.projects)
      .where(eq(schema.projects.id, pid))
      .limit(1);
    const proj = projRows[0];
    if (!proj) continue;
    if (proj.data?.settings?.chat?.enabled !== true) continue;
    const owner = await getChatOwner(pid);
    if (!owner) continue;
    const conversations = await listConversations(pid, owner.id);
    if (conversations.length > 0) {
      agentEntries.push({ projectId: pid, projectTitle: proj.title ?? pid, conversations });
    }
  }

  return [...owned, ...agentEntries];
}
