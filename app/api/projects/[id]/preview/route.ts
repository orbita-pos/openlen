import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { generatePreviewToken, hashPasscode } from "@/lib/projects/preview";
import type { PreviewSettings, ProjectData } from "@/lib/projects/types";

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
  return json(stateOf(data.preview), 200);
}

interface PostBody {
  rotate?: boolean;
  /** 1..365 → set expiry that many days out; null → never expires; absent → keep. */
  expiresInDays?: number | null;
  /** non-empty → set passcode; null/"" → clear it; absent → keep. */
  passcode?: string | null;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const { id } = await params;

  const raw = await req.json().catch(() => ({}));
  const body: PostBody = raw && typeof raw === "object" ? (raw as PostBody) : {};
  const data = await loadOwnedData(id, session.user.id);
  if (!data) return json({ error: "not_found" }, 404);

  const prev = data.preview;
  const token = prev?.token && !body.rotate ? prev.token : generatePreviewToken();
  const next: PreviewSettings = { ...(prev ?? {}), token };

  if ("expiresInDays" in body) {
    const d = body.expiresInDays;
    if (d === null) {
      delete next.expiresAt;
    } else if (typeof d === "number" && Number.isInteger(d) && d >= 1 && d <= 365) {
      next.expiresAt = new Date(Date.now() + d * 86_400_000).toISOString();
    } else {
      return json({ error: "invalid_body", message: "expiresInDays must be 1-365 or null" }, 400);
    }
  }

  if ("passcode" in body) {
    const p = body.passcode;
    if (p === null || p === "") {
      delete next.passcodeHash;
    } else if (typeof p === "string" && p.length <= 128) {
      next.passcodeHash = hashPasscode(id, p);
    } else {
      return json({ error: "invalid_body", message: "passcode must be a string ≤128 chars or null" }, 400);
    }
  }

  const ok = await writeData(id, session.user.id, { ...data, preview: next });
  if (!ok) return json({ error: "db_update_failed" }, 500);
  return json(stateOf(next), 200);
}

/** The client-facing shape — never leaks the passcode hash, just whether one
 *  is set. `token` is the owner's own. */
function stateOf(preview: PreviewSettings | undefined): {
  enabled: boolean;
  token: string | null;
  expiresAt: string | null;
  hasPasscode: boolean;
} {
  return {
    enabled: !!preview?.token,
    token: preview?.token ?? null,
    expiresAt: preview?.expiresAt ?? null,
    hasPasscode: !!preview?.passcodeHash,
  };
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
