// PATCH /api/me/profile — guardar TU perfil: nombre, bio, enlaces y fijados
// (docs/superpowers/specs/2026-10-10-profile-design.md). El @ va por
// /api/me/handle y la foto por /api/me/avatar.
import { auth } from "@/auth";
import { updateProfile } from "@/lib/profile/store";
import { parseProfilePatch } from "@/lib/profile/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export async function PATCH(req: Request): Promise<Response> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return json({ error: "unauthorized" }, 401);
  const parsed = parseProfilePatch(await req.json().catch(() => null));
  if (!parsed.ok) return json({ error: "invalid", path: parsed.path }, 400);
  await updateProfile(userId, parsed.patch);
  return json({ ok: true });
}
