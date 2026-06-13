// Shared plumbing for the visitor-facing comments API (/api/cm/[sub]/…).
// Same-host (so the host-only ol_member cookie is first-party), every response
// no-store. Mirrors app/api/m/[sub]/_shared.ts.

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export const PAGE_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export interface CommentsSite {
  projectId: string;
  membersEnabled: boolean;
  commentsEnabled: boolean;
  moderation: "all" | "moderated";
}

/** Resolve a published sub → its project + the members/comments switches in
 *  one query. Null = unknown subdomain. */
export async function loadCommentsSite(
  sub: string,
): Promise<CommentsSite | null> {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(sub)) return null;
  const rows = await db
    .select({ projectId: schema.projects.id, data: schema.projects.data })
    .from(schema.projects)
    .where(eq(schema.projects.subdomain, sub))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const members = row.data?.settings?.members;
  const comments = row.data?.settings?.comments;
  return {
    projectId: row.projectId,
    membersEnabled: members?.enabled === true,
    commentsEnabled: comments?.enabled === true,
    moderation: comments?.moderation === "all" ? "all" : "moderated",
  };
}
