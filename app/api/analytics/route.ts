import { auth } from "@/auth";
import { listProjects } from "@/lib/projects";
import { getProjectStatsForUser } from "@/lib/analytics/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/analytics — account-level metrics (last 30 days) across all the
// user's pages: aggregate totals + a per-page breakdown. Mirrors the /analytics
// route's server query so the in-workspace Analytics section can fetch it.
export async function GET(): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return json({ error: "unauthorized" }, 401);
  }
  const userId = session.user.id;
  const [projects, statsMap] = await Promise.all([
    listProjects(userId),
    getProjectStatsForUser(userId, 30),
  ]);
  const perPage = projects
    .map((p) => {
      const s = statsMap.get(p.id) ?? { views: 0, clicks: 0, leads: 0 };
      return {
        id: p.id,
        title: p.title,
        subdomain: p.subdomain,
        views: s.views,
        clicks: s.clicks,
        leads: s.leads,
      };
    })
    .filter((p) => p.subdomain !== null || p.views > 0 || p.leads > 0)
    .sort((a, b) => b.views - a.views || b.leads - a.leads);
  const totals = perPage.reduce(
    (acc, p) => ({
      views: acc.views + p.views,
      clicks: acc.clicks + p.clicks,
      leads: acc.leads + p.leads,
    }),
    { views: 0, clicks: 0, leads: 0 },
  );
  return json({ totals, perPage }, 200);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
