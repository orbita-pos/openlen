import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { listAgents, inviteAgent, countAgents } from "@/lib/chat/agents";
import { getUserPlan, AGENT_LIMITS } from "@/lib/limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Verify the caller owns the project. Returns the project row or null. */
async function requireOwner(projectId: string, userId: string) {
  const rows = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(
      and(
        eq(schema.projects.id, projectId),
        eq(schema.projects.userId, userId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

// GET /api/projects/[id]/agents — list agents (owner only)
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const { id } = await params;
  const owned = await requireOwner(id, session.user.id);
  if (!owned) return json({ error: "not_found" }, 404);
  const agents = await listAgents(id);
  return json({ agents }, 200);
}

// POST /api/projects/[id]/agents — invite an agent by email (owner only)
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const { id } = await params;
  const owned = await requireOwner(id, session.user.id);
  if (!owned) return json({ error: "not_found" }, 404);

  const body = (await req.json().catch(() => null)) as { email?: unknown } | null;
  if (!body || typeof body.email !== "string" || !body.email.trim()) {
    return json({ error: "invalid_body", message: "email is required" }, 400);
  }

  const emailNorm = body.email.trim().toLowerCase();
  const plan = await getUserPlan(session.user.id);
  const cap = AGENT_LIMITS[plan];
  const alreadyAgent = (await listAgents(id)).some((a) => a.invitedEmail === emailNorm);
  if (!alreadyAgent && (await countAgents(id)) >= cap) {
    return json({ error: "agent_limit_reached", cap, current: await countAgents(id) }, 402);
  }

  const result = await inviteAgent(id, body.email.trim());
  if ("error" in result) {
    if (result.error === "no_account") {
      return json(
        { error: "no_account", message: "That email has no OpenLen account yet." },
        404,
      );
    }
    if (result.error === "self") {
      return json({ error: "self", message: "You cannot invite yourself." }, 400);
    }
  }
  return json(result, 200);
}
