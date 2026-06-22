import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { getFunnel, type InsightsRange } from "@/lib/analytics/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/projects/[id]/funnel?range=7d|30d|90d|all
//
// Owner-gated. Returns the conversion funnel (saw → clicked → submitted →
// booked) + first-touch source attribution for the project + range. Unknown
// range falls back to 7d. Anonymous or non-owner gets 401/404.

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

  try {
    const funnel = await getFunnel(id, range);
    return json(funnel, 200);
  } catch (err) {
    // Defense-in-depth: if the cid/source columns aren't migrated yet (deploy
    // raced the migration), degrade to an empty funnel rather than a raw 500.
    // eslint-disable-next-line no-console
    console.error("[funnel] query failed", err);
    return json(
      {
        range,
        saw: 0,
        clicked: 0,
        submitted: 0,
        booked: 0,
        untrackedLeads: 0,
        untrackedBookings: 0,
        sources: [],
      },
      200,
    );
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
