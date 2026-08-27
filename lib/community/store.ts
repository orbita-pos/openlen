import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getUserByHandle } from "./handle";
import type { ProjectData } from "@/lib/projects/types";
import { gateReservedMarker, sanitizeForPublish } from "@/lib/html-engine";
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
  const base = and(
    eq(schema.projects.visibility, "public"),
    eq(schema.projects.status, "published"),
  );

  // Keyset pagination with a compound cursor "<sortValue>|<id>", so rows that
  // share a sort value (same listedAt, or same remixCount) are never skipped at
  // a page boundary. `recent` keys on (listedAt, id); `remixed` on (remixCount,
  // id). id is the tie-breaker — both sorts paginate correctly.
  let where = base;
  if (opts.cursor) {
    const sep = opts.cursor.lastIndexOf("|");
    const head = sep >= 0 ? opts.cursor.slice(0, sep) : "";
    const cid = sep >= 0 ? opts.cursor.slice(sep + 1) : "";
    if (cid) {
      if (opts.sort === "remixed") {
        const c = Number(head);
        if (Number.isFinite(c)) {
          where = and(
            base,
            or(
              lt(schema.projects.remixCount, c),
              and(eq(schema.projects.remixCount, c), lt(schema.projects.id, cid)),
            ),
          );
        }
      } else {
        const d = new Date(head);
        if (!Number.isNaN(d.getTime())) {
          where = and(
            base,
            or(
              lt(schema.projects.listedAt, d),
              and(eq(schema.projects.listedAt, d), lt(schema.projects.id, cid)),
            ),
          );
        }
      }
    }
  }

  const orderBy =
    opts.sort === "remixed"
      ? [desc(schema.projects.remixCount), desc(schema.projects.id)]
      : [desc(schema.projects.listedAt), desc(schema.projects.id)];

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
    .orderBy(...orderBy)
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  let nextCursor: string | null = null;
  if (hasMore && last) {
    nextCursor =
      opts.sort === "remixed"
        ? `${last.remixCount}|${last.id}`
        : `${last.listedAt ? last.listedAt.toISOString() : ""}|${last.id}`;
  }
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
      and(
        eq(schema.projects.userId, user.id),
        eq(schema.projects.visibility, "public"),
        eq(schema.projects.status, "published"),
      ),
    )
    .orderBy(desc(schema.projects.listedAt));
  return {
    user: { name: user.name, handle: user.handle, bio: user.bio, avatarUrl: user.avatarUrl },
    pages: pages.map((p) => ({ ...p, handle: user.handle, avatarUrl: user.avatarUrl })),
  };
}

export async function getPublicProjectForRemix(
  id: string,
): Promise<
{ id: string; title: string; data: ProjectData } | null> {
  const rows = await db
    .select({
      id: schema.projects.id,
      title: schema.projects.title,
      data: schema.projects.data,
      visibility: schema.projects.visibility,
      status: schema.projects.status,
      // El JavaScript del modelo viaja con el remix — ver la nota larga en
      // `remixProject`. Las dos columnas, obligatorias por tipo.
    })
    .from(schema.projects)
    .where(eq(schema.projects.id, id))
    .limit(1);
  const r = rows[0];
  if (!r || r.visibility !== "public" || r.status !== "published") return null;
  return {
    id: r.id,
    title: r.title,
    data: r.data as ProjectData,
  };
}

export async function setVisibility(
  projectId: string,
  userId: string,
  next: "public" | "private",
): Promise<{ ok: true } | { ok: false; reason: "not_found" | "not_published" | "blocked" | "invalid_html" | "moderated" }> {
  const rows = await db
    .select({
      id: schema.projects.id,
      title: schema.projects.title,
      status: schema.projects.status,
      data: schema.projects.data,
      visibility: schema.projects.visibility,
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
  // A hidden page was pulled by an admin — the owner cannot re-list it.
  if (p.visibility === "hidden") return { ok: false, reason: "moderated" };
  if (p.status !== "published") return { ok: false, reason: "not_published" };
  // Scan the home doc AND every subpage: a data-slot-path editor marker or a
  // blocked term on ANY page must keep the whole project out of the feed.
  const data = p.data as ProjectData;
  const htmls = [data?.html ?? "", ...Object.values(data?.pages ?? {}).map((pg) => pg.html)];
  if (htmls.some((h) => sanitizeForPublish(h).html === null)) return { ok: false, reason: "invalid_html" };
  if (containsBlockedTerm([p.title, ...htmls].join("\n"))) return { ok: false, reason: "blocked" };

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

  // LA PUERTA, no el saneador. Esta página ya pasó por SU puerta cuando su
  // autor la creó: el pegado por `from-html`, la plantilla por
  // `from-template`, lo que escribió el modelo por `gateReservedMarker`. Lo que
  // está en la base está dentro.
  //
  // Y ademÁS es lo que Jesús decidió el 2026-08-26: el remix se lleva el
  // JavaScript. Lo que alguien publica en el Explore es público, y remixar una
  // página copiándole el marcado pero no el comportamiento te deja un catálogo
  // con los filtros muertos — la clase de página que miente sobre lo que hace.
  const srcHtml = src.data?.html ?? "";
  const cleaned = gateReservedMarker(srcHtml).html;
  if (cleaned === null) return null; // defensive
  const finalHtml = ensurePageMeta(normalizeBornCanonical(cleaned), { title: src.title });

  const clonedPages: Record<string, { html: string }> = {};
  for (const [slug, pg] of Object.entries(src.data?.pages ?? {})) {
    const c = gateReservedMarker(pg.html).html;
    if (c === null) continue;
    clonedPages[slug] = { html: ensurePageMeta(normalizeBornCanonical(c), { title: src.title }) };
  }

  const newId = crypto.randomUUID();

  // EL JAVASCRIPT VIAJA SOLO. Vive dentro de `finalHtml` y de cada página
  // clonada, así que remixar lo copia por copiar el documento. Antes había
  // que RE-ATAR cada cápsula al proyecto nuevo (`rebindCapsule`) porque el
  // hash incluía el `projectId` y una copia lo cambiaba.

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
  // Only report against projects that are actually public — don't leak the
  // existence of a private project's id via the admin queue join.
  const rows = await db
    .select({ visibility: schema.projects.visibility })
    .from(schema.projects)
    .where(eq(schema.projects.id, input.projectId))
    .limit(1);
  if (rows[0]?.visibility !== "public") return;

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
  await db.update(schema.projects)
    .set(next === "public" ? { visibility: next, listedAt: new Date() } : { visibility: next })
    .where(eq(schema.projects.id, projectId));
  if (next === "hidden") {
    await db.update(schema.pageReports).set({ status: "actioned" })
      .where(and(eq(schema.pageReports.projectId, projectId), eq(schema.pageReports.status, "open")));
  }
}
