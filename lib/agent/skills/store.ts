// THE SKILLS OF /.len/skills AND ~/.len/skills IN POSTGRES (spec local 2026-10-26-len-skills, table
// `lenSkills`), shaped like the memory notes' store (`lib/agent/memory/store.ts`): deleting is soft
// (`deletedAt`), and writing one with the same name revives it in the same row.
import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";

import type { SkillScope } from "./paths";

export interface StoredSkill {
  readonly name: string;
  /** The whole SKILL.md. */
  readonly text: string;
  readonly updatedAt: Date;
}

const t = schema.lenSkills;
const owned = (scope: SkillScope, ownerId: string) => and(eq(t.scope, scope), eq(t.ownerId, ownerId), isNull(t.deletedAt));

/** The live skills of a project or a person, by name. */
export async function listSkills(scope: SkillScope, ownerId: string): Promise<StoredSkill[]> {
  return db.select({ name: t.name, text: t.text, updatedAt: t.updatedAt }).from(t).where(owned(scope, ownerId)).orderBy(asc(t.name));
}

async function liveText(scope: SkillScope, ownerId: string, name: string): Promise<string | null> {
  const rows = await db.select({ text: t.text }).from(t).where(and(owned(scope, ownerId), eq(t.name, name))).limit(1);
  return rows[0]?.text ?? null;
}

/** Creates or replaces it (and revives it if it was deleted). `before` = how it was, live. */
export async function upsertSkill(scope: SkillScope, ownerId: string, name: string, text: string, authorId: string | null): Promise<{ before: string | null }> {
  const before = await liveText(scope, ownerId, name);
  await db
    .insert(t)
    .values({ scope, ownerId, name, text, authorId })
    .onConflictDoUpdate({ target: [t.scope, t.ownerId, t.name], set: { text, authorId, updatedAt: new Date(), deletedAt: null } });
  return { before };
}

/** Soft delete. `before` = how it was, live, or `null` if there was none. */
export async function deleteSkill(scope: SkillScope, ownerId: string, name: string): Promise<{ before: string | null }> {
  const before = await liveText(scope, ownerId, name);
  if (before === null) return { before: null };
  await db.update(t).set({ deletedAt: new Date() }).where(and(owned(scope, ownerId), eq(t.name, name)));
  return { before };
}
