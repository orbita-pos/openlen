import { createHash } from "node:crypto";
import { and, desc, eq, gte, isNotNull, isNull, ne, sql as sqlOp } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { ProjectData, ProjectSettings, StoredChatTurn } from "@/lib/projects/types";
import { getUserPlan } from "@/lib/limits";
import { subdomainLimitForPlan } from "@/lib/subdomain/limits";
import { validateSubdomain } from "@/lib/subdomain/validate";
import {
  publishToDir,
  unpublishDir,
  rollbackToSha,
  readRelease,
  ReleaseNotFoundError,
} from "@/lib/publish/filesystem";
import { purgeSubdomain } from "@/lib/publish/cache-purge";
import { backupReleaseToR2 } from "@/lib/publish/backup-r2";
import { getDefaultCollection, listItems, type ItemRow } from "@/lib/collections/store";
import { createVersion } from "@/lib/projects/versions";
import { getChatMessages } from "@/lib/projects/chat";
import {
  pageEdgePaths,
  pagesForPublish,
  sitePagesFingerprintInput,
  splitPagesForPublish,
} from "@/lib/projects/site-pages";
import { normalizeBornCanonical } from "@/lib/normalize";
import { ensurePageMeta } from "@/lib/publish/ensure-page-meta";
import { ensureSocialOgImage } from "@/lib/branding/social-image";
import { resolveProjectLogo } from "@/lib/branding/resolve-project-logo";
import { renderProjectThumbnail } from "@/lib/projects/thumbnail";
import { runFlightCheck } from "@/lib/publish/flight-check";
import { localizeForPublish } from "@/lib/publish/localize";
import { detectHtmlLang } from "@/lib/publish/language-cluster";
import { isPublishLocale } from "@/lib/publish/publish-locales";
import { getProfile } from "@/lib/business-profiles/store";

// ─────────────────────────────────────────────────────────────────────────────
// Project persistence helpers.
//
// Kept in a single module so /api/generate, /api/regenerate-section, and the
// listing pages all derive title, tags, and thumbnail the same way. Nothing
// here touches auth — callers must verify ownership before passing a userId.
// ─────────────────────────────────────────────────────────────────────────────

export type ProjectStatus = "draft" | "published" | "archived";

/** Community listing axis (schema.projects.visibility — plain text column,
 *  so DB reads come back as `string`; narrow with asVisibility below).
 *  'private' = not listed anywhere; 'public' = shown in /explore + the
 *  owner's /@handle; 'hidden' = pulled by an admin (owner keeps the
 *  project, it just stops listing — the owner can't toggle back). */
export type ProjectVisibility = "public" | "private" | "hidden";

/** Stable fingerprint of the site pages as they'd publish (slug-sorted,
 *  empty-html pages excluded — mirrors pagesForPublish). "" = zero pages.
 *  Stored as projects.publishedPagesHash at publish; compared at read time
 *  so the "unpublished changes" pill lights on subpage edits too. Members
 *  gating folds in via sitePagesFingerprintInput — byte-identical to the
 *  legacy slug/html stream when nothing is gated, so stored hashes from
 *  pre-members publishes stay valid. */
export function hashSitePages(data: ProjectData | null | undefined): string {
  const parts = sitePagesFingerprintInput(data);
  if (parts.length === 0) return "";
  const h = createHash("sha256");
  for (const part of parts) h.update(part, "utf8");
  return h.digest("hex").slice(0, 16);
}

/** The drift comparison both read paths share: home html byte-diff, plus the
 *  pages fingerprint when the publish recorded one (NULL = legacy publish or
 *  post-rollback — pages are skipped, so old rows can't false-positive). */
function computeUnpublishedChanges(row: {
  subdomain: string | null;
  publishedHtml: string | null;
  publishedPagesHash: string | null;
  data: ProjectData | null;
  currentHtml: string;
}): boolean {
  if (row.subdomain === null || row.publishedHtml === null) return false;
  if (row.publishedHtml !== row.currentHtml) return true;
  if (row.publishedPagesHash === null) return false;
  return hashSitePages(row.data) !== row.publishedPagesHash;
}

