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
import { runBroadcastSend, withBroadcastSlot } from "@/lib/broadcast/send";
import { isBroadcastPostalConfigured } from "@/lib/broadcast/render";

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
  // CAN-SPAM: never send on the placeholder postal address in production.
  if (!isBroadcastPostalConfigured()) {
    // eslint-disable-next-line no-console
    console.error(
      "[broadcast] BROADCAST_POSTAL_ADDRESS is not set — refusing to send a marketing email without a compliant postal address.",
    );
    return json({ error: "not_configured" }, 503);
  }

  const broadcast = await getBroadcast(id, broadcastId);
  if (!broadcast) return json({ error: "not_found" }, 404);
  if (broadcast.status === "sent") {
    return json(
      { ok: true, sentCount: broadcast.sentCount ?? 0, alreadySent: true },
      200,
    );
  }
  // Whether THIS attempt is the original (fresh) one or a stale-crash
  // recovery — only the fresh one charges the budget (recovery was already
  // charged on its first attempt; charging again is the double-charge bug).
  const priorStatus = broadcast.status; // 'draft' | 'failed' | 'sending'(stale)

  const baseHost = process.env.PUBLISH_BASE_HOST?.trim() || "openlen.com";
  const plan = await getUserPlan(session.user.id);

  // The whole budget-critical section runs single-flight so two different
  // broadcasts on the same project can't both pass the cap check and both
  // charge (parallel-drafts overspend). The atomic claim still guards the
  // SAME broadcast from running twice.
  const result = await withBroadcastSlot(async (): Promise<{
    status: number;
    body: Record<string, unknown>;
  }> => {
    // Resolve audience INSIDE the lock so unsubscribes during the wait count.
    const audience = await resolveBroadcastAudience(id);

    // CAP — all-or-nothing. Block (no status change) if it would overshoot.
    const usage = await getUsage(broadcastEmailCapKey(id), broadcastCapWindows(plan));
    const remaining = usage[0]?.remaining ?? 0;
    if (audience.length > remaining) {
      return {
        status: 402,
        body: { error: "cap", remaining, audienceCount: audience.length },
      };
    }

    // Atomic claim — only one send per broadcast; fresh 'sending' → 409.
    const claimed = await claimBroadcastForSending(broadcastId, audience.length);
    if (!claimed) {
      const fresh = await getBroadcast(id, broadcastId);
      if (fresh?.status === "sent") {
        return { status: 200, body: { ok: true, sentCount: fresh.sentCount ?? 0, alreadySent: true } };
      }
      return { status: 409, body: { error: "in_progress" } };
    }

    if (audience.length === 0) {
      await markBroadcastSent(broadcastId, { sentCount: 0, failedCount: 0 });
      return { status: 200, body: { ok: true, sentCount: 0, failedCount: 0 } };
    }

    // Charge ONLY on a fresh send (draft/failed). A stale-sending recovery
    // was already charged on its first attempt — re-charging is the bug.
    if (priorStatus === "draft" || priorStatus === "failed") {
      await recordEmailCapUnits(id, audience.length);
    }

    let accepted: number;
    let failed: number;
    try {
      const r = await runBroadcastSend({
        broadcastId,
        projectId: id,
        sub: project.subdomain!,
        baseUrl: `https://${project.subdomain}.${baseHost}`,
        siteTitle: project.title || project.subdomain!,
        locale: detectLang(project.data?.html ?? ""),
        subject: broadcast.subject,
        body: broadcast.body,
        audience,
      });
      accepted = r.accepted;
      failed = r.failed;
    } catch (err) {
      // Genuine delivery failure — mark failed so the owner can retry.
      const message = err instanceof Error ? err.message : String(err);
      await markBroadcastFailed(broadcastId, message).catch(() => {});
      // eslint-disable-next-line no-console
      console.error("[broadcast] send failed", broadcastId, message);
      return { status: 502, body: { error: "send_failed" } };
    }

    // Delivery SUCCEEDED. If the status write fails, the emails are already
    // out — do NOT flip to 'failed' (that would resend on retry). Leave it
    // 'sending'; stale-recovery + idempotency + the fresh-only charge make a
    // later retry safe and free.
    const marked = await markBroadcastSent(broadcastId, {
      sentCount: accepted,
      failedCount: failed,
    }).catch(() => false);
    if (!marked) {
      // eslint-disable-next-line no-console
      console.error(
        "[broadcast] delivered but failed to mark sent (left 'sending'; safe to retry)",
        broadcastId,
      );
    }
    return { status: 200, body: { ok: true, sentCount: accepted, failedCount: failed } };
  });

  return json(result.body, result.status);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
