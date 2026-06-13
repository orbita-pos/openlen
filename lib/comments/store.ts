// Comment storage — members-only comments, page-scoped, with moderation.
//
// Mirrors lib/members/store.ts conventions (per-project rows, callers verify
// ownership). Bodies are PLAIN TEXT and are never rendered as HTML — the
// widget + the moderation panel both escape on render. authorEmail is a
// snapshot for the OWNER's eyes only; the public read never returns it.

import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export type CommentStatus = "visible" | "hidden";

export interface PublicComment {
  id: string;
  authorName: string | null;
  body: string;
  parentId: string | null;
  createdAt: Date;
}

export interface OwnerComment extends PublicComment {
  page: string | null;
  memberId: string | null;
  authorEmail: string | null;
  status: CommentStatus;
}

const LIST_LIMIT = 200;

/** Public read for the widget — only VISIBLE comments on one page, oldest-
 *  first (natural reading order), never the email. */
export async function listVisibleComments(
  projectId: string,
  page: string | null,
): Promise<PublicComment[]> {
  const rows = await db
    .select({
      id: schema.siteComments.id,
      authorName: schema.siteComments.authorName,
      body: schema.siteComments.body,
      parentId: schema.siteComments.parentId,
      createdAt: schema.siteComments.createdAt,
    })
    .from(schema.siteComments)
    .where(
      and(
        eq(schema.siteComments.projectId, projectId),
        page === null
          ? sql`${schema.siteComments.page} is null`
          : eq(schema.siteComments.page, page),
        eq(schema.siteComments.status, "visible"),
      ),
    )
    .orderBy(schema.siteComments.createdAt)
    .limit(LIST_LIMIT);
  return rows;
}

/** Owner moderation read — everything, newest-first, optionally filtered. */
export async function listAllComments(
  projectId: string,
  opts?: { status?: CommentStatus; page?: string | null },
): Promise<OwnerComment[]> {
  const filters = [eq(schema.siteComments.projectId, projectId)];
  if (opts?.status) filters.push(eq(schema.siteComments.status, opts.status));
  if (opts?.page !== undefined) {
    filters.push(
      opts.page === null
        ? sql`${schema.siteComments.page} is null`
        : eq(schema.siteComments.page, opts.page),
    );
  }
  return db
    .select({
      id: schema.siteComments.id,
      page: schema.siteComments.page,
      memberId: schema.siteComments.memberId,
      authorName: schema.siteComments.authorName,
      authorEmail: schema.siteComments.authorEmail,
      body: schema.siteComments.body,
      parentId: schema.siteComments.parentId,
      status: schema.siteComments.status,
      createdAt: schema.siteComments.createdAt,
    })
    .from(schema.siteComments)
    .where(and(...filters))
    .orderBy(desc(schema.siteComments.createdAt))
    .limit(LIST_LIMIT);
}

export async function countPending(projectId: string): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.siteComments)
    .where(
      and(
        eq(schema.siteComments.projectId, projectId),
        eq(schema.siteComments.status, "hidden"),
      ),
    );
  return rows[0]?.n ?? 0;
}

export async function insertComment(input: {
  projectId: string;
  page: string | null;
  memberId: string;
  authorName: string | null;
  authorEmail: string;
  body: string;
  status: CommentStatus;
}): Promise<{ id: string; status: CommentStatus; createdAt: Date }> {
  const rows = await db
    .insert(schema.siteComments)
    .values({
      projectId: input.projectId,
      page: input.page,
      memberId: input.memberId,
      authorName: input.authorName,
      authorEmail: input.authorEmail.trim().toLowerCase(),
      body: input.body,
      status: input.status,
    })
    .returning({
      id: schema.siteComments.id,
      status: schema.siteComments.status,
      createdAt: schema.siteComments.createdAt,
    });
  return rows[0];
}

/** Owner hides/unhides. Returns the affected comment's memberId (for the ban
 *  affordance) or null when not found / not owned. */
export async function setCommentStatus(
  projectId: string,
  commentId: string,
  status: CommentStatus,
): Promise<boolean> {
  const rows = await db
    .update(schema.siteComments)
    .set({ status })
    .where(
      and(
        eq(schema.siteComments.id, commentId),
        eq(schema.siteComments.projectId, projectId),
      ),
    )
    .returning({ id: schema.siteComments.id });
  return rows.length > 0;
}

export async function deleteComment(
  projectId: string,
  commentId: string,
): Promise<boolean> {
  const rows = await db
    .delete(schema.siteComments)
    .where(
      and(
        eq(schema.siteComments.id, commentId),
        eq(schema.siteComments.projectId, projectId),
      ),
    )
    .returning({ id: schema.siteComments.id });
  return rows.length > 0;
}

/** The member who authored a comment — for the "ban member" action. */
export async function getCommentAuthor(
  projectId: string,
  commentId: string,
): Promise<{ memberId: string | null } | null> {
  const rows = await db
    .select({ memberId: schema.siteComments.memberId })
    .from(schema.siteComments)
    .where(
      and(
        eq(schema.siteComments.id, commentId),
        eq(schema.siteComments.projectId, projectId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}
