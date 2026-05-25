// One-shot — republish every already-live page with the analytics snippet
// baked into its HTML. The pages were originally published before the
// snippet-inject code was deployed, so they're missing the tracker. This
// script reads project.publishedHtml from the DB (the post-pipeline HTML
// that nginx is currently serving), inserts the snippet, ships a new
// release dir, atomically flips the `current` symlink, and updates the
// DB's publishedHtml + publishedReleaseSha to keep things in lockstep.
//
// Idempotent: safe to re-run. The snippet is injected once (or replaced
// if the projectId-stamped marker is already there). If the new HTML
// happens to hash identical to what's currently live, the release dir is
// reused — same dedupe behaviour as publishToDir.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import { and, eq, isNotNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { injectAnalyticsSnippet } from "@/lib/analytics/snippet";

const BOX = process.env.OPENLEN_BOX_IP ?? "178.156.175.171";
const ADMIN_KEY =
  process.env.OPENLEN_ADMIN_KEY_PATH ??
  path.join(homedir(), ".ssh", "openlen-admin");
const PUBLISH_ROOT = "/var/www/openlen";
const SNIPPET_MARKER_RE = /<script>\(function\(\)\{[\s\S]*?var P="/;

interface Project {
  id: string;
  subdomain: string;
  publishedHtml: string;
}

function computeSha(html: string): string {
  return createHash("sha256")
    .update(html, "utf8")
    .digest("hex")
    .slice(0, 12);
}

function alreadyInjected(html: string): boolean {
  return SNIPPET_MARKER_RE.test(html);
}

function shipAndSwap(sub: string, sha: string, html: string): void {
  // One round-trip: stage release dir, pipe HTML to its index.html,
  // atomic symlink flip. `mv -Tf` is GNU-specific (Ubuntu box, fine).
  const remoteCmd = [
    "set -e",
    `mkdir -p ${PUBLISH_ROOT}/${sub}/releases/${sha}`,
    `cat > ${PUBLISH_ROOT}/${sub}/releases/${sha}/index.html`,
    `ln -sfn releases/${sha} ${PUBLISH_ROOT}/${sub}/current.new`,
    `mv -Tf ${PUBLISH_ROOT}/${sub}/current.new ${PUBLISH_ROOT}/${sub}/current`,
  ].join(" && ");

  const result = spawnSync(
    "ssh",
    [
      "-i",
      ADMIN_KEY,
      "-o",
      "StrictHostKeyChecking=accept-new",
      `root@${BOX}`,
      remoteCmd,
    ],
    { input: html, encoding: "utf8" },
  );

  if (result.status !== 0) {
    throw new Error(
      `ssh failed for ${sub}: exit ${result.status}\nstderr:\n${result.stderr}`,
    );
  }
}

async function republishOne(p: Project): Promise<void> {
  // Inject only if missing — re-running this script must not double-inject.
  const targetHtml = alreadyInjected(p.publishedHtml)
    ? p.publishedHtml
    : injectAnalyticsSnippet(p.publishedHtml, p.id);

  const newSha = computeSha(targetHtml);

  shipAndSwap(p.subdomain, newSha, targetHtml);

  await db
    .update(schema.projects)
    .set({
      publishedReleaseSha: newSha,
      publishedHtml: targetHtml,
      updatedAt: new Date(),
    })
    .where(eq(schema.projects.id, p.id));

  const status = alreadyInjected(p.publishedHtml) ? "already had snippet" : "snippet injected";
  // eslint-disable-next-line no-console
  console.log(`✓ ${p.subdomain.padEnd(28)} sha ${newSha}  (${status})`);
}

async function main(): Promise<void> {
  const rows = await db
    .select({
      id: schema.projects.id,
      subdomain: schema.projects.subdomain,
      publishedHtml: schema.projects.publishedHtml,
    })
    .from(schema.projects)
    .where(
      and(
        isNotNull(schema.projects.subdomain),
        isNotNull(schema.projects.publishedHtml),
      ),
    );

  // eslint-disable-next-line no-console
  console.log(
    `Republishing ${rows.length} live pages with analytics snippet…\n`,
  );

  for (const row of rows) {
    if (!row.subdomain || !row.publishedHtml) continue;
    try {
      await republishOne(row as Project);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`✗ ${row.subdomain}:`, err instanceof Error ? err.message : err);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("FAILED:", err);
    process.exit(1);
  });
