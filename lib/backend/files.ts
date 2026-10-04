// Los ficheros del proyecto que no son páginas (`projectFiles`): hoy, los de
// `/supabase/` — sus migraciones (lib/agent/ficheros/supabase.ts).

import "server-only";
import { and, asc, eq, like } from "drizzle-orm";

import { db, schema } from "@/lib/db";

export async function listProjectFiles(projectId: string, prefix: string): Promise<Record<string, string>> {
  const rows = await db
    .select({ path: schema.projectFiles.path, content: schema.projectFiles.content })
    .from(schema.projectFiles)
    .where(and(eq(schema.projectFiles.projectId, projectId), like(schema.projectFiles.path, `${prefix}%`)))
    .orderBy(asc(schema.projectFiles.path));
  return Object.fromEntries(rows.map((r) => [r.path, r.content]));
}

export async function saveProjectFile(projectId: string, path: string, content: string): Promise<void> {
  await db
    .insert(schema.projectFiles)
    .values({ projectId, path, content })
    .onConflictDoUpdate({
      target: [schema.projectFiles.projectId, schema.projectFiles.path],
      set: { content, updatedAt: new Date() },
    });
}
