import { requireAdmin } from "@/lib/auth/admin-only";
import { adminSetVisibility } from "@/lib/community/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const guard = await requireAdmin();
  if (guard instanceof Response) return guard;
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { visibility?: string } | null;
  const next = body?.visibility;
  if (next !== "hidden" && next !== "public") return json({ error: "invalid_body" }, 400);
  await adminSetVisibility(id, next);
  return json({ ok: true }, 200);
}

function json(b: unknown, s: number) {
  return new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
}
