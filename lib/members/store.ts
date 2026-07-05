// Member storage — per-site visitor accounts + magic-link login tokens.
//
// Mirrors lib/projects/forms.ts (per-project rows, callers verify ownership)
// and the forgot/reset token flow (issue = 32 random bytes → sha256 at rest;
// consume = single-statement single-use check so concurrent clicks can't
// both win). Emails are normalized lowercase here, defensively, in addition
// to the zod transforms at the API edges.

import crypto from "node:crypto";
import { and, desc, eq, gt, lt, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import {
  SESSION_TTL_MS,
  generateSessionToken,
  hashSessionToken,
} from "@/lib/members/session";

export const LOGIN_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes

const MEMBER_LIST_LIMIT = 1000;
// A member accumulating logins keeps the newest N sessions; older devices
// just re-login. (Supabase's analog is the single-session-per-user option —
// we keep it loose, this only bounds row growth.)
const SESSIONS_PER_MEMBER_CAP = 10;
// lastSeenAt writes are throttled — a binge-reading member costs one UPDATE
// per interval, not one per fetch.
const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;
// Auth events older than this get swept opportunistically on logins.
const AUTH_EVENTS_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

export interface MemberItem {
  id: string;
  email: string;
  name: string | null;
  status: "active" | "invited";
  createdAt: Date;
  lastLoginAt: Date | null;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

/** A project's members, newest-first. The caller verifies ownership. */
export async function listMembers(projectId: string): Promise<MemberItem[]> {
  return db
    .select({
      id: schema.siteMembers.id,
      email: schema.siteMembers.email,
      name: schema.siteMembers.name,
      status: schema.siteMembers.status,
      createdAt: schema.siteMembers.createdAt,
      lastLoginAt: schema.siteMembers.lastLoginAt,
    })
    .from(schema.siteMembers)
    .where(eq(schema.siteMembers.projectId, projectId))
    .orderBy(desc(schema.siteMembers.createdAt))
    .limit(MEMBER_LIST_LIMIT);
}

export async function countMembers(projectId: string): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.siteMembers)
    .where(eq(schema.siteMembers.projectId, projectId));
  return rows[0]?.n ?? 0;
}

