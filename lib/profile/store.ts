/**
 * EL PERFIL DE UNA PERSONA y QUIÉN VE QUÉ de él
 * (docs/superpowers/specs/2026-10-10-profile-design.md). 🔴 La regla vive AQUÍ
 * y en ningún otro sitio: cada persona ve los proyectos que podría abrir de
 * todos modos —
 *   · un desconocido (o sin sesión): los de Explorar (públicos y publicados);
 *   · un compañero: además, los privados en los que están LOS DOS;
 *   · uno mismo: todos los suyos (dueño, editor, lector).
 * Nunca el proyecto en blanco (`lib/projects/blank.ts`) ni los archivados. La
 * página no filtra nada por su cuenta.
 */
import "server-only";

import { and, desc, eq, ne, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { getUserByHandle } from "@/lib/community/handle";
import { deployUrlFor } from "@/lib/publish/deploy-url";

import { avatarOf } from "./avatar";
import type { ProfileData, ProfileProject } from "./types";
import { MAX_PINNED, type ProfilePatch } from "./validate";

/** La consulta de `listProfileProjects`, sin ejecutar (la prueba mira su plan). */
export function profileProjectsQuery(profileUserId: string, viewerId: string | null) {
  const p = schema.projects;
  const pm = schema.projectMembers;
  // ⚠️ `${p}."userId"` y no `${p.userId}`: dentro de un campo del `select`
  // Drizzle escribe la columna SIN tabla, y aquí `"userId"` también es de
  // projectMembers (lib/projects.ts lo midió con `"id"`).
  const viewerIn = viewerId
    ? sql<boolean>`(${p}."userId" = ${viewerId} or exists (select 1 from ${pm} v where v."projectId" = ${p}."id" and v."userId" = ${viewerId}))`
    : sql<boolean>`false`;
  return db
    .select({
      id: p.id,
      title: p.title,
      thumbnailUrl: p.thumbnailUrl,
      deployUrl: p.deployUrl,
      subdomain: p.subdomain,
      visibility: p.visibility,
      status: p.status,
      ownerId: p.userId,
      memberRole: pm.rol,
      updatedAt: p.updatedAt,
      viewerIn,
    })
    .from(p)
    .leftJoin(pm, and(eq(pm.projectId, p.id), eq(pm.userId, profileUserId)))
    .where(
      and(
        // Sus proyectos (dueño o miembro) por los dos índices —projects_userId_idx y
        // projectMembers_userId_idx—. Con un `or` entre el dueño y el miembro del
        // join, Postgres recorría la tabla entera en cada visita a un perfil.
        sql`${p}."id" in (select "id" from ${p} where "userId" = ${profileUserId} union all select "projectId" from ${pm} where "userId" = ${profileUserId})`,
        ne(p.status, "archived"),
        // NO en blanco: con portada, con páginas o con conversación (lo mismo
        // que `isBlankProject`, en SQL para no traer el HTML de 200 proyectos).
        sql`(coalesce(btrim(${p}."data"->>'html'), '') <> '' or coalesce(${p}."data"->'pages', '{}'::jsonb) not in ('{}'::jsonb, 'null'::jsonb) or exists (select 1 from ${schema.projectChatMessages} m where m."projectId" = ${p}."id"))`,
      ),
    )
    .orderBy(desc(p.updatedAt))
    .limit(200);
}

export async function listProfileProjects(
  profileUserId: string,
  viewerId: string | null,
): Promise<{ projects: ProfileProject[]; sharedCount: number }> {
  const rows = await profileProjectsQuery(profileUserId, viewerId);
  const isSelf = viewerId === profileUserId;
  const projects = rows
    .filter((r) => Boolean(r.viewerIn) || (r.visibility === "public" && r.status === "published"))
    .map(
      (r): ProfileProject => ({
        id: r.id,
        title: r.title,
        thumbnailUrl: r.thumbnailUrl,
        deployUrl: deployUrlFor(r.subdomain) ?? r.deployUrl,
        role: r.ownerId === profileUserId ? "dueno" : r.memberRole === "editor" ? "editor" : "lector",
        shared: Boolean(r.viewerIn) && !isSelf,
        canOpen: Boolean(r.viewerIn),
        updatedAt: r.updatedAt.toISOString(),
      }),
    );
  return { projects, sharedCount: isSelf ? 0 : projects.filter((x) => x.shared).length };
}

export async function getProfile(handle: string, viewerId: string | null): Promise<ProfileData | null> {
  const u = await getUserByHandle(handle);
  if (!u) return null;
  const { projects, sharedCount } = await listProfileProjects(u.id, viewerId);
  const byId = new Map(projects.map((x) => [x.id, x]));
  // Un fijado que quien mira no puede ver —o que ya no existe— simplemente no sale.
  const pinnedIds = [...new Set(u.pinnedProjectIds ?? [])].filter((id) => byId.has(id)).slice(0, MAX_PINNED);
  const pinned = new Set(pinnedIds);
  const isSelf = viewerId === u.id;
  return {
    userId: u.id,
    handle: u.handle,
    name: u.name,
    bio: u.bio,
    avatar: avatarOf(u),
    hasCustomAvatar: isSelf && Boolean(u.avatarUrl),
    links: (u.links ?? []).map((l) => l.url),
    pinned: pinnedIds.map((id) => byId.get(id)!),
    projects: projects.filter((x) => !pinned.has(x.id)),
    sharedCount,
    isSelf,
  };
}

/** Lo ya validado (`parseProfilePatch`). Un fijado tiene que ser un proyecto en
 *  el que estés; los demás se ignoran sin error. */
export async function updateProfile(userId: string, patch: ProfilePatch): Promise<void> {
  const set: Partial<typeof schema.users.$inferInsert> = {};
  if (patch.name !== undefined) set.name = patch.name || null;
  if (patch.bio !== undefined) set.bio = patch.bio || null;
  if (patch.links !== undefined) set.links = patch.links.map((url) => ({ url }));
  if (patch.pinnedProjectIds !== undefined) {
    const mine = new Set((await listProfileProjects(userId, userId)).projects.map((x) => x.id));
    set.pinnedProjectIds = [...new Set(patch.pinnedProjectIds)].filter((id) => mine.has(id)).slice(0, MAX_PINNED);
  }
  if (Object.keys(set).length === 0) return;
  await db.update(schema.users).set(set).where(eq(schema.users.id, userId));
}
