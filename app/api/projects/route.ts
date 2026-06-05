import { auth } from "@/auth";
import { listProjects } from "@/lib/projects";
import { listProfiles } from "@/lib/business-profiles/store";
import { getProjectStatsForUser } from "@/lib/analytics/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/projects — the signed-in user's projects (newest first) with the
// last-7-day stats merged in, plus their business profiles. Powers both the
// /projects dashboard data and the in-workspace Projects section.
export async function GET(): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return json({ error: "unauthorized" }, 401);
  }
  const userId = session.user.id;
  const [projects, profiles, statsMap] = await Promise.all([
    listProjects(userId),
    listProfiles(userId),
    getProjectStatsForUser(userId, 7),
  ]);
  const withStats = projects.map((p) => ({ ...p, stats: statsMap.get(p.id) }));
  return json({ projects: withStats, profiles }, 200);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
