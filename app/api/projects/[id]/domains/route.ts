import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import {
  claimDomain,
  listDomainsForProject,
} from "@/lib/custom-domains";

// ─────────────────────────────────────────────────────────────────────────────
// GET  /api/projects/[id]/domains — list custom domains claimed by the project.
// POST /api/projects/[id]/domains — claim a new domain (returns DNS instructions).
//
// Both require an authenticated session that owns the project. The Caddy
// `on_demand_tls.ask` endpoint lives elsewhere (/api/domains/lookup) and is
// intentionally unauthenticated — it only confirms whether a host is
// claim-verified, never exposes ownership.
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

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const { id } = await params;
  if (!(await ensureOwner(id, session.user.id))) {
    return json({ error: "not_found" }, 404);
  }
  const records = await listDomainsForProject(id);
  return json(
    {
      domains: records.map((r) => ({
        domain: r.domain,
        verified: r.verifiedAt !== null,
        verifiedAt: r.verifiedAt?.toISOString() ?? null,
        verificationToken: r.verificationToken,
        createdAt: r.createdAt.toISOString(),
      })),
    },
    200,
  );
}

interface PostBody {
  domain?: string;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const { id } = await params;
  if (!(await ensureOwner(id, session.user.id))) {
    return json({ error: "not_found" }, 404);
  }

  const body = (await req.json().catch(() => null)) as PostBody | null;
  if (!body || typeof body.domain !== "string") {
    return json(
      { error: "invalid_body", message: "domain string is required" },
      400,
    );
  }

  const result = await claimDomain({ projectId: id, domain: body.domain });
  if (!result.ok) {
    const status = result.reason === "invalid" ? 400 : 409;
    return json(
      { error: result.reason, message: result.detail },
      status,
    );
  }

  return json(
    {
      ok: true,
      domain: result.record.domain,
      verificationToken: result.record.verificationToken,
      verified: result.record.verifiedAt !== null,
      dns: dnsInstructions(result.record.domain, result.record.verificationToken),
    },
    201,
  );
}

function dnsInstructions(domain: string, token: string) {
  // The IP the user must A-record to. Resolved via env so a future move
  // off Hetzner doesn't require a code change here.
  const ip = process.env.CUSTOM_DOMAIN_TARGET_IP || "178.156.175.171";
  const isApex = domain.split(".").length === 2;
  return {
    txt: {
      name: `_openlen-challenge.${domain}`,
      value: token,
      ttl: 300,
    },
    // Apex domains can only use A records (CNAME is invalid at the zone
    // root by RFC 1034). Subdomains can use either — A is simpler since
    // it doesn't require ALIAS/ANAME for the CNAME flat workaround.
    a: { name: domain, value: ip, ttl: 300 },
    cname: isApex ? null : { name: domain, value: "custom.openlen.com", ttl: 300 },
  };
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
