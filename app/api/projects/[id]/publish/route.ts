import { z } from "zod";
import { auth } from "@/auth";
import {
  ProjectNotFoundError,
  publishProject,
  SubdomainInvalidError,
  SubdomainLimitError,
  SubdomainTakenError,
  unpublishProject,
} from "@/lib/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// POST   /api/projects/[id]/publish  → claim a subdomain + publish.
// DELETE /api/projects/[id]/publish  → release the subdomain + take it down.
//
// HTTP status map (kept tight on purpose — the UI matches on these):
//   400 invalid       — subdomain regex/length/xn--/pure-numeric fail
//   400 reserved      — subdomain in the reserved list
//   402 limit_reached — tier cap on active subdomains hit
//   403 forbidden     — caller doesn't own the project (also used when the
//                      project exists but belongs to someone else)
//   404 not_found     — project id doesn't exist for this user
//   409 taken         — another row already claims this subdomain
//   500 error         — disk write or DB error after validation passed
// ─────────────────────────────────────────────────────────────────────────────

const PublishBodySchema = z.object({
  subdomain: z.string().min(1).max(63),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const parsed = PublishBodySchema.safeParse(body);
  if (!parsed.success) {
    return json(
      { error: "invalid", message: parsed.error.issues[0]?.message ?? "Invalid input" },
      400,
    );
  }

  try {
    const result = await publishProject({
      projectId: id,
      userId: session.user.id,
      subdomain: parsed.data.subdomain,
    });
    return json(result, 200);
  } catch (err) {
    if (err instanceof SubdomainInvalidError) {
      return json({ error: err.reason }, 400);
    }
    if (err instanceof SubdomainTakenError) {
      return json({ error: "taken" }, 409);
    }
    if (err instanceof SubdomainLimitError) {
      return json({ error: "limit_reached", limit: err.limit }, 402);
    }
    if (err instanceof ProjectNotFoundError) {
      return json({ error: "not_found" }, 404);
    }
    // eslint-disable-next-line no-console
    console.error("[publish] unexpected error:", err);
    return json({ error: "publish_failed" }, 500);
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const { id } = await params;

  try {
    await unpublishProject({
      projectId: id,
      userId: session.user.id,
    });
    return json({ ok: true }, 200);
  } catch (err) {
    if (err instanceof ProjectNotFoundError) {
      return json({ error: "not_found" }, 404);
    }
    // eslint-disable-next-line no-console
    console.error("[unpublish] unexpected error:", err);
    return json({ error: "unpublish_failed" }, 500);
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