export interface ProjectSummary {
  id: string;
  title: string;
  status: ProjectStatus;
  visibility: ProjectVisibility;
  tags: string[];
  deployUrl: string | null;
  thumbnailUrl: string | null;
  /** Per-project favicon / brand mark. Null when the user hasn't set one
   *  and no <link rel="icon"> was auto-extracted from the HTML at publish. */
  logoUrl: string | null;
  subdomain: string | null;
  publishedAt: Date | null;
  hasUnpublishedChanges: boolean;
  sectionCount: number;
  /** The business this page belongs to (FK → businessProfiles). Null only for
   *  legacy pages created before the default-business model. */
  profileId: string | null;
  /** Results-loop stats (visits/clicks/leads in a recent window). Populated by
   *  the /projects + /business pages, not by listProjects itself. */
  stats?: { views: number; clicks: number; leads: number };
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectFull extends ProjectSummary {
  userId: string;
  brief: string;
  /** Per-project AI context surfaced in the Brief sidebar tab. Prepended
   *  to every chat prompt by `/api/templates/ai-design`. */
  userBrief: string | null;
  data: ProjectData;
  /** Persisted Chat-tab transcript — seeds the chat on load. Empty array
   *  when the project has never been chatted (column NULL). */
  chatHistory: StoredChatTurn[];
}

function publishBaseHost(): string {
  return process.env.PUBLISH_BASE_HOST?.trim() || "openlen.com";
}

/** Stitch `subdomain.<base>` into the deploy URL we show in the UI. */
function deployUrlFor(subdomain: string | null): string | null {
  if (!subdomain) return null;
  return `https://${subdomain}.${publishBaseHost()}`;
}

/** Pull the document <title> for the project name. */
function titleFromHtml(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const inner = m?.[1]?.trim();
  return inner && inner.length > 0 ? inner.slice(0, 200) : null;
}

/** Cheap section count for the project-list cards — counts <section> tags. */
function countSections(html: string): number {
  const m = html.match(/<section[\s>]/gi);
  return m ? m.length : 0;
}

function asStatus(raw: string): ProjectStatus {
  if (raw === "published" || raw === "archived" || raw === "draft") return raw;
  return "draft";
}

function asVisibility(raw: string): ProjectVisibility {
  if (raw === "public" || raw === "hidden") return raw;
  return "private";
}

export interface CreateProjectInput {
  /** Publish-ready HTML — the project's source of truth. */
  html: string;
  /** The brief the page was generated from — stored on the `brief` column
   *  for the projects list and the Brief sidebar tab. */
  brief: string;
  /** Explicit project title. Falls back to the HTML <title>, then a brief
   *  snippet. */
  title?: string;
  /** The business this page belongs to (FK → businessProfiles). Pages are
   *  always associated to a business; the caller resolves explicit-or-default. */
  profileId?: string | null;
  /** The brand logo to seed as the project's logo (inspector default / card
   *  badge / OG). Optional — null/omitted leaves it unset. */
  logoUrl?: string | null;
  /** Initial module settings (the AI→módulos bridge sets settings.bookings /
   *  settings.collections when the generated page carries their placeholder). */
  settings?: ProjectSettings;
}

export async function createProject(
  userId: string,
  input: CreateProjectInput,
): Promise<string> {
  const id = crypto.randomUUID();
  const title =
    input.title?.trim() ||
    titleFromHtml(input.html) ||
    input.brief.slice(0, 60).trim() ||
    "Untitled page";
  await db.insert(schema.projects).values({
    id,
    userId,
    title,
    brief: input.brief,
    thumbnailUrl: null,
    tags: [],
    status: "draft",
    profileId: input.profileId ?? null,
    logoUrl: input.logoUrl ?? null,
    data: { html: input.html, ...(input.settings ? { settings: input.settings } : {}) },
  });
  // Render a card thumbnail in the background so the project doesn't show the
  // placeholder icon in /projects. Fire-and-forget: never delays the create
  // response, never fails it. (Paste + template clones render/inherit in their
  // own routes.)
  void renderProjectThumbnail({ projectId: id, html: input.html });
  return id;
}

export async function listProjects(userId: string): Promise<ProjectSummary[]> {
  const rows = await db
    .select({
      id: schema.projects.id,
      title: schema.projects.title,
      status: schema.projects.status,
      visibility: schema.projects.visibility,
      tags: schema.projects.tags,
      deployUrl: schema.projects.deployUrl,
      thumbnailUrl: schema.projects.thumbnailUrl,
      logoUrl: schema.projects.logoUrl,
      profileId: schema.projects.profileId,
      subdomain: schema.projects.subdomain,
      publishedAt: schema.projects.publishedAt,
      publishedHtml: schema.projects.publishedHtml,
      publishedPagesHash: schema.projects.publishedPagesHash,
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
      visibility: asVisibility(row.visibility),
      tags: row.tags,
      deployUrl: derivedDeploy ?? row.deployUrl,
      thumbnailUrl: row.thumbnailUrl,
      logoUrl: row.logoUrl,
      profileId: row.profileId,
      subdomain: row.subdomain,
      publishedAt: row.publishedAt,
      hasUnpublishedChanges: computeUnpublishedChanges({ ...row, currentHtml }),
      sectionCount: countSections(currentHtml),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  });
}

export interface ProfilePageSummary {
  id: string;
  title: string;
  status: ProjectStatus;
  thumbnailUrl: string | null;
  subdomain: string | null;
  updatedAt: Date;
}

// The pages belonging to one business — powers the "Tus páginas" list on the
// /business page. Lightweight (no HTML) and ownership-scoped.
export async function listProjectsForProfile(
  userId: string,
  profileId: string,
): Promise<ProfilePageSummary[]> {
  const rows = await db
    .select({
      id: schema.projects.id,
      title: schema.projects.title,
      status: schema.projects.status,
      thumbnailUrl: schema.projects.thumbnailUrl,
      subdomain: schema.projects.subdomain,
      updatedAt: schema.projects.updatedAt,
    })
    .from(schema.projects)
    .where(
      and(
        eq(schema.projects.userId, userId),
        eq(schema.projects.profileId, profileId),
      ),
    )
    .orderBy(desc(schema.projects.updatedAt))
    .limit(100);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    status: asStatus(r.status),
    thumbnailUrl: r.thumbnailUrl,
    subdomain: r.subdomain,
    updatedAt: r.updatedAt,
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
  const chatHistory = await getChatMessages(projectId);
  const derivedDeploy = deployUrlFor(row.subdomain);
  // Normalize on load — runs the born-canonical chain so legacy / pre-
  // normalizer projects expose the Theme picker contract just like new ones,
  // then completes the <head> so the Page Health panel reads green even for
  // projects created before auto-meta existed. Idempotent: already-complete
  // projects get a near-no-op pass.
  const rawHtml = row.data?.html ?? "";
  const currentHtml = rawHtml
    ? ensurePageMeta(normalizeBornCanonical(rawHtml), { title: row.title })
    : "";
  const data: ProjectData =
    row.data && currentHtml !== rawHtml
      ? { ...row.data, html: currentHtml }
      : row.data;
  return {
    id: row.id,
    userId: row.userId,
    title: row.title,
    status: asStatus(row.status),
    visibility: asVisibility(row.visibility),
    tags: row.tags,
    deployUrl: derivedDeploy ?? row.deployUrl,
    brief: row.brief,
    userBrief: row.userBrief ?? null,
    thumbnailUrl: row.thumbnailUrl,
    logoUrl: row.logoUrl,
    profileId: row.profileId,
    subdomain: row.subdomain,
    publishedAt: row.publishedAt,
    hasUnpublishedChanges: computeUnpublishedChanges({ ...row, currentHtml }),
    sectionCount: countSections(currentHtml),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    data,
    chatHistory,
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

// Move a project to another business (or clear with null). Returns
// "invalid_profile" if the target business isn't the user's, false if the
// project isn't theirs, true on success. Seed-only: this only re-links the
// page — it does NOT re-apply the business's info to the existing HTML.
export async function setProjectProfileId(
  projectId: string,
  userId: string,
  profileId: string | null,
): Promise<boolean | "invalid_profile"> {
  if (profileId) {
    const owned = await getProfile(userId, profileId);
    if (!owned) return "invalid_profile";
  }
  const result = await db
    .update(schema.projects)
    .set({ profileId, updatedAt: new Date() })
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

const USER_BRIEF_MAX = 4000;
const LOGO_URL_MAX = 2000;

/** Persist the per-project logo URL. Pass null to clear it.
 *  Acceptable: an absolute http(s) URL (uploaded asset, paste-URL, default
 *  data URL) — validation is the caller's responsibility. */
export async function setProjectLogoUrl(
  projectId: string,
  userId: string,
  logoUrl: string | null,
): Promise<boolean> {
  const value =
    logoUrl === null
      ? null
      : logoUrl.length > LOGO_URL_MAX
        ? logoUrl.slice(0, LOGO_URL_MAX)
        : logoUrl;
  const result = await db
    .update(schema.projects)
    .set({ logoUrl: value, updatedAt: new Date() })
    .where(
      and(
        eq(schema.projects.id, projectId),
        eq(schema.projects.userId, userId),
      ),
    )
    .returning({ id: schema.projects.id });
  return result.length > 0;
}

/** Persist the user-controlled project brief — the text that gets injected
 *  into every Chat tab prompt. Empty string clears it (stored as NULL). */
export async function setProjectUserBrief(
  projectId: string,
  userId: string,
  rawBrief: string,
): Promise<boolean> {
  const trimmed = rawBrief.slice(0, USER_BRIEF_MAX);
  const value = trimmed.trim().length === 0 ? null : trimmed;
  const result = await db
    .update(schema.projects)
    .set({ userBrief: value, updatedAt: new Date() })
    .where(
      and(
        eq(schema.projects.id, projectId),
        eq(schema.projects.userId, userId),
      ),
    )
    .returning({ id: schema.projects.id });
  return result.length > 0;
}

/** Merge a patch into data.settings.assistant (read-modify-write). Returns the
 *  new assistant settings, or null when the project isn't the user's. */
export async function setProjectAssistant(
  projectId: string,
  userId: string,
  patch: { enabled?: boolean; facts?: string; tone?: string },
): Promise<{ enabled: boolean; facts: string; tone?: string } | null> {
  const rows = await db
    .select({ data: schema.projects.data })
    .from(schema.projects)
    .where(
      and(
        eq(schema.projects.id, projectId),
        eq(schema.projects.userId, userId),
      ),
    )
    .limit(1);
  const data = rows[0]?.data;
  if (!data) return null;

  const settings = data.settings ?? {};
  const current = settings.assistant ?? {};
  const next = {
    enabled: patch.enabled ?? current.enabled ?? false,
    facts:
      patch.facts !== undefined
        ? patch.facts.slice(0, 4000)
        : (current.facts ?? ""),
    ...(patch.tone !== undefined
      ? { tone: patch.tone.slice(0, 80) || undefined }
      : current.tone
        ? { tone: current.tone }
        : {}),
  };

  const result = await db
    .update(schema.projects)
    .set({
      data: { ...data, settings: { ...settings, assistant: next } },
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.projects.id, projectId),
        eq(schema.projects.userId, userId),
      ),
    )
    .returning({ id: schema.projects.id });
  return result.length > 0 ? next : null;
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
    profileId: existing.profileId,
    data: existing.data,
  });
  return id;
}

// Re-home a user's orphaned pages (profileId NULL — e.g. after their business
// was deleted) onto a business, so every page keeps an association.
export async function reassignNullProjects(
  userId: string,
  toProfileId: string,
): Promise<void> {
  await db
    .update(schema.projects)
    .set({ profileId: toProfileId, updatedAt: new Date() })
    .where(
      and(
        eq(schema.projects.userId, userId),
        isNull(schema.projects.profileId),
      ),
    );
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
  /** Speak Every Language targets. When provided, persisted to
   *  data.settings.languages for future republishes; when absent, the
   *  stored setting drives this publish. */
  languages?: string[];
  /** Skip the post-publish Lighthouse flight check. Default false (normal
   *  Deploy runs it). Bulk republishes set this so a catalog-wide sweep
   *  doesn't queue N Chrome audits against the box's single flight-check slot. */
  skipFlightCheck?: boolean;
  /** System-only: skip the per-plan subdomain cap. Set ONLY by the Explore
   *  seed (lib/community/seed.ts) for the first-party @openlen showcase
   *  account, which legitimately owns more subdomains than any real tier
   *  allows. Never wired into the public publish route body. */
  bypassSubdomainLimit?: boolean;
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
      title: schema.projects.title,
      data: schema.projects.data,
      subdomain: schema.projects.subdomain,
      logoUrl: schema.projects.logoUrl,
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
  if (isClaimingNew && !params.bypassSubdomainLimit) {
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

  // Born-complete the <head> at publish too, so even legacy projects (and
  // pages published without ever opening the editor) ship with a real meta
  // description / og tags / favicon. Then resolve a RASTER og:image (the page's
  // hero, or a rendered branded card) so the link unfurls on WhatsApp / X /
  // Facebook — and fill twitter:image / og:image dims / og:url. Both soft: a
  // hiccup must never block a publish.
  let html = ensurePageMeta(project.data?.html ?? "", { title: project.title });
  try {
    const baseUrl = `https://${v.value}.${process.env.PUBLISH_BASE_HOST?.trim() || "openlen.com"}`;
    html = await ensureSocialOgImage(html, { title: project.title, baseUrl });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[publish] social og:image failed; continuing", err);
  }
  const now = new Date();

  // Speak Every Language: which locales to publish alongside the root doc.
  // An explicit param wins (and is persisted below); otherwise the stored
  // project setting drives the republish.
  const settings = project.data?.settings ?? {};
  const sourceLang = detectHtmlLang(html) ?? "en";
  const targets = (params.languages ?? settings.languages ?? []).filter(
    (code) => isPublishLocale(code) && code !== sourceLang,
  );
  const persistLanguages = params.languages !== undefined;

  // 4. DB upsert — claim the subdomain. We do this BEFORE the filesystem
  // write so a UNIQUE collision short-circuits without leaving an orphan
  // directory. On FS failure below we roll back.
  const previousSubdomain = project.subdomain;
  const previousPublished = await db
    .select({
      publishedAt: schema.projects.publishedAt,
      publishedHtml: schema.projects.publishedHtml,
      publishedPagesHash: schema.projects.publishedPagesHash,
      publishedReleaseSha: schema.projects.publishedReleaseSha,
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
        publishedPagesHash: hashSitePages(project.data),
        status: "published",
        deployUrl: `${v.value}.${publishBaseHost()}`,
        updatedAt: now,
        ...(persistLanguages && project.data
          ? {
              data: {
                ...project.data,
                settings: { ...settings, languages: targets },
              },
            }
          : {}),
      })
      .where(eq(schema.projects.id, params.projectId));
  } catch (err) {
    if (isUniqueViolation(err)) throw new SubdomainTakenError();
    throw err;
  }

  // 5. Filesystem write. On failure, undo the DB row so the user can
  // try again (or pick a different subdomain) without the row claiming
  // a sub they didn't actually publish.
  //
  // Failure modes we recover from here:
  //   - publishToDir creates `<sub>/releases/` via mkdir BEFORE the
  //     HTML pipeline runs (Tailwind bake, asset migration). If any of
  //     those throw, we end up with an empty `<sub>/` dir on disk +
  //     potentially the subdomain claimed in DB. Both are leaks.
  //   - The Caddy wildcard would serve a stale `current/` symlink (from
  //     a prior publish of the same sub) even after our DB rollback,
  //     so the dir cleanup must run as well.
  // Resolve effective logo URL: explicit DB value wins, else auto-extract
  // from the HTML at publish time. Failures soft-fail to no logo injection.
  let effectiveLogoUrl: string | null = project.logoUrl;
  try {
    effectiveLogoUrl = await resolveProjectLogo({
      projectId: params.projectId,
      userId: params.userId,
      currentLogoUrl: project.logoUrl,
      html,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[publish] logo resolution failed; publishing without it", err);
    effectiveLogoUrl = project.logoUrl;
  }

  // Members module: gated pages leave the public release (a login stub takes
  // their path) and publish into the protected store instead. With the module
  // off, gatedPages is empty and everything ships public as always.
  const { publicPages, gatedPages } = splitPagesForPublish(project.data);

  // Preset «Cuentas»: auto-created «Mi cuenta» area — /cuenta publishes even
  // without a gated page, as long as the module is on and the preset is set.
  const members = project.data?.settings?.members;
  const accountArea =
    members?.enabled === true &&
    members?.accountArea === true &&
    members?.passwordLogin === true; // — requires passwordLogin (the Cuentas preset couples them); without it register/login/set-password 404 and the /cuenta card would be a dead end.

  // Members sign-in: the account area wins when on — /cuenta is the account
  // home even without a gated page. Otherwise, when a gated portal exists,
  // every public doc links to it (canonical members page, else first gated
  // slug). splitPagesForPublish only yields gatedPages when the module is
  // on, so a non-empty list already means "show the sign-in".
  const memberSigninPath = accountArea
    ? "cuenta"
    : gatedPages.length > 0
      ? (gatedPages.find((p) => p.slug === "miembros" || p.slug === "members")
          ?.slug ?? gatedPages[0].slug)
      : undefined;

  // Collections module: read the published items + layout at publish time so
  // the bake renders them as STATIC HTML (no runtime API). Off → undefined.
  let collectionsBake:
    | { enabled: true; items: ItemRow[]; layout: "grid" | "list" }
    | undefined;
  if (project.data?.settings?.collections?.enabled) {
    const col = await getDefaultCollection(params.projectId);
    if (col) {
      collectionsBake = {
        enabled: true,
        items: await listItems(params.projectId, col.id, { includeArchived: false }),
        layout: col.layout,
      };
    }
  }

  let publishResult: {
    sha: string;
    html: string;
    written: boolean;
    locales: string[];
  };
  try {
    publishResult = await publishToDir({
      subdomain: v.value,
      html,
      projectId: params.projectId,
      formConfigs: project.data?.settings?.forms,
      analyticsEnabled: !project.data?.settings?.analyticsDisabled,
      logoUrl: effectiveLogoUrl,
      motion: project.data?.settings?.motion,
      music: project.data?.settings?.music,
      assistant: project.data?.settings?.assistant?.enabled
        ? { enabled: true, businessName: project.title || v.value }
        : undefined,
      comments: project.data?.settings?.comments?.enabled
        ? { enabled: true }
        : undefined,
      bookings: project.data?.settings?.bookings?.enabled
        ? { enabled: true }
        : undefined,
      collections: collectionsBake,
      scene3d: project.data?.settings?.scene3d?.enabled
        ? { enabled: true, spec: project.data.settings.scene3d.spec }
        : undefined,
      whatsapp: project.data?.settings?.whatsapp?.enabled
        ? project.data.settings.whatsapp
        : undefined,
      chat: project.data?.settings?.chat?.enabled
        ? {
            enabled: true,
            mount: project.data.settings.chat.mount ?? "both",
            selfServeJoin: project.data.settings.chat.selfServeJoin !== false,
            title: project.title,
            identityMode: project.data?.settings?.chat?.identityMode,
            welcome: project.data?.settings?.chat?.welcome,
            quickReplies: project.data?.settings?.chat?.quickReplies,
            theme: project.data?.settings?.chat?.theme,
          }
        : undefined,
      pages: publicPages,
      gatedPages: gatedPages.length > 0 ? gatedPages : undefined,
      memberSigninPath,
      memberSigninIsAccount: accountArea || undefined,
      memberGate:
        gatedPages.length > 0 || accountArea
          ? {
              projectTitle: project.title || v.value,
              logoUrl: effectiveLogoUrl,
              passwordLogin: members?.passwordLogin === true,
            }
          : undefined,
      accountArea: accountArea || undefined,
      sourceLang,
      buildLocaleDocs:
        targets.length > 0
          ? (finalHtml) =>
              localizeForPublish({
                projectId: params.projectId,
                html: finalHtml,
                targets,
                sourceLang,
              })
          : undefined,
    });
  } catch (err) {
    // Roll back DB. We loudly log rollback failures instead of silently
    // swallowing — silent rollback failures are exactly how production
    // ends up with phantom subdomains (DB claims live, disk has nothing).
    try {
      await db
        .update(schema.projects)
        .set({
          subdomain: previousSubdomain,
          publishedAt: prev?.publishedAt ?? null,
          publishedHtml: prev?.publishedHtml ?? null,
          publishedPagesHash: prev?.publishedPagesHash ?? null,
          publishedReleaseSha: prev?.publishedReleaseSha ?? null,
          status: prev?.status ?? "draft",
          deployUrl: previousSubdomain
            ? `${previousSubdomain}.${publishBaseHost()}`
            : null,
          updatedAt: now,
        })
        .where(eq(schema.projects.id, params.projectId));
    } catch (rollbackErr) {
      // eslint-disable-next-line no-console
      console.error(
        "[publish] CRITICAL: rollback failed for project",
        params.projectId,
        "subdomain may be stuck at",
        v.value,
        rollbackErr,
      );
    }
    // Clean up the orphan dir we just created on disk (if any).
    // Only do this when CLAIMING NEW — never blow away a previously-
    // published sub's dir on a rename-failure case.
    if (isClaimingNew) {
      try {
        await unpublishDir(v.value);
      } catch (cleanupErr) {
        // eslint-disable-next-line no-console
        console.warn(
          "[publish] could not clean up orphan dir after failure",
          v.value,
          cleanupErr,
        );
      }
    }
    throw err;
  }

  // 5b. Persist the release sha so the rollback UI knows which entry is
  // currently live. The first UPDATE above happens before publishToDir
  // because we need to claim the subdomain in DB before writing the
  // filesystem; this second UPDATE happens after publishToDir succeeds.
  await db
    .update(schema.projects)
    .set({ publishedReleaseSha: publishResult.sha, updatedAt: now })
    .where(eq(schema.projects.id, params.projectId))
    .catch((err) => {
      // The release is live on disk; missing the SHA in DB just means the
      // "Previous deploys" UI won't highlight which is current. Soft-fail.
      // eslint-disable-next-line no-console
      console.error("[publish] failed to persist publishedReleaseSha", err);
    });

  // 5c. Fire-and-forget R2 backup of the release HTML. The nightly rclone
  // sync is the durability backstop; this gives us a lower-RPO copy that
  // lands in cloud storage seconds after the publish. Soft-fails if R2
  // env vars are unset or the upload errors — neither blocks the publish.
  if (publishResult.written) {
    void backupReleaseToR2(v.value, publishResult.sha, publishResult.html);
  }

  // 6. If the project's subdomain changed (rename), clean up the old dir AND
  // purge the old subdomain at the edge (home + every subpage) — else CF keeps
  // serving the project at its previous address after a rename.
  if (previousSubdomain && previousSubdomain !== v.value) {
    await unpublishDir(previousSubdomain).catch(() => {});
    await purgeSubdomain(previousSubdomain, pageEdgePaths(project.data)).catch(() => {});
  }

  // 7. Snapshot the published HTML into the version history so the user
  // has a permanent "this is what's live right now" marker — one snapshot
  // per document (home + each site page, in its own scope). createVersion
  // dedups within the scope, so pages unchanged since their last snapshot
  // cost nothing. Soft-fail — the publish itself is already done.
  const publishLabel = `Published to ${v.value}.${publishBaseHost()}`;
  await createVersion({
    projectId: params.projectId,
    html,
    label: publishLabel,
    source: "publish",
  }).catch((err) => {
    // eslint-disable-next-line no-console
    console.error("[publish] version snapshot failed", err);
  });
  for (const pg of pagesForPublish(project.data)) {
    await createVersion({
      projectId: params.projectId,
      html: pg.html,
      label: publishLabel,
      source: "publish",
      page: pg.slug,
    }).catch((err) => {
      // eslint-disable-next-line no-console
      console.error("[publish] page version snapshot failed", pg.slug, err);
    });
  }

  // 8. Purge the Cloudflare edge cache so the next visitor sees the
  // new HTML instead of the previous deploy. Soft-fails when CF env
  // vars aren't set or the API call errors — stale edge content will
  // flush within `s-maxage` anyway. Locale variants, site pages (CF
  // caches /pricing and /pricing/ as distinct URLs — purge both) and
  // the sitemap purge too.
  await purgeSubdomain(v.value, [
    ...publishResult.locales.map((l) => `/${l}/`),
    ...pageEdgePaths(project.data),
    "/sitemap.xml",
  ]);

  // 9. Refresh the card thumbnail from the just-published bytes. Fire-and-
  // forget + soft-fail (same posture as the R2 backup above) — the publish is
  // already done; a stale or missing thumbnail must never block it.
  void renderProjectThumbnail({ projectId: params.projectId, html });

  // 10. Flight Check: Lighthouse the release artifact and persist the lab
  // report (the publish modal's Speed Card polls it). Fire-and-forget,
  // serialized to one Chrome at a time, idempotent per (project, sha). Skipped
  // on bulk republishes so a catalog-wide sweep doesn't queue N Chrome audits.
  if (!params.skipFlightCheck) {
    void runFlightCheck({
      projectId: params.projectId,
      subdomain: v.value,
      releaseSha: publishResult.sha,
    });
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
      data: schema.projects.data,
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
  const subpagePaths = pageEdgePaths(row.data);
  await db
    .update(schema.projects)
    .set({
      subdomain: null,
      publishedAt: null,
      publishedHtml: null,
      publishedPagesHash: null,
      publishedReleaseSha: null,
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

  // Purge the edge cache so visitors get a 404 immediately instead of
  // a stale HIT for up to `s-maxage` — home AND every subpage (else a
  // taken-down subpage keeps serving its old content at the edge).
  await purgeSubdomain(sub, subpagePaths);
}

// ─────────────────────────────────────────────────────────────────────────────
// Rollback — flip the live `current` symlink to a prior release.
//
// Does NOT regenerate HTML or run the orchestrator. The release dir already
// holds the optimized HTML from when it was first published; we just point
// the symlink at it and purge CF. publishedHtml + publishedReleaseSha are
// re-synced to the rolled-back content so the UI's drift detection stays
// accurate.
// ─────────────────────────────────────────────────────────────────────────────

export class ReleaseUnavailableError extends Error {
  constructor() {
    super("release unavailable");
    this.name = "ReleaseUnavailableError";
  }
}

interface RollbackParams {
  projectId: string;
  userId: string;
  sha: string;
}
interface RollbackResult {
  sha: string;
  url: string;
  publishedAt: Date;
}

export async function rollbackProject(
  params: RollbackParams,
): Promise<RollbackResult> {
  const rows = await db
    .select({
      id: schema.projects.id,
      subdomain: schema.projects.subdomain,
      data: schema.projects.data,
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
  if (!row.subdomain) throw new ReleaseUnavailableError();

  let html: string;
  try {
    html = await readRelease(row.subdomain, params.sha);
  } catch (err) {
    if (err instanceof ReleaseNotFoundError) throw new ReleaseUnavailableError();
    throw err;
  }

  try {
    await rollbackToSha(row.subdomain, params.sha);
  } catch (err) {
    if (err instanceof ReleaseNotFoundError) throw new ReleaseUnavailableError();
    throw err;
  }

  const now = new Date();
  await db
    .update(schema.projects)
    .set({
      publishedAt: now,
      publishedHtml: html,
      // The rolled-back release's page set isn't recorded anywhere, so the
      // live pages are unknown — NULL makes the drift pill skip pages until
      // the next real publish records a fresh fingerprint.
      publishedPagesHash: null,
      publishedReleaseSha: params.sha,
      updatedAt: now,
    })
    .where(eq(schema.projects.id, params.projectId));

  await createVersion({
    projectId: params.projectId,
    html,
    label: `Rolled back to ${params.sha}`,
    source: "publish",
  }).catch((err) => {
    // eslint-disable-next-line no-console
    console.error("[rollback] version snapshot failed", err);
  });

  // Purge home AND every subpage — else a rollback leaves subpages serving the
  // pre-rollback (wrong) content while only home flips, an inconsistent site.
  await purgeSubdomain(row.subdomain, pageEdgePaths(row.data));

  return {
    sha: params.sha,
    url: `https://${row.subdomain}.${publishBaseHost()}`,
    publishedAt: now,
  };
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

/** Count of projects created within the last `days` days. Powers the
 *  "pages generated this week" stat on the marketing hero. */
export async function countProjectsSince(days: number): Promise<number> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ count: sqlOp<number>`count(*)::int` })
    .from(schema.projects)
    .where(gte(schema.projects.createdAt, since));
  return rows[0]?.count ?? 0;
}

// Postgres UNIQUE-violation SQLSTATE. node-postgres surfaces it cleanly on
// err.code; keep the err.cause.code + message checks as defensive fallbacks.
function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const anyErr = err as { code?: unknown; cause?: { code?: unknown } };
  if (anyErr.code === "23505") return true;
  if (anyErr.cause && (anyErr.cause as { code?: unknown }).code === "23505") {
    return true;
  }
  // Last-resort: some drivers pack the code into the message string.
  const msg = err instanceof Error ? err.message : "";
  return /23505/.test(msg);
}
