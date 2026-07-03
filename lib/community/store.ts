import { and, desc, eq, lt, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getUserByHandle } from "./handle";
import type { ProjectData } from "@/lib/projects/types";
import { sanitizeForPublish } from "@/lib/html-engine";
import { normalizeBornCanonical } from "@/lib/normalize";
import { ensurePageMeta } from "@/lib/publish/ensure-page-meta";
import { createVersion } from "@/lib/projects/versions";
import { containsBlockedTerm } from "./blocklist";

export type ExploreCard = {
  id: string;
  title: string;
  thumbnailUrl: string | null;
  deployUrl: string | null;
  handle: string | null;
  avatarUrl: string | null;
  remixCount: number;
  listedAt: Date | null;
};

const PAGE = 24;

export async function listExplore(opts: {
  sort: "recent" | "remixed";
  cursor?: string;
  limit?: number;
}): Promise<{ items: ExploreCard[]; nextCursor: string | null }> {
  const limit = Math.min(opts.limit ?? PAGE, 48);
  // Cursor is the ISO listedAt of the last row (recent sort only — keeps it simple).
  const cursorDate = opts.cursor ? new Date(opts.cursor) : null;
  const where =
    cursorDate && opts.sort === "recent"
      ? and(eq(schema.projects.visibility, "public"), lt(schema.projects.listedAt, cursorDate))
      : eq(schema.projects.visibility, "public");

  const rows = await db
    .select({
      id: schema.projects.id,
      title: schema.projects.title,
      thumbnailUrl: schema.projects.thumbnailUrl,
      deployUrl: schema.projects.deployUrl,
      remixCount: schema.projects.remixCount,
      listedAt: schema.projects.listedAt,
      handle: schema.users.handle,
      avatarUrl: schema.users.avatarUrl,
    })
    .from(schema.projects)
    .innerJoin(schema.users, eq(schema.users.id, schema.projects.userId))
    .where(where)
    .orderBy(
      opts.sort === "remixed"
        ? desc(schema.projects.remixCount)
        : desc(schema.projects.listedAt),
    )
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  const nextCursor =
    hasMore && opts.sort === "recent" && last?.listedAt
      ? last.listedAt.toISOString()
      : null;
  return { items, nextCursor };
}

export async function getPublicProfile(handle: string) {
  const user = await getUserByHandle(handle);
  if (!user || !user.handle) return null;
  const pages = await db
    .select({
      id: schema.projects.id,
      title: schema.projects.title,
      thumbnailUrl: schema.projects.thumbnailUrl,
      deployUrl: schema.projects.deployUrl,
      remixCount: schema.projects.remixCount,
      listedAt: schema.projects.listedAt,
    })
    .from(schema.projects)
    .where(
      and(eq(schema.projects.userId, user.id), eq(schema.projects.visibility, "public")),
    )
    .orderBy(desc(schema.projects.listedAt));
  return {
    user: { name: user.name, handle: user.handle, bio: user.bio, avatarUrl: user.avatarUrl },
    pages: pages.map((p) => ({ ...p, handle: user.handle, avatarUrl: user.avatarUrl })),
  };
}

export async function getPublicProjectForRemix(
  id: string,
): Promise<{ id: string; title: string; data: ProjectData } | null> {
  const rows = await db
    .select({
      id: schema.projects.id,
      title: schema.projects.title,
      data: schema.projects.data,
      visibility: schema.projects.visibility,
    })
    .from(schema.projects)
    .where(eq(schema.projects.id, id))
    .limit(1);
  const r = rows[0];
  if (!r || r.visibility !== "public") return null;
  return { id: r.id, title: r.title, data: r.data as ProjectData };
}

export async function setVisibility(
  projectId: string,
  userId: string,
  next: "public" | "private",
): Promise<{ ok: true } | { ok: false; reason: "not_found" | "not_published" | "blocked" | "invalid_html" }> {
  const rows = await db
    .select({
      id: schema.projects.id,
      title: schema.projects.title,
      status: schema.projects.status,
      data: schema.projects.data,
    })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)))
    .limit(1);
  const p = rows[0];
  if (!p) return { ok: false, reason: "not_found" };

  if (next === "private") {
    await db.update(schema.projects).set({ visibility: "private" })
      .where(eq(schema.projects.id, projectId));
    return { ok: true };
  }

  // → public. Guardrails.
  if (p.status !== "published") return { ok: false, reason: "not_published" };
  const html = (p.data as ProjectData)?.html ?? "";
  if (sanitizeForPublish(html).html === null) return { ok: false, reason: "invalid_html" };
  const hit = containsBlockedTerm(`${p.title}\n${html}`);
  if (hit) return { ok: false, reason: "blocked" };

  await db.update(schema.projects)
    .set({ visibility: "public", listedAt: new Date() })
    .where(eq(schema.projects.id, projectId));
  return { ok: true };
}

export async function remixProject(
  sourceId: string,
  viewerUserId: string,
): Promise<{ newId: string } | null> {
  const src = await getPublicProjectForRemix(sourceId);
  if (!src) return null;

  const srcHtml = src.data?.html ?? "";
  const cleaned = sanitizeForPublish(srcHtml).html;
  if (cleaned === null) return null; // defensive
  const finalHtml = ensurePageMeta(normalizeBornCanonical(cleaned), { title: src.title });

  const clonedPages: Record<string, { html: string }> = {};
  for (const [slug, pg] of Object.entries(src.data?.pages ?? {})) {
    const c = sanitizeForPublish(pg.html).html;
    if (c === null) continue;
    clonedPages[slug] = { html: ensurePageMeta(normalizeBornCanonical(c), { title: src.title }) };
  }

  const newId = crypto.randomUUID();
  await db.insert(schema.projects).values({
    id: newId,
    userId: viewerUserId,
    title: src.title,
    brief: `Remix of ${src.title}`,
    status: "draft",
    remixedFromId: src.id,
    data: { html: finalHtml, ...(Object.keys(clonedPages).length ? { pages: clonedPages } : {}) },
  });

  await db.update(schema.projects)
    .set({ remixCount: sql`${schema.projects.remixCount} + 1` })
    .where(eq(schema.projects.id, src.id));

  await createVersion({ projectId: newId, html: finalHtml, label: `Remix: ${src.title}`, source: "initial" })
    .catch(() => {});

  return { newId };
}

export async function insertReport(input: {
  projectId: string; reason: string; note?: string; uaHash?: string;
}): Promise<void> {
  await db.insert(schema.pageReports).values({
    projectId: input.projectId,
    reason: input.reason,
    note: input.note ?? null,
    reporterUaHash: input.uaHash ?? null,
  });
}

export async function listOpenReports() {
  return db
    .select({
      id: schema.pageReports.id,
      projectId: schema.pageReports.projectId,
      reason: schema.pageReports.reason,
      note: schema.pageReports.note,
      createdAt: schema.pageReports.createdAt,
      title: schema.projects.title,
      deployUrl: schema.projects.deployUrl,
      visibility: schema.projects.visibility,
    })
    .from(schema.pageReports)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.pageReports.projectId))
    .where(eq(schema.pageReports.status, "open"))
    .orderBy(desc(schema.pageReports.createdAt));
}

export async function adminSetVisibility(projectId: string, next: "public" | "hidden"): Promise<void> {
  await db.update(schema.projects).set({ visibility: next })
    .where(eq(schema.projects.id, projectId));
  if (next === "hidden") {
    await db.update(schema.pageReports).set({ status: "actioned" })
      .where(and(eq(schema.pageReports.projectId, projectId), eq(schema.pageReports.status, "open")));
  }
}
