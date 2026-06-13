import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { getUsage, getUserPlan } from "@/lib/limits";
import {
  broadcastCapWindows,
  broadcastEmailCapKey,
  recordEmailCapUnits,
} from "@/lib/broadcast/limits";
import { resolveBroadcastAudience } from "@/lib/broadcast/audience";
import {
  claimBroadcastForSending,
  getBroadcast,
  markBroadcastFailed,
  markBroadcastSent,
} from "@/lib/broadcast/store";
import { runBroadcastSend } from "@/lib/broadcast/send";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/projects/[id]/broadcasts/[broadcastId]/send
//
// Resolves the audience, enforces the monthly cap ALL-OR-NOTHING (user
// decision — never a half-delivered campaign), atomically claims the
// broadcast (single-flight + crash-recovery), charges N email units, then
// delivers synchronously via Resend batches. Idempotent: a 'sent' broadcast
// replays its result; a fresh 'sending' one returns 409.
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function detectLang(html: string): string {
  const m = /<html[^>]*\blang=["']?([a-zA-Z-]{2,10})/.exec(html);
  return m ? m[1].slice(0, 2).toLowerCase() : "en";
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; broadcastId: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const { id, broadcastId } = await params;

  const rows = await db
    .select({
      subdomain: schema.projects.subdomain,
      title: schema.projects.title,
      data: schema.projects.data,
    })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, id), eq(schema.projects.userId, session.user.id)))
    .limit(1);
  const project = rows[0];
  if (!project) return json({ error: "not_found" }, 404);

  if (project.data?.settings?.broadcast?.enabled !== true) {
    return json({ error: "disabled" }, 403);
  }
  if (!project.subdomain) {
    // No host = no member audience and nowhere to anchor unsubscribe links.
    return json({ error: "not_published" }, 409);
  }

  const broadcast = await getBroadcast(id, broadcastId);
  if (!broadcast) return json({ error: "not_found" }, 404);
  if (broadcast.status === "sent") {
    return json(
      { ok: true, sentCount: broadcast.sentCount ?? 0, alreadySent: true },
      200,
    );
  }

  const audience = await resolveBroadcastAudience(id);

  // CAP — all-or-nothing. Block (no status change) if the campaign would
  // exceed the remaining monthly budget.
  const plan = await getUserPlan(session.user.id);
  const usage = await getUsage(broadcastEmailCapKey(id), broadcastCapWindows(plan));
  const remaining = usage[0]?.remaining ?? 0;
  if (audience.length > remaining) {
    return json(
      { error: "cap", remaining, audienceCount: audience.length },
      402,
    );
  }

  // Atomic claim — only one send runs; fresh 'sending' → 409.
  const claimed = await claimBroadcastForSending(broadcastId, audience.length);
  if (!claimed) {
    const fresh = await getBroadcast(id, broadcastId);
    if (fresh?.status === "sent") {
      return json(
        { ok: true, sentCount: fresh.sentCount ?? 0, alreadySent: true },
        200,
      );
    }
    return json({ error: "in_progress" }, 409);
  }

  if (audience.length === 0) {
    await markBroadcastSent(broadcastId, { sentCount: 0, failedCount: 0 });
    return json({ ok: true, sentCount: 0, failedCount: 0 }, 200);
  }

  // Charge the budget up-front (abuse-safe; the pre-flight guarantees room).
  await recordEmailCapUnits(id, audience.length);

  const baseHost = process.env.PUBLISH_BASE_HOST?.trim() || "openlen.com";
  try {
    const { accepted, failed } = await runBroadcastSend({
      broadcastId,
      projectId: id,
      sub: project.subdomain,
      baseUrl: `https://${project.subdomain}.${baseHost}`,
      siteTitle: project.title || project.subdomain,
      locale: detectLang(project.data?.html ?? ""),
      subject: broadcast.subject,
      body: broadcast.body,
      audience,
    });
    await markBroadcastSent(broadcastId, {
      sentCount: accepted,
      failedCount: failed,
    });
    return json({ ok: true, sentCount: accepted, failedCount: failed }, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markBroadcastFailed(broadcastId, message).catch(() => {});
    // eslint-disable-next-line no-console
    console.error("[broadcast] send failed", broadcastId, message);
    return json({ error: "send_failed" }, 502);
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
