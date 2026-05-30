import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import {
  buildApplyUrl,
  discoverDnsProvider,
} from "@/lib/domain-connect";

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/projects/[id]/domains/[domain]/connect-url
//
// Domain Connect "one-click" — discovers the user's DNS provider and, if
// supported, returns a signed Apply URL. Returns 404 (with a reason) when:
//
//   - the host is not claimed for this project
//   - the user's DNS provider is unknown OR doesn't support Domain Connect
//   - the signing key isn't configured (env not deployed yet)
//
// The frontend always tries this endpoint after a claim; the manual DNS
// panel stays as the fallback when it returns anything other than 200.
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  req: Request,
  { params }: { params: Promise<{ id: string; domain: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const { id, domain } = await params;
  if (!(await ensureOwner(id, session.user.id))) {
    return json({ error: "not_found" }, 404);
  }
  const decodedDomain = decodeURIComponent(domain);

  // Pull the claim — we need the verification token to embed in the URL.
  const rows = await db
    .select({
      token: schema.customDomains.verificationToken,
    })
    .from(schema.customDomains)
    .where(
      and(
        eq(schema.customDomains.projectId, id),
        eq(schema.customDomains.domain, decodedDomain),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) {
    return json(
      { ok: false, reason: "claim_not_found" },
      404,
    );
  }

  // Discover the user's DNS provider via TXT + NS heuristics.
  let provider;
  try {
    provider = await discoverDnsProvider(decodedDomain);
  } catch {
    provider = null;
  }
  if (!provider) {
    return json(
      { ok: false, reason: "provider_not_supported" },
      404,
    );
  }

  // Build the redirect_uri back to the workspace so the user lands on
  // the modal after the provider's apply screen. We bounce through
  // ?domain-connect=done so the modal knows to re-poll verification.
  const url = new URL(req.url);
  const origin = `${url.protocol}//${url.host}`;
  const redirectUri = `${origin}/new?project=${encodeURIComponent(id)}&domain-connect=done`;

  let applyUrl: string;
  try {
    applyUrl = buildApplyUrl({
      provider,
      domain: decodedDomain,
      token: row.token,
      redirectUri,
    });
  } catch (err) {
    // Most common: DOMAIN_CONNECT_SIGNING_KEY missing in prod env. Don't
    // surface the internal error to the client — the modal just shows the
    // manual DNS panel in this case.
    // eslint-disable-next-line no-console
    console.warn("[domain-connect] buildApplyUrl failed", err);
    return json(
      { ok: false, reason: "signing_not_configured" },
      404,
    );
  }

  return json(
    {
      ok: true,
      url: applyUrl,
      provider: {
        id: provider.providerId,
        name: provider.providerName,
        source: provider.source,
      },
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
