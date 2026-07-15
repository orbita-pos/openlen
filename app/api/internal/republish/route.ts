import { NextResponse } from "next/server";
import { inArray, and, isNotNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { publishProject } from "@/lib/projects";
import { internalSecretOk } from "@/lib/publish/internal-auth";

// Republicación selectiva por ids — herramienta de OPS para backfills (p.ej.
// tras re-escribir project.data.html en la DB, las páginas publicadas
// necesitan re-hornearse al disco del box). Corre EN PROCESO igual que
// live-republish (crates nativos ya cargados). Solo toca proyectos que YA
// están publicados: nunca publica un borrador ni reclama subdominios.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_IDS = 50;

export async function POST(req: Request) {
  if (!internalSecretOk(req)) return NextResponse.json({ ok: false }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { projectIds?: unknown } | null;
  const ids = Array.isArray(body?.projectIds)
    ? body.projectIds.filter((x): x is string => typeof x === "string").slice(0, MAX_IDS)
    : [];
  if (ids.length === 0) return NextResponse.json({ ok: false, reason: "no_ids" }, { status: 400 });

  const rows = await db
    .select({ id: schema.projects.id, userId: schema.projects.userId, subdomain: schema.projects.subdomain })
    .from(schema.projects)
    .where(
      and(
        inArray(schema.projects.id, ids),
        isNotNull(schema.projects.publishedAt),
        isNotNull(schema.projects.subdomain),
      ),
    );

  const republished: string[] = [];
  const failed: { id: string; reason: string }[] = [];
  const skipped = ids.filter((id) => !rows.some((r) => r.id === id));

  for (const row of rows) {
    if (!row.subdomain) continue;
    try {
      await publishProject({
        projectId: row.id,
        userId: row.userId,
        subdomain: row.subdomain,
        skipFlightCheck: true,
      });
      republished.push(row.id);
    } catch (err) {
      failed.push({ id: row.id, reason: String((err as Error)?.message ?? err).slice(0, 120) });
    }
  }

  return NextResponse.json({ ok: true, republished, failed, skipped });
}
