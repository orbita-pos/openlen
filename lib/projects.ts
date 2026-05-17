import { and, desc, eq, isNotNull, ne, sql as sqlOp } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { LandingPage } from "@/lib/orchestrator/types";
import { getUserPlan } from "@/lib/limits";
import { subdomainLimitForPlan } from "@/lib/subdomain/limits";
import { validateSubdomain } from "@/lib/subdomain/validate";
import { publishToDir, unpublishDir } from "@/lib/publish/filesystem";

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
  subdomain: string | null;
  publishedAt: Date | null;
  hasUnpublishedChanges: boolean;
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

function publishBaseHost(): string {
  return process.env.PUBLISH_BASE_HOST?.trim() || "openlen.com";
}

/** Stitch `subdomain.<base>` into the deploy URL we show in the UI. */
function deployUrlFor(subdomain: string | null): string | null {
  if (!subdomain) return null;
  return `https://${subdomain}.${publishBaseHost()}`;
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
      subdomain: schema.projects.subdomain,
      publishedAt: schema.projects.publishedAt,
      publishedHtml: schema.projects.publishedHtml,
      data: schema.projects.data,
      createdAt: schema.projects.createdAt,
      updatedAt: schema.projects.updatedAt,
    })
    .from(schema.projects)
    .where(eq(schema.projects.userId, userId))
    .orderBy(desc(schema.projects.updatedAt))
    .limit(200);

  return rows.map((row) => {
    // Prefer the subdomain-derived URL; fall back to the legacy column for
    // any rows pre-Session-11.
    const derivedDeploy = deployUrlFor(row.subdomain);
    const currentHtml = row.data?.html ?? "";
    return {
      id: row.id,
      title: row.title,
      status: asStatus(row.status),
      tags: row.tags,
      deployUrl: derivedDeploy ?? row.deployUrl,
      thumbnailUrl: row.thumbnailUrl,
      subdomain: row.subdomain,
      publishedAt: row.publishedAt,
      hasUnpublishedChanges:
        row.subdomain !== null && row.publishedHtml !== null
          ? row.publishedHtml !== currentHtml
          : false,
      costUsd: row.data?.cost?.total ?? 0,
      sectionCount: row.data?.plan?.blockSequence?.length ?? 0,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  });
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
  const derivedDeploy = deployUrlFor(row.subdomain);
  const currentHtml = row.data?.html ?? "";
  return {
    id: row.id,
    userId: row.userId,
    title: row.title,
    status: asStatus(row.status),
    tags: row.tags,
    deployUrl: derivedDeploy ?? row.deployUrl,
    brief: row.brief,
    thumbnailUrl: row.thumbnailUrl,
    subdomain: row.subdomain,
    publishedAt: row.publishedAt,
    hasUnpublishedChanges:
      row.subdomain !== null && row.publishedHtml !== null
        ? row.publishedHtml !== currentHtml
        : false,
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
  // If the project was published, the wildcard dir lives outside the DB —
  // best-effort wipe it before deleting the row.
  const existing = await db
    .select({ subdomain: schema.projects.subdomain })
    .from(schema.projects)
    .where(
      and(
        eq(schema.projects.id, projectId),
        eq(schema.projects.userId, userId),
      ),
    )
    .limit(1);
  const sub = existing[0]?.subdomain;

  const result = await db
    .delete(schema.projects)
    .where(
      and(
        eq(schema.projects.id, projectId),
        eq(schema.projects.userId, userId),
      ),
    )
    .returning({ id: schema.projects.id });

  if (sub) {
    await unpublishDir(sub).catch(() => {
      // Leave the dir on disk; cleanup sweep eventually picks it up or an
      // operator can rm it. Surface the delete success either way.
    });
  }
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
    // Don't carry forward the published subdomain — it's claimed by the
    // source project. The duplicate starts unpublished.
    subdomain: null,
    publishedAt: null,
    publishedHtml: null,
    data: existing.data,
  });
  return id;
}

// ─────────────────────────────────────────────────────────────────────────────
// Session 11 — publish flow.
// ─────────────────────────────────────────────────────────────────────────────

export class SubdomainInvalidError extends Error {
  constructor(public readonly reason: "invalid" | "reserved") {
    super(`subdomain ${reason}`);
    this.name = "SubdomainInvalidError";
  }
}
export class SubdomainTakenError extends Error {
  constructor() {
    super("subdomain taken");
    this.name = "SubdomainTakenError";
  }
}
export class SubdomainLimitError extends Error {
  constructor(public readonly limit: number) {
    super("subdomain limit reached");
    this.name = "SubdomainLimitError";
  }
}
export class ProjectNotFoundError extends Error {
  constructor() {
    super("project not found");
    this.name = "ProjectNotFoundError";
  }
}

interface PublishParams {
  projectId: string;
  userId: string;
  subdomain: string;
}
interface PublishResult {
  subdomain: string;
  url: string;
  publishedAt: Date;
}

