import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { optimizeHtmlForProduction } from "@/lib/publish/optimize-html";
import { injectTrackingStrip } from "@/lib/publish/tracking-strip";
import { splitPagesForPublish } from "@/lib/projects/site-pages";
import type { ProjectData } from "@/lib/projects/types";
import { encryptToken } from "./crypto";
import { ProviderError, type Provider } from "./oauth";
import { deployToVercel } from "./vercel";
import { deployToGitHub } from "./github";

// ─────────────────────────────────────────────────────────────────────────────
// Server-side data layer for external-deploy connections + the deploy dispatch.
// Token columns are stored encrypted; the decrypted token never leaves the
// server boundary (drivers receive it, the client never does).
// ─────────────────────────────────────────────────────────────────────────────

export { ProviderError };
export type { Provider };

type ConnectionRow = typeof schema.userConnections.$inferSelect;
type DeploymentRow = typeof schema.projectDeployments.$inferSelect;

export async function getConnection(
  userId: string,
  provider: Provider,
): Promise<ConnectionRow | null> {
  const rows = await db
    .select()
    .from(schema.userConnections)
    .where(
      and(
        eq(schema.userConnections.userId, userId),
        eq(schema.userConnections.provider, provider),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function upsertConnection(params: {
  userId: string;
  provider: Provider;
  accessToken: string;
  refreshToken: string | null;
  accountLabel: string | null;
  teamId: string | null;
  scope: string | null;
}): Promise<void> {
  const existing = await getConnection(params.userId, params.provider);
  const accessToken = encryptToken(params.accessToken);
  const refreshToken = params.refreshToken
    ? encryptToken(params.refreshToken)
    : null;
  if (existing) {
    await db
      .update(schema.userConnections)
      .set({
        accessToken,
        refreshToken,
        accountLabel: params.accountLabel,
        teamId: params.teamId,
        scope: params.scope,
        updatedAt: new Date(),
      })
      .where(eq(schema.userConnections.id, existing.id));
    return;
  }
  await db.insert(schema.userConnections).values({
    userId: params.userId,
    provider: params.provider,
    accessToken,
    refreshToken,
    accountLabel: params.accountLabel,
    teamId: params.teamId,
    scope: params.scope,
  });
}

export async function deleteConnection(
  userId: string,
  provider: Provider,
): Promise<void> {
  await db
    .delete(schema.userConnections)
    .where(
      and(
        eq(schema.userConnections.userId, userId),
        eq(schema.userConnections.provider, provider),
      ),
    );
}

export async function getDeployment(
  projectId: string,
  provider: Provider,
): Promise<DeploymentRow | null> {
  const rows = await db
    .select()
    .from(schema.projectDeployments)
    .where(
      and(
        eq(schema.projectDeployments.projectId, projectId),
        eq(schema.projectDeployments.provider, provider),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function recordDeployment(params: {
  projectId: string;
  provider: Provider;
  remoteName: string;
  liveUrl: string;
  sha: string;
}): Promise<void> {
  const existing = await getDeployment(params.projectId, params.provider);
  if (existing) {
    await db
      .update(schema.projectDeployments)
      .set({
        remoteName: params.remoteName,
        liveUrl: params.liveUrl,
        lastDeployedAt: new Date(),
        lastDeploySha: params.sha,
        updatedAt: new Date(),
      })
      .where(eq(schema.projectDeployments.id, existing.id));
    return;
  }
  await db.insert(schema.projectDeployments).values({
    projectId: params.projectId,
    provider: params.provider,
    remoteName: params.remoteName,
    liveUrl: params.liveUrl,
    lastDeployedAt: new Date(),
    lastDeploySha: params.sha,
  });
}

export interface ExportHtml {
  html: string;
  /** Site pages beyond home, optimized — exported as <slug>/index.html. */
  pages: Array<{ slug: string; html: string }>;
  /** First 12 chars of sha256 over EVERY document (home + pages) — drift
   *  detection. With zero pages this equals the old home-only hash, so
   *  existing single-page deployments don't flash a spurious "changed". */
  sha: string;
  title: string;
}

// Read the project's documents (home + site pages), optimize each for
// production (the same pass publishToDir uses), and return them with a
// content sha. Deliberately skips the openlen.com-specific
// disk/forms/analytics steps — an external export is a self-contained static
// snapshot. Returns null when the project doesn't exist or isn't owned by
// `userId`.
export async function getExportHtml(
  projectId: string,
  userId: string,
): Promise<ExportHtml | null> {
  const rows = await db
    .select({
      data: schema.projects.data,
      title: schema.projects.title,
      userId: schema.projects.userId,
    })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .limit(1);
  const row = rows[0];
  if (!row || row.userId !== userId) return null;
  const data = row.data as ProjectData;
  // URL self-cleaner is host-agnostic (Vercel / GitHub Pages get ?fbclid too),
  // so it's baked into the export. No seal/CSP on external hosts, so the plain
  // inline script just runs. Injected before hashing so the drift sha matches
  // the bytes actually deployed.
  const optimizedHtml = injectTrackingStrip(
    (await optimizeHtmlForProduction(data?.html ?? "")).html,
  );
  // External hosts (GitHub Pages / Vercel) have no member gate — exporting a
  // gated page there would publish it wide open. Public pages only.
  const pages = await Promise.all(
    splitPagesForPublish(data).publicPages.map(async (pg) => ({
      slug: pg.slug,
      html: injectTrackingStrip((await optimizeHtmlForProduction(pg.html)).html),
    })),
  );
  const hash = createHash("sha256").update(optimizedHtml, "utf8");
  for (const pg of pages) {
    hash.update(`\u0000${pg.slug}\u0000`, "utf8").update(pg.html, "utf8");
  }
  const sha = hash.digest("hex").slice(0, 12);
  return { html: optimizedHtml, pages, sha, title: row.title };
}

// Dispatch a deploy to the right provider driver. Home ships as index.html,
// each site page as <slug>/index.html — both hosts serve /<slug> from that.
export async function runDeploy(params: {
  provider: Provider;
  accessToken: string;
  teamId: string | null;
  name: string;
  html: string;
  pages?: Array<{ slug: string; html: string }>;
}): Promise<{ liveUrl: string; remoteName: string }> {
  const files = [
    { path: "index.html", content: params.html },
    ...(params.pages ?? []).map((pg) => ({
      path: `${pg.slug}/index.html`,
      content: pg.html,
    })),
  ];
  if (params.provider === "vercel") {
    return deployToVercel(params.accessToken, params.teamId, params.name, files);
  }
  return deployToGitHub(params.accessToken, params.name, files);
}

// Slugify a project title into a default repo / Vercel project name:
// lowercase, hyphen-separated, no leading/trailing hyphen, 1–39 chars.
// Matches the route's NAME_RE validator.
export function slugifyName(input: string): string {
  const slug = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 39)
    .replace(/-+$/g, "");
  return slug || "openlen-page";
}
