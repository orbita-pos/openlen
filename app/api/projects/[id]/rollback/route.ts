import { z } from "zod";
import { auth } from "@/auth";
import {
  ProjectNotFoundError,
  ReleaseUnavailableError,
  rollbackProject,
} from "@/lib/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/projects/[id]/rollback
// body: { sha: string }
//
// Flips the `current` symlink for the project's subdomain to a prior
// release and re-syncs publishedHtml + publishedReleaseSha. Does not
// regenerate HTML — the release dir already has the optimized bytes.
//
// Status map:
//   400 invalid        — body schema or sha format
//   404 not_found      — project doesn't exist for this user
//   404 not_published  — project has no subdomain claimed
//   404 release_gone   — sha doesn't match a release on disk
//   500 error          — fs / db error after validation
//
// `not_published` and `release_gone` share 404 but differ in `error`.

const RollbackBodySchema = z.object({
  sha: z.string().regex(/^[a-f0-9]{1,64}$/),
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
    return json({ error: "invalid", message: "Invalid JSON body" }, 400);
  }
  const parsed = RollbackBodySchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: "invalid" }, 400);
  }

  try {
    const result = await rollbackProject({
      projectId: id,
      userId: session.user.id,
      sha: parsed.data.sha,
    });
    return json(result, 200);
  } catch (err) {
    if (err instanceof ProjectNotFoundError) {
      return json({ error: "not_found" }, 404);
    }
    if (err instanceof ReleaseUnavailableError) {
      return json({ error: "release_gone" }, 404);
    }
    // eslint-disable-next-line no-console
    console.error("[rollback] unexpected error:", err);
    return json({ error: "rollback_failed" }, 500);
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