export async function publishProject(
  params: PublishParams,
): Promise<PublishResult> {
  // 1. regex → length → reserved
  const v = validateSubdomain(params.subdomain);
  if (!v.ok) throw new SubdomainInvalidError(v.reason);

  // 2. ownership — also pulls the current data.html so we can snapshot it.
  const projects = await db
    .select({
      id: schema.projects.id,
      userId: schema.projects.userId,
      data: schema.projects.data,
      subdomain: schema.projects.subdomain,
    })
    .from(schema.projects)
    .where(
      and(
        eq(schema.projects.id, params.projectId),
        eq(schema.projects.userId, params.userId),
      ),
    )
    .limit(1);
  const project = projects[0];
  if (!project) throw new ProjectNotFoundError();

  // 3. tier limit — counts the user's OTHER active subdomains; updating
  // the same project (keeping its subdomain or renaming) doesn't count
  // toward the cap.
  const plan = await getUserPlan(params.userId);
  const cap = subdomainLimitForPlan(plan);
  const isClaimingNew = project.subdomain !== v.value;
  if (isClaimingNew) {
    const others = await db
      .select({ count: sqlOp<number>`count(*)::int` })
      .from(schema.projects)
      .where(
        and(
          eq(schema.projects.userId, params.userId),
          isNotNull(schema.projects.subdomain),
          ne(schema.projects.id, params.projectId),
        ),
      );
    const count = others[0]?.count ?? 0;
    if (count >= cap) throw new SubdomainLimitError(cap);
  }

  const html = project.data?.html ?? "";
  const now = new Date();

  // 4. DB upsert — claim the subdomain. We do this BEFORE the filesystem
  // write so a UNIQUE collision short-circuits without leaving an orphan
  // directory. On FS failure below we roll back.
  const previousSubdomain = project.subdomain;
  const previousPublished = await db
    .select({
      publishedAt: schema.projects.publishedAt,
      publishedHtml: schema.projects.publishedHtml,
      status: schema.projects.status,
    })
    .from(schema.projects)
    .where(eq(schema.projects.id, params.projectId))
    .limit(1);
  const prev = previousPublished[0];

  try {
    await db
      .update(schema.projects)
      .set({
        subdomain: v.value,
        publishedAt: now,
        publishedHtml: html,
        status: "published",
        deployUrl: `${v.value}.${publishBaseHost()}`,
        updatedAt: now,
      })
      .where(eq(schema.projects.id, params.projectId));
  } catch (err) {
    if (isUniqueViolation(err)) throw new SubdomainTakenError();
    throw err;
  }

  // 5. Filesystem write. On failure, undo the DB row so the user can
  // try again (or pick a different subdomain) without the row claiming
  // a sub they didn't actually publish.
  try {
    await publishToDir({ subdomain: v.value, html });
  } catch (err) {
    await db
      .update(schema.projects)
      .set({
        subdomain: previousSubdomain,
        publishedAt: prev?.publishedAt ?? null,
        publishedHtml: prev?.publishedHtml ?? null,
        status: prev?.status ?? "draft",
        deployUrl: previousSubdomain
          ? `${previousSubdomain}.${publishBaseHost()}`
          : null,
        updatedAt: now,
      })
      .where(eq(schema.projects.id, params.projectId))
      .catch(() => {
        // If even the rollback fails the row is wedged — surface the
        // original error and let the operator clean up.
      });
    throw err;
  }

  // 6. If the project's subdomain changed (rename), clean up the old dir.
  if (previousSubdomain && previousSubdomain !== v.value) {
    await unpublishDir(previousSubdomain).catch(() => {});
  }

  return {
    subdomain: v.value,
    url: `https://${v.value}.${publishBaseHost()}`,
    publishedAt: now,
  };
}

interface UnpublishParams {
  projectId: string;
  userId: string;
}

export async function unpublishProject(params: UnpublishParams): Promise<void> {
  const rows = await db
    .select({
      id: schema.projects.id,
      subdomain: schema.projects.subdomain,
      status: schema.projects.status,
    })
    .from(schema.projects)
    .where(
      and(
        eq(schema.projects.id, params.projectId),
        eq(schema.projects.userId, params.userId),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) throw new ProjectNotFoundError();
  // Safe to call even when not published — just a no-op.
  if (!row.subdomain) return;

  const sub = row.subdomain;
  await db
    .update(schema.projects)
    .set({
      subdomain: null,
      publishedAt: null,
      publishedHtml: null,
      // Flip published → draft. Archived stays archived (deliberate
      // un-publish of an archived project is rare but should preserve
      // its archived state).
      status: row.status === "published" ? "draft" : row.status,
      deployUrl: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.projects.id, params.projectId));

  // Filesystem cleanup is best-effort. The subdomain is already freed by
  // the DB update above; a stranded dir is harmless because nginx will
  // 404 once nobody re-claims it.
  await unpublishDir(sub).catch(() => {});
}

export async function getSubdomainOwner(
  subdomain: string,
): Promise<{ userId: string; projectId: string } | null> {
  const v = validateSubdomain(subdomain);
  if (!v.ok) return null;
  const rows = await db
    .select({
      userId: schema.projects.userId,
      projectId: schema.projects.id,
    })
    .from(schema.projects)
    .where(eq(schema.projects.subdomain, v.value))
    .limit(1);
  const row = rows[0];
  return row ? { userId: row.userId, projectId: row.projectId } : null;
}

export async function countUserSubdomains(userId: string): Promise<number> {
  const rows = await db
    .select({ count: sqlOp<number>`count(*)::int` })
    .from(schema.projects)
    .where(
      and(
        eq(schema.projects.userId, userId),
        isNotNull(schema.projects.subdomain),
      ),
    );
  return rows[0]?.count ?? 0;
}

// Postgres UNIQUE-violation SQLSTATE. Drizzle surfaces it on err.cause.code
// for neon-http (sometimes err.code directly) — check both shapes.
function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const anyErr = err as { code?: unknown; cause?: { code?: unknown } };
  if (anyErr.code === "23505") return true;
  if (anyErr.cause && (anyErr.cause as { code?: unknown }).code === "23505") {
    return true;
  }
  // neon-http sometimes packs the message as "...code: 23505...".
  const msg = err instanceof Error ? err.message : "";
  return /23505/.test(msg);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
