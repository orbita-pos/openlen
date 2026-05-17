import { z } from "zod";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { eq, and, isNotNull } from "drizzle-orm";
import { getUserPlan } from "@/lib/limits";
import { subdomainLimitForPlan } from "@/lib/subdomain/limits";
import { validateSubdomain } from "@/lib/subdomain/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/subdomains/check
//
// Body: { subdomain: string }
// Returns: { available: boolean, reason?: "invalid" | "reserved" | "taken" | "limit_reached" }
//
// Used by the publish modal to drive a debounced live-availability check.
// Strictly read-only — no rows are inserted, no DB mutation. Auth-gated to
// avoid an open enumeration endpoint that could be used to crawl which
// subdomains are claimed by inferring 200/404 latency.
//
// "limit_reached" is reported when the user's plan cap is already hit; in
// that case the name itself might be free, but the user couldn't claim it
// from where they are right now — surfacing the cap reason is more useful
// than saying "available".
// ─────────────────────────────────────────────────────────────────────────────

const BodySchema = z.object({
  subdomain: z.string().min(1).max(63),
});

export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return json({ available: false, reason: "invalid" }, 200);
  }

  const v = validateSubdomain(parsed.data.subdomain);
  if (!v.ok) {
    return json({ available: false, reason: v.reason }, 200);
  }

  // Tier cap — if the user already used all their slots, surface that as
  // the reason. We DON'T count a slot already claimed by ANY of their
  // projects, because re-publishing under the same name shouldn't trip the
  // cap. The actual claim flow re-checks this with project-context.
  const plan = await getUserPlan(session.user.id);
  const cap = subdomainLimitForPlan(plan);
  const ownedRows = await db
    .select({
      subdomain: schema.projects.subdomain,
    })
    .from(schema.projects)
    .where(
      and(
        eq(schema.projects.userId, session.user.id),
        isNotNull(schema.projects.subdomain),
      ),
    );
  const owned = new Set(
    ownedRows.map((r) => r.subdomain).filter((s): s is string => !!s),
  );
  if (!owned.has(v.value) && owned.size >= cap) {
    return json({ available: false, reason: "limit_reached" }, 200);
  }

  // Cheap unique-check — leverages the projects_subdomain_unique constraint
  // index added in Session 11. No row → free; row → taken.
  const taken = await db
    .select({ id: schema.projects.id, userId: schema.projects.userId })
    .from(schema.projects)
    .where(eq(schema.projects.subdomain, v.value))
    .limit(1);
  const row = taken[0];
  if (row && row.userId !== session.user.id) {
    return json({ available: false, reason: "taken" }, 200);
  }

  return json({ available: true }, 200);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
