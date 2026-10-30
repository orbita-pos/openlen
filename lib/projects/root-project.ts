// WHOSE A WORKTREE IS (spec local 2026-10-30-len-watch, §5.5): the hidden working copy of a Len Watch fix belongs
// to its parent — its backend, its variables, its owner and members are the parent's. A project's parent never
// changes, so the answer is kept. 🔴 Only lookups and creation go through here: what DELETES (a backend's teardown,
// `deleteEnvironment`) never does, or deleting a copy would delete its parent's databases.
import "server-only";
import { eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";

const known = new Map<string, string>();
const MAX_KNOWN = 5_000;

/** The project a worktree belongs to, or the project itself. Fail-soft: if it can't tell, the project itself. */
export async function rootProject(projectId: string): Promise<string> {
  const hit = known.get(projectId);
  if (hit) return hit;
  try {
    const [row] = await db.select({ parentId: schema.projects.parentProjectId }).from(schema.projects).where(eq(schema.projects.id, projectId)).limit(1);
    if (!row) return projectId;
    const root = row.parentId ?? projectId;
    if (known.size >= MAX_KNOWN) known.clear();
    known.set(projectId, root);
    return root;
  } catch {
    return projectId;
  }
}
