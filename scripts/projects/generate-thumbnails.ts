// Backfill card thumbnails for existing user projects.
//
// New projects render a thumbnail at create time (and refresh on publish) via
// lib/projects/thumbnail.ts. This script fills in every project created BEFORE
// that pipeline existed — the ones that show a placeholder icon in /projects.
//
//   npm run projects:thumbnails            # only projects missing a thumbnail
//   npm run projects:thumbnails -- --force # re-render every project
//   npm run projects:thumbnails -- --user=<userId>   # scope to one owner
//
// Render path matches the runtime: page.setContent(data.html) → AVIF → upload
// → projects.thumbnailUrl. Concurrency is capped inside renderProjectThumbnail
// (the shared module), so firing them all at once is safe.
//
// Runs on the box (full env: DATABASE_URL, R2_*, PUPPETEER_EXECUTABLE_PATH) or
// locally (Neon DB + bundled Chrome + ./public/uploads FS fallback) — anywhere
// the machine has internet egress for the page's Tailwind CDN / fonts.

import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { renderProjectThumbnail } from "@/lib/projects/thumbnail";

interface Row {
  id: string;
  title: string;
  data: { html?: string } | null;
}

async function listTargets(force: boolean, userId?: string): Promise<Row[]> {
  const filters = [];
  if (!force) filters.push(isNull(schema.projects.thumbnailUrl));
  if (userId) filters.push(eq(schema.projects.userId, userId));

  const rows = await db
    .select({
      id: schema.projects.id,
      title: schema.projects.title,
      data: schema.projects.data,
    })
    .from(schema.projects)
    .where(filters.length ? and(...filters) : undefined);

  // Skip projects with no HTML to render.
  return rows.filter((r) => Boolean(r.data?.html?.trim())) as Row[];
}

function parseArg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

async function main(): Promise<void> {
  const force = process.argv.includes("--force");
  const userId = parseArg("user");
  const targets = await listTargets(force, userId);

  if (targets.length === 0) {
    // eslint-disable-next-line no-console
    console.log("No projects need thumbnails. Nothing to do.");
    return;
  }
  // eslint-disable-next-line no-console
  console.log(`Rendering thumbnails for ${targets.length} project(s)…\n`);

  const t0 = Date.now();
  let ok = 0;
  const failed: string[] = [];

  // renderProjectThumbnail caps real concurrency internally; mapping over all
  // targets just queues them. Each settles to a URL (ok) or null (failed).
  await Promise.all(
    targets.map(async (row) => {
      const started = Date.now();
      const url = await renderProjectThumbnail({
        projectId: row.id,
        html: row.data!.html!,
      });
      const ms = Date.now() - started;
      if (url) {
        ok++;
        // eslint-disable-next-line no-console
        console.log(`  ✓ ${row.id}  ${row.title.slice(0, 32).padEnd(32)} ${ms}ms`);
      } else {
        failed.push(row.id);
        // eslint-disable-next-line no-console
        console.log(`  ✗ ${row.id}  ${row.title.slice(0, 32).padEnd(32)} ${ms}ms — render returned null`);
      }
    }),
  );

  const total = ((Date.now() - t0) / 1000).toFixed(1);
  // eslint-disable-next-line no-console
  console.log(`\nDone. ok=${ok} failed=${failed.length} (${total}s)`);
  if (failed.length > 0) process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
