import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import type { FormConfig, ProjectData } from "@/lib/projects/types";

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
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = "nodejs";

const MAX_EMAIL = 200;
const MAX_MESSAGE = 300;
const MAX_URL = 2000;

interface PatchBody {
  /** Index of the <form> being configured (document order). */
  formIndex?: number;
  /** Fields to merge into that form's config. */
  patch?: {
    notifyEmail?: string;
    successMessage?: string;
    redirectUrl?: string;
  };
  /** Opt-out for the analytics snippet injected at publish time. The
   *  toggle does not retroactively affect already-published HTML — it
   *  only takes effect on the next publish. */
  analyticsDisabled?: boolean;
  /** Motion Looks preset, or null/"" to turn motion off. Takes effect on
   *  the next publish. */
  motion?: string | null;
}

function clean(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const { id } = await params;

  const body = (await req.json().catch(() => null)) as PatchBody | null;
  if (!body || typeof body !== "object") {
    return json({ error: "invalid_body" }, 400);
  }
  const hasFormPatch =
    typeof body.formIndex === "number" && body.patch && typeof body.patch === "object";
  const hasAnalyticsToggle = typeof body.analyticsDisabled === "boolean";
  const hasMotion = "motion" in body;
  if (hasMotion) {
    const m = body.motion;
    if (m !== null && !["calm", "editorial", "dramatic", ""].includes(m as string)) {
      return json(
        { error: "invalid_body", message: "motion must be calm|editorial|dramatic or null" },
        400,
      );
    }
  }
  if (!hasFormPatch && !hasAnalyticsToggle && !hasMotion) {
    return json(
      {
        error: "invalid_body",
        message: "expected formIndex+patch OR analyticsDisabled OR motion",
      },
      400,
    );
  }
  if (hasFormPatch) {
    const fi = body.formIndex as number;
    if (!Number.isInteger(fi) || fi < 0 || fi > 99) {
      return json(
        { error: "invalid_body", message: "formIndex must be 0-99" },
        400,
      );
    }
  }

  const rows = await db
    .select({ data: schema.projects.data })
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

  const data: ProjectData = existing.data;
  const forms: Record<string, FormConfig> = {
    ...(data.settings?.forms ?? {}),
  };

  if (hasFormPatch) {
    const formIndex = body.formIndex as number;
    const patch = body.patch as NonNullable<PatchBody["patch"]>;
    const key = String(formIndex);
    const next: FormConfig = { ...(forms[key] ?? {}) };

    if ("notifyEmail" in patch) {
      const e = clean(patch.notifyEmail, MAX_EMAIL);
      // Basic shape check — a malformed address would just bounce the lead
      // email silently, so reject it here instead of storing it.
      if (e && e.includes("@")) next.notifyEmail = e;
      else delete next.notifyEmail;
    }
    if ("successMessage" in patch) {
      const m = clean(patch.successMessage, MAX_MESSAGE);
      if (m) next.successMessage = m;
      else delete next.successMessage;
    }
    if ("redirectUrl" in patch) {
      const u = clean(patch.redirectUrl, MAX_URL);
      if (u) next.redirectUrl = u;
      else delete next.redirectUrl;
    }

    if (Object.keys(next).length > 0) forms[key] = next;
    else delete forms[key];
  }

  const nextSettings = { ...data.settings, forms };
  if (hasAnalyticsToggle) {
    nextSettings.analyticsDisabled = body.analyticsDisabled === true;
  }
  if (hasMotion) {
    const m = body.motion;
    if (m && m !== "") nextSettings.motion = m;
    else delete nextSettings.motion;
  }

  const nextData: ProjectData = {
    ...data,
    settings: nextSettings,
  };

  try {
    await db
      .update(schema.projects)
      .set({ data: nextData, updatedAt: new Date() })
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
  // form they just touched.
  const config = hasFormPatch
    ? (forms[String(body.formIndex as number)] ?? null)
    : null;
  return json({ ok: true, config, settings: nextSettings }, 200);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
