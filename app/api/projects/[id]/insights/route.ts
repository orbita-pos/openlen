import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { getInsights, type InsightsRange } from "@/lib/analytics/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/projects/[id]/insights?range=7d|30d|90d|all
//
// Owner-gated. Returns the aggregated Insights payload for the project +
// range. Unknown range falls back to 7d. Anonymous or non-owner gets 401/404.

const VALID_RANGES: ReadonlyArray<InsightsRange> = ["7d", "30d", "90d", "all"];

function parseRange(raw: string | null): InsightsRange {
  if (!raw) return "7d";
  return (VALID_RANGES as readonly string[]).includes(raw)
    ? (raw as InsightsRange)
    : "7d";
}

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

  const url = new URL(req.url);
  const range = parseRange(url.searchParams.get("range"));

  const insights = await getInsights(id, range);
  return json(insights, 200);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
