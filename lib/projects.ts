import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { LandingPage } from "@/lib/orchestrator/types";

// ─────────────────────────────────────────────────────────────────────────────
// Project persistence helpers.
//
// Kept in a single module so /api/generate, /api/regenerate-section, and the
// listing pages all derive title, tags, and thumbnail the same way. Nothing
// here touches auth — callers must verify ownership before passing a userId.
// ─────────────────────────────────────────────────────────────────────────────

export type ProjectStatus = "draft" | "published" | "archived";

export interface ProjectSummary {
  id: string;
  title: string;
  status: ProjectStatus;
  tags: string[];
  deployUrl: string | null;
  thumbnailUrl: string | null;
  costUsd: number;
  sectionCount: number;
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

// Auto-tag from intent: industry (always), tone (when distinctive), plus
// the style mood. Capped at 3 — list cards only show 3.
export function deriveTags(page: LandingPage): string[] {
  const tags = new Set<string>();
  const intent = page.meta.intent;
  if (intent.industry) tags.add(capitalize(intent.industry));
  if (intent.tone && intent.tone !== "professional") {
    tags.add(capitalize(intent.tone));
  }
  return Array.from(tags).slice(0, 3);
}

function asStatus(raw: string): ProjectStatus {
  if (raw === "published" || raw === "archived" || raw === "draft") return raw;
  return "draft";
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
    tags: deriveTags(page),
    status: "draft",
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
      tags: deriveTags(page),
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
      status: schema.projects.status,
      tags: schema.projects.tags,
      deployUrl: schema.projects.deployUrl,
      thumbnailUrl: schema.projects.thumbnailUrl,
      data: schema.projects.data,
      createdAt: schema.projects.createdAt,
      updatedAt: schema.projects.updatedAt,
    })
    .from(schema.projects)
    .where(eq(schema.projects.userId, userId))
    .orderBy(desc(schema.projects.updatedAt))
    .limit(200);

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    status: asStatus(row.status),
    tags: row.tags,
    deployUrl: row.deployUrl,
    thumbnailUrl: row.thumbnailUrl,
    costUsd: row.data?.cost?.total ?? 0,
    sectionCount: row.data?.plan?.blockSequence?.length ?? 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
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
    status: asStatus(row.status),
    tags: row.tags,
    deployUrl: row.deployUrl,
    brief: row.brief,
    thumbnailUrl: row.thumbnailUrl,
    costUsd: row.data?.cost?.total ?? 0,
    sectionCount: row.data?.plan?.blockSequence?.length ?? 0,
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

export async function setProjectStatus(
  projectId: string,
  userId: string,
  status: ProjectStatus,
): Promise<boolean> {
  const result = await db
    .update(schema.projects)
    .set({ status, updatedAt: new Date() })
    .where(
      and(
        eq(schema.projects.id, projectId),
        eq(schema.projects.userId, userId),
      ),
    )
    .returning({ id: schema.projects.id });
  return result.length > 0;
}

export async function duplicateProject(
  projectId: string,
  userId: string,
): Promise<string | null> {
  const existing = await getProject(projectId, userId);
  if (!existing) return null;
  const id = crypto.randomUUID();
  await db.insert(schema.projects).values({
    id,
    userId,
    title: `${existing.title} (copy)`,
    brief: existing.brief,
    status: "draft",
    tags: existing.tags,
    thumbnailUrl: existing.thumbnailUrl,
    deployUrl: null,
    data: existing.data,
  });
  return id;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