export async function getMemberByEmail(
  projectId: string,
  email: string,
): Promise<MemberItem | null> {
  const rows = await db
    .select({
      id: schema.siteMembers.id,
      email: schema.siteMembers.email,
      name: schema.siteMembers.name,
      status: schema.siteMembers.status,
      createdAt: schema.siteMembers.createdAt,
      lastLoginAt: schema.siteMembers.lastLoginAt,
    })
    .from(schema.siteMembers)
    .where(
      and(
        eq(schema.siteMembers.projectId, projectId),
        eq(schema.siteMembers.email, normalizeEmail(email)),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export interface MemberAuth {
  id: string;
  status: "active" | "invited";
  passwordHash: string | null;
}

/** Credential lookup for password login (no PII beyond what login needs). */
export async function getMemberAuthByEmail(
  projectId: string,
  email: string,
): Promise<MemberAuth | null> {
  const rows = await db
    .select({
      id: schema.siteMembers.id,
      status: schema.siteMembers.status,
      passwordHash: schema.siteMembers.passwordHash,
    })
    .from(schema.siteMembers)
    .where(
      and(
        eq(schema.siteMembers.projectId, projectId),
        eq(schema.siteMembers.email, normalizeEmail(email)),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Open-mode registration: create a fresh active member carrying a password. */
export async function createActiveMemberWithPassword(
  projectId: string,
  email: string,
  passwordHash: string,
): Promise<{ id: string }> {
  const rows = await db
    .insert(schema.siteMembers)
    .values({
      projectId,
      email: normalizeEmail(email),
      status: "active",
      passwordHash,
      lastLoginAt: new Date(),
    })
    .returning({ id: schema.siteMembers.id });
  return rows[0];
}

/** Set a password on an existing (invited or magic-link-only) row + activate. */
export async function setMemberPasswordActive(
  memberId: string,
  passwordHash: string,
): Promise<void> {
  await db
    .update(schema.siteMembers)
    .set({ status: "active", passwordHash, lastLoginAt: new Date() })
    .where(eq(schema.siteMembers.id, memberId));
}

export async function getMemberById(id: string): Promise<MemberItem | null> {
  const rows = await db
    .select({
      id: schema.siteMembers.id,
      email: schema.siteMembers.email,
      name: schema.siteMembers.name,
      status: schema.siteMembers.status,
      createdAt: schema.siteMembers.createdAt,
      lastLoginAt: schema.siteMembers.lastLoginAt,
    })
    .from(schema.siteMembers)
    .where(eq(schema.siteMembers.id, id))
    .limit(1);
  return rows[0] ?? null;
}

/** Open-signup login: create the member or reactivate the existing row,
 *  stamping lastLoginAt either way. */
export async function upsertActiveMember(
  projectId: string,
  email: string,
): Promise<MemberItem> {
  const now = new Date();
  const rows = await db
    .insert(schema.siteMembers)
    .values({
      projectId,
      email: normalizeEmail(email),
      status: "active",
      lastLoginAt: now,
    })
    .onConflictDoUpdate({
      target: [schema.siteMembers.projectId, schema.siteMembers.email],
      set: { status: "active", lastLoginAt: now },
    })
    .returning({
      id: schema.siteMembers.id,
      email: schema.siteMembers.email,
      name: schema.siteMembers.name,
      status: schema.siteMembers.status,
      createdAt: schema.siteMembers.createdAt,
      lastLoginAt: schema.siteMembers.lastLoginAt,
    });
  return rows[0];
}

/** Invite-mode login: only flips an existing row to active. */
export async function activateMember(memberId: string): Promise<void> {
  await db
    .update(schema.siteMembers)
    .set({ status: "active", lastLoginAt: new Date() })
    .where(eq(schema.siteMembers.id, memberId));
}

/** Owner pre-approves an email. Returns created=false when already present. */
export async function inviteMember(
  projectId: string,
  email: string,
  name?: string | null,
): Promise<{ created: boolean; member: MemberItem | null }> {
  const rows = await db
    .insert(schema.siteMembers)
    .values({
      projectId,
      email: normalizeEmail(email),
      name: name ?? null,
      status: "invited",
    })
    .onConflictDoNothing()
    .returning({
      id: schema.siteMembers.id,
      email: schema.siteMembers.email,
      name: schema.siteMembers.name,
      status: schema.siteMembers.status,
      createdAt: schema.siteMembers.createdAt,
      lastLoginAt: schema.siteMembers.lastLoginAt,
    });
  if (rows.length > 0) return { created: true, member: rows[0] };
  return { created: false, member: null };
}

/** Revocation: delete the row — every protected fetch re-checks existence,
 *  so access dies on the member's next request. */
export async function deleteMember(
  projectId: string,
  memberId: string,
): Promise<boolean> {
  const rows = await db
    .delete(schema.siteMembers)
    .where(
      and(
        eq(schema.siteMembers.id, memberId),
        eq(schema.siteMembers.projectId, projectId),
      ),
    )
    .returning({ id: schema.siteMembers.id });
  return rows.length > 0;
}

/** Issue a magic-link token. The RAW token goes in the email; only its hash
 *  is stored. `slug` is the gated page the visitor was trying to reach. */
export async function issueLoginToken(params: {
  projectId: string;
  email: string;
  slug?: string | null;
}): Promise<string> {
  const rawToken = crypto.randomBytes(32).toString("base64url");
  await db.insert(schema.memberLoginTokens).values({
    tokenHash: sha256Hex(rawToken),
    projectId: params.projectId,
    email: normalizeEmail(params.email),
    slug: params.slug ?? null,
    expires: new Date(Date.now() + LOGIN_TOKEN_TTL_MS),
    used: false,
  });
  return rawToken;
}

/** Single-use consume — the UPDATE's WHERE carries the unused+unexpired
 *  checks so two concurrent submits can't both pass. Null = invalid, used,
 *  expired, or issued for a different project. */
export async function consumeLoginToken(
  rawToken: string,
  projectId: string,
): Promise<{ email: string; slug: string | null } | null> {
  const rows = await db
    .update(schema.memberLoginTokens)
    .set({ used: true })
    .where(
      and(
        eq(schema.memberLoginTokens.tokenHash, sha256Hex(rawToken)),
        eq(schema.memberLoginTokens.projectId, projectId),
        eq(schema.memberLoginTokens.used, false),
        gt(schema.memberLoginTokens.expires, new Date()),
      ),
    )
    .returning({
      email: schema.memberLoginTokens.email,
      slug: schema.memberLoginTokens.slug,
    });
  if (rows.length === 0) return null;

  // Opportunistic cleanup — expired tokens for this project, best-effort.
  void db
    .delete(schema.memberLoginTokens)
    .where(
      and(
        eq(schema.memberLoginTokens.projectId, projectId),
        lt(schema.memberLoginTokens.expires, new Date()),
      ),
    )
    .catch(() => {});

  return rows[0];
}

// ─── Sessions — opaque, server-side, revocable ──────────────────────────────

export interface MemberSessionRow {
  tokenHash: string;
  projectId: string;
  memberId: string;
  lastSeenAt: Date;
  expiresAt: Date;
}

/** Mint a session for a logged-in member. Returns the RAW token (cookie
 *  value); only its hash is stored. Prunes the member's oldest sessions
 *  beyond the cap, best-effort. */
export async function createMemberSession(
  projectId: string,
  memberId: string,
): Promise<string> {
  const { raw, hash } = generateSessionToken();
  await db.insert(schema.memberSessions).values({
    tokenHash: hash,
    projectId,
    memberId,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  void db
    .execute(
      sql`DELETE FROM "memberSessions" WHERE "tokenHash" IN (
        SELECT "tokenHash" FROM "memberSessions"
        WHERE "memberId" = ${memberId}
        ORDER BY "createdAt" DESC
        OFFSET ${SESSIONS_PER_MEMBER_CAP}
      )`,
    )
    .catch(() => {});
  return raw;
}

/** Resolve a cookie value to its live session. Null = unknown, revoked, or
 *  expired — verification IS this lookup; there is no signature to check. */
export async function getMemberSession(
  rawToken: string,
): Promise<MemberSessionRow | null> {
  const rows = await db
    .select({
      tokenHash: schema.memberSessions.tokenHash,
      projectId: schema.memberSessions.projectId,
      memberId: schema.memberSessions.memberId,
      lastSeenAt: schema.memberSessions.lastSeenAt,
      expiresAt: schema.memberSessions.expiresAt,
    })
    .from(schema.memberSessions)
    .where(
      and(
        eq(schema.memberSessions.tokenHash, hashSessionToken(rawToken)),
        gt(schema.memberSessions.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Throttled lastSeenAt bump — fire-and-forget, never blocks the fetch. */
export function maybeTouchMemberSession(session: MemberSessionRow): void {
  if (Date.now() - session.lastSeenAt.getTime() < SESSION_TOUCH_INTERVAL_MS) {
    return;
  }
  void db
    .update(schema.memberSessions)
    .set({ lastSeenAt: new Date() })
    .where(eq(schema.memberSessions.tokenHash, session.tokenHash))
    .catch(() => {});
}

/** Logout: kill exactly the presented session. */
export async function deleteMemberSessionByHash(
  tokenHash: string,
): Promise<void> {
  await db
    .delete(schema.memberSessions)
    .where(eq(schema.memberSessions.tokenHash, tokenHash));
}

/** "Cerrar todas las sesiones" — every device of one member, immediately.
 *  (Member deletion doesn't need this: the FK cascade covers it.) */
export async function deleteMemberSessions(
  projectId: string,
  memberId: string,
): Promise<number> {
  const rows = await db
    .delete(schema.memberSessions)
    .where(
      and(
        eq(schema.memberSessions.projectId, projectId),
        eq(schema.memberSessions.memberId, memberId),
      ),
    )
    .returning({ tokenHash: schema.memberSessions.tokenHash });
  return rows.length;
}

// ─── Auth audit trail ────────────────────────────────────────────────────────

export type MemberAuthEventType =
  | "link_requested"
  | "login"
  | "logout"
  | "invited"
  | "removed"
  | "password_login"
  | "password_set";

/** Fire-and-forget — the audit trail must never block or fail an auth path.
 *  Logins also sweep events past retention for the project, best-effort. */
export function recordMemberAuthEvent(params: {
  projectId: string;
  type: MemberAuthEventType;
  memberId?: string | null;
  email?: string | null;
}): void {
  void db
    .insert(schema.memberAuthEvents)
    .values({
      projectId: params.projectId,
      memberId: params.memberId ?? null,
      email: params.email ? normalizeEmail(params.email) : null,
      type: params.type,
    })
    .catch(() => {});
  if (params.type === "login") {
    void db
      .delete(schema.memberAuthEvents)
      .where(
        and(
          eq(schema.memberAuthEvents.projectId, params.projectId),
          lt(
            schema.memberAuthEvents.createdAt,
            new Date(Date.now() - AUTH_EVENTS_RETENTION_MS),
          ),
        ),
      )
      .catch(() => {});
  }
}
