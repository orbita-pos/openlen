import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { verifyDomain } from "@/lib/custom-domains";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/projects/[id]/domains/[domain]/verify — re-run the TXT challenge.
//
// The handler resolves `_openlen-challenge.<domain>` and compares the
// observed value against the stored verification token. On match, flips
// verifiedAt to now — which is the signal Caddy's on_demand_tls picks up
// to start issuing certs for this host.
//
// Safe to call repeatedly — verify is idempotent past the first success.
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = "nodejs";

async function ensureOwner(
  projectId: string,
  userId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(
      and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)),
    )
    .limit(1);
  return Boolean(rows[0]);
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; domain: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const { id, domain } = await params;
  if (!(await ensureOwner(id, session.user.id))) {
    return json({ error: "not_found" }, 404);
  }
  const result = await verifyDomain({
    projectId: id,
    domain: decodeURIComponent(domain),
  });
  if (!result.ok) {
    const status =
      result.reason === "not-found" ? 404
        : result.reason === "txt-missing" || result.reason === "txt-mismatch"
          ? 409
          : 502;
    return json(
      {
        ok: false,
        reason: result.reason,
        message: result.detail,
      },
      status,
    );
  }
  return json(
    {
      ok: true,
      domain: result.record.domain,
      verified: true,
      verifiedAt: result.record.verifiedAt?.toISOString() ?? null,
    },
    200,
  );
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
