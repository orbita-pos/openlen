import { auth } from "@/auth";
import { updateVersionMeta } from "@/lib/projects/versions";

export const runtime = "nodejs";

interface PatchBody {
  label?: string;
  pinned?: boolean;
}

// PATCH /api/projects/<id>/versions/<vid> — rename and/or (un)pin a version.
// Pinned versions are exempt from eviction; the helper caps pins per project.
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string; vid: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);

  const { id, vid } = await ctx.params;
  if (!id || !vid) return json({ error: "missing id" }, 400);

  const body = (await req.json().catch(() => null)) as PatchBody | null;
  const label = typeof body?.label === "string" ? body.label : undefined;
  const pinned = typeof body?.pinned === "boolean" ? body.pinned : undefined;
  if (label === undefined && pinned === undefined) {
    return json({ error: "invalid_body" }, 400);
  }

  const result = await updateVersionMeta({
    projectId: id,
    versionId: vid,
    userId: session.user.id,
    label,
    pinned,
  });
  if (!result.ok) {
    if (result.reason === "not_found") return json({ error: "not_found" }, 404);
    if (result.reason === "pin_limit") return json({ error: "pin_limit" }, 409);
    return json({ error: "invalid_label" }, 400);
  }

  return json({ ok: true, label: result.label, pinned: result.pinned }, 200);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
