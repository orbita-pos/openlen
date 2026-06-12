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

export const LOGIN_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes

const MEMBER_LIST_LIMIT = 1000;

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
