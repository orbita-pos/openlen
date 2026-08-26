import { and, eq, sql, type SQL } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { getOrCreateOwnerChatUser } from "@/lib/chat/store";
import { projectBusinessProfile } from "@/lib/business-profiles/project-profile";
import {
  applySettingsPatch,
  validateSettingsPatch,
  type SettingsPatchOutcome,
} from "@/lib/projects/settings-patch";
import type { ProjectSettings } from "@/lib/projects/types";

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/projects/[id]/settings — update non-HTML project settings.
//
// Phase 2: per-form config (notify email, success message, redirect). The
// body patches one form (by document-order index); emptied fields are
// dropped so the JSONB doesn't accumulate "" noise.
//
// The merge is a read-modify-write over `data`, so it must survive toggles
// fired at the same time (turning two modules on at once used to drop one).
// The write is therefore (a) narrowed to the `settings` subtree — a concurrent
// html save is never clobbered — and (b) guarded on the settings we read, so a
// racer that lost matches 0 rows and re-runs against fresh data instead of
// silently reverting the other toggle. Settings changes never touch
// `data.html`, so they don't snapshot a version.
//
// Validation + merge live in lib/projects/settings-patch.ts (shared with the
// agent's tool-call path) — this handler is just auth → validate → load →
// apply → chat provisioning → write.
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = "nodejs";

const MAX_ATTEMPTS = 12;

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

  const owns = and(
    eq(schema.projects.id, id),
    eq(schema.projects.userId, session.user.id),
  );

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const rows = await db
      .select({ data: schema.projects.data, title: schema.projects.title })
      .from(schema.projects)
      .where(owns)
      .limit(1);
    const existing = rows[0];
    if (!existing) return json({ error: "not_found" }, 404);

    const out = applySettingsPatch(existing.data, v.body);
    if ("error" in out) {
      return json({ error: "invalid_body", message: out.error }, 400);
    }

    // WhatsApp module toggled on with no number: default it from the business
    // profile («Mi negocio») so one saved number serves the whole product. The
    // card's own field still overrides on the next edit; the response's merged
    // `settings` carries the filled number back to the UI.
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

    let won: { id: string }[];
    try {
      won = await db
        .update(schema.projects)
        .set({ data: settingsWrite(out), updatedAt: new Date() })
        .where(and(owns, settingsUnchanged(existing.data.settings)))
        .returning({ id: schema.projects.id });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[projects/settings] db update failed", err);
      return json({ error: "db_update_failed" }, 500);
    }
    // Someone else wrote settings between our read and this update — redo the
    // merge on top of theirs so neither toggle is lost. Jittered wait: without
    // it a burst of toggles retries in lockstep and keeps colliding.
    if (won.length === 0) {
      await new Promise((r) => setTimeout(r, 10 + Math.random() * 40));
      continue;
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
        // La clave REAL bajo la que se guardó. El cliente ya no puede
        // derivarla: el servidor prefiere la identidad del formulario sobre su
        // índice, y al hacerlo MIGRA la entrada vieja — sin esto el espejo
        // local se quedaría con la clave por índice que ya no existe.
        formKey: out.formKey,
        settings: out.settings,
      },
      200,
    );
  }

  return json({ error: "conflict" }, 409);
}

/** The patched `settings` written INTO the live row — everything else in `data`
 *  stays whatever the row holds now, so a concurrent html save survives this
 *  write. (Antes esto podía además parir la página auto de Miembros; ese módulo
 *  se retiró el 2026-08-21.) */
function settingsWrite(out: SettingsPatchOutcome): SQL<unknown> {
  const col = schema.projects.data;
  return sql`jsonb_set(${col}, '{settings}', ${JSON.stringify(out.settings)}::jsonb, true)`;
}

/** Row guard: the settings are still the ones this request merged against. */
function settingsUnchanged(read: ProjectSettings | undefined): SQL<unknown> {
  const asRead = JSON.stringify(read ?? null);
  return sql`coalesce(${schema.projects.data} -> 'settings', 'null'::jsonb) = ${asRead}::jsonb`;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
