// Form-submission storage — lead capture from published pages.
//
// A visitor submits any <form> on a published OpenLen page → the public
// /api/f/<sub> endpoint → recordSubmission here. The Leads sidebar tab reads
// them back via listSubmissions. Ownership is verified by the callers.

import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

const SUBMISSIONS_LIMIT = 200;

export interface SubmissionItem {
  id: string;
  data: Record<string, string>;
  /** Site page the form lives on (null = home / pre-multipage rows). */
  page: string | null;
  createdAt: Date;
}

/** Store one form submission for a project. The `meta` blob captures
 *  triage signals: visitor IP / UA / referer, plus the derived country +
 *  device + browser the API also sent to the notification email, and the
 *  site page the form lives on. */
export async function recordSubmission(params: {
  projectId: string;
  data: Record<string, string>;
  meta: {
    ip?: string;
    ua?: string;
    ref?: string;
    country?: string | null;
    device?: string | null;
    browser?: string | null;
    page?: string | null;
    /** Session visitor id — funnel attribution (lib/analytics/cid.ts). */
    cid?: string;
  };
  /** The form it came from (`formKeyOf`): an event task watches one form. */
  formId?: string | null;
}): Promise<void> {
  await db.insert(schema.formSubmissions).values({
    projectId: params.projectId,
    data: params.data,
    meta: params.meta,
    formId: params.formId ?? null,
  });
}

/** Which form a submission came from, in `notifyOwner`'s order: its own id, else its page and index, else its
 *  index (spec local 2026-11-03-len-que-avisa, §7.2). Null when the page didn't say. */
export function formKeyOf(o: { readonly formId: string | null; readonly formIndex: number | null; readonly page: string | null }): string | null {
  if (o.formId) return o.formId;
  if (o.formIndex === null) return null;
  return o.page ? `${o.page}:${o.formIndex}` : String(o.formIndex);
}

/** A project's submissions, newest-first. The caller verifies ownership. */
export async function listSubmissions(
  projectId: string,
): Promise<SubmissionItem[]> {
  const rows = await db
    .select({
      id: schema.formSubmissions.id,
      data: schema.formSubmissions.data,
      meta: schema.formSubmissions.meta,
      createdAt: schema.formSubmissions.createdAt,
    })
    .from(schema.formSubmissions)
    .where(eq(schema.formSubmissions.projectId, projectId))
    .orderBy(desc(schema.formSubmissions.createdAt))
    .limit(SUBMISSIONS_LIMIT);
  // Surface only the page from meta — ip/ua stay server-side.
  return rows.map((r) => ({
    id: r.id,
    data: r.data,
    page: r.meta?.page ?? null,
    createdAt: r.createdAt,
  }));
}

export interface UserSubmissionItem {
  id: string;
  projectId: string;
  projectTitle: string;
  subdomain: string | null;
  data: Record<string, string>;
  meta: {
    ip?: string;
    ua?: string;
    ref?: string;
    country?: string | null;
    device?: string | null;
    browser?: string | null;
    page?: string | null;
    cid?: string;
  } | null;
  createdAt: Date;
}

/** Every form submission across a user's projects, newest-first — powers the
 *  dashboard "Mensajes" inbox. Joins each page's title + subdomain. The caller
 *  (the /messages route) strips raw ip/ua before sending to the client. */
export async function listSubmissionsForUser(
  userId: string,
): Promise<UserSubmissionItem[]> {
  return db
    .select({
      id: schema.formSubmissions.id,
      projectId: schema.formSubmissions.projectId,
      projectTitle: schema.projects.title,
      subdomain: schema.projects.subdomain,
      data: schema.formSubmissions.data,
      meta: schema.formSubmissions.meta,
      createdAt: schema.formSubmissions.createdAt,
    })
    .from(schema.formSubmissions)
    .innerJoin(
      schema.projects,
      eq(schema.formSubmissions.projectId, schema.projects.id),
    )
    .where(eq(schema.projects.userId, userId))
    .orderBy(desc(schema.formSubmissions.createdAt))
    .limit(SUBMISSIONS_LIMIT);
}
