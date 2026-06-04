import { auth } from "@/auth";
import {
  deleteProfile,
  ensureDefaultProfile,
  setDefaultProfile,
  updateProfile,
} from "@/lib/business-profiles/store";
import { reassignNullProjects } from "@/lib/projects";
import { normalizeProfileData } from "@/lib/business-profiles/normalize";

// PATCH  /api/profiles/[id]  — update { name?, data? } OR { setDefault: true }
// DELETE /api/profiles/[id]  — remove a profile

export const runtime = "nodejs";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) return json(401, { error: "unauthenticated" });
  const { id } = await params;

  let body: { name?: unknown; data?: unknown; setDefault?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid JSON body" });
  }

  if (body.setDefault === true) {
    const profile = await setDefaultProfile(session.user.id, id);
    if (!profile) return json(404, { error: "profile not found" });
    return json(200, { profile });
  }

  const patch: { name?: string; data?: ReturnType<typeof normalizeProfileData> } =
    {};
  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name) return json(400, { error: "name cannot be empty" });
    if (name.length > 80) return json(400, { error: "name too long (max 80)" });
    patch.name = name;
  }
  if (body.data !== undefined) {
    patch.data = normalizeProfileData(body.data);
  }
  if (patch.name === undefined && patch.data === undefined) {
    return json(400, { error: "nothing to update" });
  }

  const profile = await updateProfile(session.user.id, id, patch);
  if (!profile) return json(404, { error: "profile not found" });
  return json(200, { profile });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) return json(401, { error: "unauthenticated" });
  const { id } = await params;
  const ok = await deleteProfile(session.user.id, id);
  if (!ok) return json(404, { error: "profile not found" });
  // ON DELETE SET NULL orphaned this profile's pages — re-home them (and any
  // legacy null-profile pages) onto the user's default so every page keeps a
  // business.
  const def = await ensureDefaultProfile(session.user.id);
  await reassignNullProjects(session.user.id, def.id);
  return json(200, { ok: true });
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
