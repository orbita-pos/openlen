import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { sendLeadNotificationEmail } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/projects/[id]/forms/test-email
//
// Body: { formIndex?: number }
//
// Owner-only. Sends a TEST lead notification to whichever address would
// receive the real one for this form (per-form notifyEmail override falls
// back to the account email). The email is identical in shape to the real
// notification but carries a banner saying it's a test — the user can
// preview what their inbox will look like without waiting for a real
// visitor to submit.
//
// Returns: { ok: true, sentTo: string } | { ok: false, reason: string }
// ─────────────────────────────────────────────────────────────────────────────

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://openlen.com";

const DUMMY_FIELDS: Record<string, string> = {
  name: "Test Submitter",
  email: "test@example.com",
  message:
    "This is a test email triggered from your OpenLen workspace. The real notification looks the same, with the visitor's actual data.",
};

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ ok: false, reason: "unauthorized" }, 401);
  const { id } = await ctx.params;

  const body = (await req.json().catch(() => ({}))) as {
    formIndex?: number;
  };
  const formIndex =
    typeof body.formIndex === "number" && Number.isInteger(body.formIndex)
      ? body.formIndex
      : null;

  const rows = await db
    .select({
      title: schema.projects.title,
      data: schema.projects.data,
      accountEmail: schema.users.email,
    })
    .from(schema.projects)
    .innerJoin(schema.users, eq(schema.projects.userId, schema.users.id))
    .where(
      and(
        eq(schema.projects.id, id),
        eq(schema.projects.userId, session.user.id),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return json({ ok: false, reason: "not_found" }, 404);

  // Same fallback logic as the public form endpoint: per-form notifyEmail
  // override > account email.
  let to = row.accountEmail ?? "";
  if (formIndex !== null) {
    const override =
      row.data?.settings?.forms?.[String(formIndex)]?.notifyEmail;
    if (override) to = override;
  }
  if (!to) {
    return json(
      {
        ok: false,
        reason: "no_destination",
        message:
          "No notify-email set for this form, and your account has no email on file.",
      },
      400,
    );
  }

  try {
    await sendLeadNotificationEmail({
      to,
      projectTitle: row.title,
      fields: DUMMY_FIELDS,
      dashboardUrl: `${SITE_URL}/new-v2?project=${id}`,
      testMode: true,
      meta: {
        submittedAt: new Date(),
        country: "PE",
        device: "desktop",
        browser: "chrome",
        referer: null,
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[forms/test-email] send failed", err);
    return json(
      {
        ok: false,
        reason: "send_failed",
        message:
          err instanceof Error ? err.message : "Resend rejected the send.",
      },
      502,
    );
  }

  return json({ ok: true, sentTo: to }, 200);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
