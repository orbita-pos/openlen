import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { LandingPage } from "@/lib/orchestrator/types";

// ─────────────────────────────────────────────────────────────────────────────
// Project persistence helpers.
//
// Kept in a single module so /api/generate, /api/regenerate-section, and the
// listing pages all derive title and thumbnail the same way. Nothing here
// touches auth — callers must verify ownership before passing a userId.
// ─────────────────────────────────────────────────────────────────────────────

export interface ProjectSummary {
  id: string;
  title: string;
  thumbnailUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectFull extends ProjectSummary {
  userId: string;
  brief: string;
  data: LandingPage;
}

export function deriveTitle(page: LandingPage): string {
  if (page.meta.title && page.meta.title.trim()) return page.meta.title.trim();
  if (page.meta.intent.productName) return page.meta.intent.productName;
  return `${capitalize(page.meta.intent.industry)} landing page`;
}

export function deriveThumbnail(page: LandingPage): string | null {
  const hero = page.images.find((i) => i.purpose === "hero");
  return hero?.url ?? page.images[0]?.url ?? null;
}

export async function createProject(
  userId: string,
  page: LandingPage,
): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(schema.projects).values({
    id,
    userId,
    title: deriveTitle(page),
    brief: page.meta.brief,
    thumbnailUrl: deriveThumbnail(page),
    data: page,
  });
  return id;
}

export async function updateProjectPage(
  projectId: string,
  userId: string,
  page: LandingPage,
): Promise<void> {
  await db
    .update(schema.projects)
    .set({
      title: deriveTitle(page),
      thumbnailUrl: deriveThumbnail(page),
      data: page,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.projects.id, projectId),
        eq(schema.projects.userId, userId),
      ),
    );
}

export async function listProjects(userId: string): Promise<ProjectSummary[]> {
  const rows = await db
    .select({
      id: schema.projects.id,
      title: schema.projects.title,
      thumbnailUrl: schema.projects.thumbnailUrl,
      createdAt: schema.projects.createdAt,
      updatedAt: schema.projects.updatedAt,
    })
    .from(schema.projects)
    .where(eq(schema.projects.userId, userId))
    .orderBy(desc(schema.projects.updatedAt))
    .limit(200);
  return rows;
}

export async function getProject(
  projectId: string,
  userId: string,
): Promise<ProjectFull | null> {
  const rows = await db
    .select()
    .from(schema.projects)
    .where(
      and(
        eq(schema.projects.id, projectId),
        eq(schema.projects.userId, userId),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    userId: row.userId,
    title: row.title,
    brief: row.brief,
    thumbnailUrl: row.thumbnailUrl,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    data: row.data,
  };
}

export async function deleteProject(
  projectId: string,
  userId: string,
): Promise<boolean> {
  const result = await db
    .delete(schema.projects)
    .where(
      and(
        eq(schema.projects.id, projectId),
        eq(schema.projects.userId, userId),
      ),
    )
    .returning({ id: schema.projects.id });
  return result.length > 0;
}

export async function renameProject(
  projectId: string,
  userId: string,
  title: string,
): Promise<boolean> {
  const result = await db
    .update(schema.projects)
    .set({ title, updatedAt: new Date() })
    .where(
      and(
        eq(schema.projects.id, projectId),
        eq(schema.projects.userId, userId),
      ),
    )
    .returning({ id: schema.projects.id });
  return result.length > 0;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
