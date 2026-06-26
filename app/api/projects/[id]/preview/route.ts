import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { generatePreviewToken } from "@/lib/projects/preview";
import type { ProjectData } from "@/lib/projects/types";

export const runtime = "nodejs";

// ─────────────────────────────────────────────────────────────────────────────
// /api/projects/[id]/preview — manage the project's shareable draft-preview
// link. The link itself (public GET /p/[id]?t=…) serves the CURRENT data.html
// to anyone holding the token, with no login — so a creator can show an
// unpublished draft to someone elsewhere BEFORE they Deploy.
//
//   GET    → { enabled, token }     current state (token is the owner's own)
//   POST   → { enabled:true, token } enable; idempotent (reuses the live token
//                                    so the shared link stays stable). Body
//                                    { rotate:true } mints a fresh one.
//   DELETE → { enabled:false }       revoke — kills every outstanding link.
//
// Auth-gated by session + ownership, like every other project route. The token
// is opaque + random (lib/projects/preview.ts), stored on data.preview.token;
// it is config, never baked into published HTML.
// ─────────────────────────────────────────────────────────────────────────────

async function loadOwnedData(
  id: string,
  userId: string,
): Promise<ProjectData | null> {
  const rows = await db
    .select({ data: schema.projects.data })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, id), eq(schema.projects.userId, userId)))
    .limit(1);
  return rows[0]?.data ?? null;
}

async function writeData(
  id: string,
  userId: string,
  data: ProjectData,
): Promise<boolean> {
  try {
    // NB: intentionally does NOT bump updatedAt — issuing/revoking a share
    // link is a side-channel, not a content edit, so it must not reorder the
    // project in the "recently edited" list.
    await db
      .update(schema.projects)
      .set({ data })
      .where(
        and(eq(schema.projects.id, id), eq(schema.projects.userId, userId)),
      );
    return true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[projects/preview] db update failed", err);
    return false;
  }
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const { id } = await params;
  const data = await loadOwnedData(id, session.user.id);
  if (!data) return json({ error: "not_found" }, 404);
  const token = data.preview?.token ?? null;
  return json({ enabled: !!token, token }, 200);
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const { id } = await params;

  const body = (await req.json().catch(() => ({}))) as { rotate?: boolean };
  const data = await loadOwnedData(id, session.user.id);
  if (!data) return json({ error: "not_found" }, 404);

  const existing = data.preview?.token;
  const token = existing && !body.rotate ? existing : generatePreviewToken();

  if (token !== existing) {
    const ok = await writeData(id, session.user.id, {
      ...data,
      preview: { token },
    });
    if (!ok) return json({ error: "db_update_failed" }, 500);
  }
  return json({ enabled: true, token }, 200);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const { id } = await params;

  const data = await loadOwnedData(id, session.user.id);
  if (!data) return json({ error: "not_found" }, 404);
  if (!data.preview) return json({ enabled: false }, 200);

  const next: ProjectData = { ...data };
  delete next.preview;
  const ok = await writeData(id, session.user.id, next);
  if (!ok) return json({ error: "db_update_failed" }, 500);
  return json({ enabled: false }, 200);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
