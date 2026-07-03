import { and, desc, eq, lt } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getUserByHandle } from "./handle";
import type { ProjectData } from "@/lib/projects/types";

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
