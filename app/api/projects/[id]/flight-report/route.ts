import { and, desc, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/projects/[id]/flight-report[?sha=<releaseSha>]
//
// Owner-gated. Returns the project's latest Flight Check report (or the one
// for a specific release when ?sha= is given). `report: null` means the
// audit hasn't landed yet — the Speed Card polls until it does or gives up.

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const { id } = await ctx.params;

  const owned = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(
      and(
        eq(schema.projects.id, id),
        eq(schema.projects.userId, session.user.id),
      ),
    )
    .limit(1);
  if (owned.length === 0) return json({ error: "not_found" }, 404);

  const sha = new URL(req.url).searchParams.get("sha");
  const conditions = [eq(schema.flightReports.projectId, id)];
  if (sha && /^[a-f0-9]{1,64}$/.test(sha)) {
    conditions.push(eq(schema.flightReports.releaseSha, sha));
  }

  const rows = await db
    .select()
    .from(schema.flightReports)
    .where(and(...conditions))
    .orderBy(desc(schema.flightReports.createdAt))
    .limit(1);

  return json({ report: rows[0] ?? null }, 200);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
