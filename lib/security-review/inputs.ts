// lib/security-review/inputs.ts — what a review looks at, read from the
// project as it is stored, once:
//   · its pages and its folder;
//   · its production variables (an app's);
//   · its draft database's schema.
// A database that doesn't answer is a review without the database part; it is
// never an error that stops the publish.

import "server-only";

import { eq } from "drizzle-orm";

import { envVarsFor } from "@/lib/apps/env/store";
import { getEnvironment } from "@/lib/backend/environments";
import { listProjectFiles } from "@/lib/backend/files";
import { backendConfigured } from "@/lib/backend/pg";
import { adoptLegacyEnvironment, backendProjectFor, getBackendByProject } from "@/lib/backend/registry";
import type { BackendProject } from "@/lib/backend/router";
import { db, schema } from "@/lib/db";

import { dumpSchema } from "./schema-dump";
import type { ReviewInputs } from "./types";

async function draftDatabase(projectId: string, subdomain: string | null): Promise<{ readonly hasBackend: boolean; readonly project: BackendProject | null }> {
  if (!backendConfigured()) return { hasBackend: false, project: null };
  const record = await getBackendByProject(projectId);
  if (!record) return { hasBackend: false, project: null };
  await adoptLegacyEnvironment(record);
  const environment = await getEnvironment(projectId, "draft");
  if (!environment?.provisionedAt) return { hasBackend: true, project: null };
  return { hasBackend: true, project: backendProjectFor({ record, pageSub: subdomain }, environment) };
}

export async function loadReviewInputs(projectId: string): Promise<ReviewInputs | null> {
  const [row] = await db
    .select({ userId: schema.projects.userId, data: schema.projects.data, subdomain: schema.projects.subdomain })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .limit(1);
  if (!row) return null;
  const app = row.data?.app ?? null;
  const [files, productionEnv, draft] = await Promise.all([
    listProjectFiles(projectId),
    app ? envVarsFor(projectId, "production") : Promise.resolve({}),
    draftDatabase(projectId, row.subdomain ?? null).catch((err: unknown) => {
      console.warn("[security-review] the draft database didn't answer; reviewing without it", err);
      return { hasBackend: false, project: null };
    }),
  ]);
  const schemaDump = draft.project
    ? await dumpSchema(draft.project).catch((err: unknown) => {
        // Said out loud: without the schema, the database rules don't run.
        console.warn("[security-review] could not read the draft database's schema; reviewing without it", err);
        return null;
      })
    : null;
  return {
    projectId,
    ownerId: row.userId,
    app,
    homeHtml: row.data?.html ?? "",
    pages: Object.fromEntries(Object.entries(row.data?.pages ?? {}).map(([slug, p]) => [slug, p.html])),
    files,
    productionEnv,
    hasBackend: draft.hasBackend,
    schema: schemaDump,
  };
}
