// What the box's view of the draft needs of a project, as saved (lib/lienzo/vista-de-la-caja.ts). Its own
// module so the canvas route's tests can stand in for the database.

import "server-only";

import { eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import type { ProjectData } from "@/lib/projects/types";

export interface SavedProject {
  readonly title: string | null;
  readonly subdomain: string | null;
  readonly data: Partial<ProjectData> | null;
}

export async function loadSavedProject(projectId: string): Promise<SavedProject | null> {
  const [row] = await db
    .select({ title: schema.projects.title, subdomain: schema.projects.subdomain, data: schema.projects.data })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .limit(1);
  return row ? { title: row.title ?? null, subdomain: row.subdomain ?? null, data: (row.data as Partial<ProjectData> | null) ?? null } : null;
}
