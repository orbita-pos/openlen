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
  createdAt: Date;
}

/** Store one form submission for a project. The `meta` blob captures
 *  triage signals: visitor IP / UA / referer, plus the derived country +
 *  device + browser the API also sent to the notification email. */
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
  };
}): Promise<void> {
  await db.insert(schema.formSubmissions).values({
    projectId: params.projectId,
    data: params.data,
    meta: params.meta,
  });
}

/** A project's submissions, newest-first. The caller verifies ownership. */
export async function listSubmissions(
  projectId: string,
): Promise<SubmissionItem[]> {
  return db
    .select({
      id: schema.formSubmissions.id,
      data: schema.formSubmissions.data,
      createdAt: schema.formSubmissions.createdAt,
    })
    .from(schema.formSubmissions)
    .where(eq(schema.formSubmissions.projectId, projectId))
    .orderBy(desc(schema.formSubmissions.createdAt))
    .limit(SUBMISSIONS_LIMIT);
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
