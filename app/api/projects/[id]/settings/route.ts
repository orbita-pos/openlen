import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { getOrCreateOwnerChatUser } from "@/lib/chat/store";
import {
  applySettingsPatch,
  validateSettingsPatch,
} from "@/lib/projects/settings-patch";

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/projects/[id]/settings — update non-HTML project settings.
//
// Phase 2: per-form config (notify email, success message, redirect). The
// body patches one form (by document-order index); emptied fields are
// dropped so the JSONB doesn't accumulate "" noise.
//
// Read-modify-writes the whole `data` JSONB (last-write-wins, same model as
// PATCH /html). Settings changes never touch `data.html`, so they don't
// snapshot a version — there's nothing new to snapshot.
//
// Validation + merge live in lib/projects/settings-patch.ts (shared with the
// agent's tool-call path) — this handler is just auth → validate → load →
// apply → chat provisioning → write.
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = "nodejs";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const { id } = await params;

  const raw = await req.json().catch(() => null);
  const v = validateSettingsPatch(raw, id);
  if (!v.ok) {
    return json(
      { error: "invalid_body", ...(v.message ? { message: v.message } : {}) },
      400,
    );
  }

  const rows = await db
    .select({ data: schema.projects.data, title: schema.projects.title })
    .from(schema.projects)
    .where(
      and(
        eq(schema.projects.id, id),
        eq(schema.projects.userId, session.user.id),
      ),
    )
    .limit(1);
  const existing = rows[0];
  if (!existing) return json({ error: "not_found" }, 404);

  const out = applySettingsPatch(existing.data, v.body);
  if ("error" in out) {
    return json({ error: "invalid_body", message: out.error }, 400);
  }

  if (out.chatJustEnabled) {
    // Auto-provision the owner chat_user so visitors can "message the business".
    // Idempotent; awaited so a follow-up read sees it.
    try {
      await getOrCreateOwnerChatUser(id, session.user.id, {
        email: session.user.email ?? null,
        displayName: existing.title,
      });
    } catch (err) {
      console.warn("[settings] owner chat provisioning failed (will retry lazily)", err);
    }
  }

  try {
    await db
      .update(schema.projects)
      .set({ data: out.nextData, updatedAt: new Date() })
      .where(
        and(
          eq(schema.projects.id, id),
          eq(schema.projects.userId, session.user.id),
        ),
      );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[projects/settings] db update failed", err);
    return json({ error: "db_update_failed" }, 500);
  }

  // `config` is the per-form config the form-patch flow reads back to
  // update its local mirror; absent on analytics-only updates. `settings`
  // is the full merged settings blob so callers can sync more than the
  // form they just touched. `createdPage` (members auto-page) carries its
  // html so the workspace can mirror data.pages without a refetch.
  const config = out.formKey !== null ? (out.settings.forms?.[out.formKey] ?? null) : null;
  return json(
    {
      ok: true,
      config,
      settings: out.settings,
      ...(out.createdPage ? { createdPage: out.createdPage } : {}),
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
