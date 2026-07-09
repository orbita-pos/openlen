import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { previewTokenMatches } from "@/lib/projects/preview";
import type { ProjectData } from "@/lib/projects/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/ov/[id]/state?t=<token> — polled every 10s by the inline script on
// /ov/[id] (see lib/overlay/render.ts) to mirror live goal/screen state
// without a reload. Same guards, same token, same identical-404 posture as
// /ov/[id] — see that route's header comment for the full rationale.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const url = new URL(req.url);
  const token = url.searchParams.get("t");
  if (!id || !token) return notFound();

  const data = await loadOverlayData(id);
  if (!data) return notFound();

  const overlay = data.settings?.overlay;
  if (!overlay?.enabled) return notFound();
  if (!previewTokenMatches(overlay.token, token)) return notFound();

  return Response.json(
    { goal: overlay.goal ?? null, screen: overlay.screen ?? null },
    { headers: { "cache-control": "no-store" } },
  );
}

async function loadOverlayData(id: string): Promise<ProjectData | null> {
  const rows = await db
    .select({ data: schema.projects.data })
    .from(schema.projects)
    .where(eq(schema.projects.id, id))
    .limit(1);
  return rows[0]?.data ?? null;
}

function notFound(): Response {
  return Response.json(
    { error: "not_found" },
    { status: 404, headers: { "cache-control": "no-store" } },
  );
}
