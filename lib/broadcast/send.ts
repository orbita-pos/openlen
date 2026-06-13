// Broadcast send orchestrator — the part that actually delivers.
//
// Runs SYNCHRONOUSLY inside the send request (≤1000 recipients = ≤10 Resend
// batch calls ≈ 1–2s), serialized box-wide by a single-flight semaphore so two
// campaigns can't spike memory at once. Deterministic delivery is the product
// promise (send to 50 → 50 sent), which is why this is NOT fire-and-forget
// like thumbnails/lighthouse. Per-chunk idempotency keys make a retry of a
// timed-out send safe — Resend dedupes the chunks that already went.

import {
  buildBroadcastEmail,
  type BroadcastEmailItem,
} from "@/lib/broadcast/render";
import { unsubscribeUrl } from "@/lib/broadcast/unsubscribe";
import { recordRecipients } from "@/lib/broadcast/store";
import type { AudienceMember } from "@/lib/broadcast/audience";
import { sendBroadcastBatch } from "@/lib/email";

const BATCH_SIZE = 100; // Resend batch.send hard cap

// Single-flight: each critical section waits for the previous to settle, so
// concurrent campaigns serialize rather than pile up. The send ROUTE wraps its
// whole budget-critical section (cap re-check → charge → deliver) in this slot
// so two different broadcasts on the same project can't both pass the cap
// check and both charge — closing the parallel-drafts overspend. Exported for
// the route; runBroadcastSend itself is slot-free so it can run inside it.
let chain: Promise<unknown> = Promise.resolve();
export function withBroadcastSlot<T>(fn: () => Promise<T>): Promise<T> {
  const result = chain.then(fn, fn);
  chain = result.catch(() => {});
  return result;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export interface BroadcastSendParams {
  broadcastId: string;
  projectId: string;
  sub: string;
  baseUrl: string; // https://<sub>.<host> — no trailing slash
  siteTitle: string;
  locale: string;
  subject: string;
  body: string;
  audience: AudienceMember[];
}

/** Deliver the campaign in ≤100-recipient batches. SLOT-FREE — the caller
 *  (send route) runs this inside withBroadcastSlot so the whole budget section
 *  serializes. Per-chunk idempotency keys make a retry of a timed-out send
 *  safe (Resend dedupes the chunks that already went). */
export async function runBroadcastSend(
  params: BroadcastSendParams,
): Promise<{ accepted: number; failed: number }> {
  let accepted = 0;
  let failed = 0;
  const chunks = chunk(params.audience, BATCH_SIZE);
  for (let i = 0; i < chunks.length; i++) {
    const group = chunks[i];
    const items: BroadcastEmailItem[] = group.map((m) => {
      const unsubUrl = unsubscribeUrl({
        baseUrl: params.baseUrl,
        sub: params.sub,
        projectId: params.projectId,
        memberId: m.memberId,
      });
      const { html, text } = buildBroadcastEmail({
        subject: params.subject,
        bodyMarkdown: params.body,
        siteTitle: params.siteTitle,
        locale: params.locale,
        unsubUrl,
      });
      return { to: m.email, subject: params.subject, html, text, unsubUrl };
    });

    const res = await sendBroadcastBatch(items, {
      idempotencyKey: `bcast:${params.broadcastId}:${i}`,
    });
    accepted += res.accepted;
    failed += res.failedIndices.length;

    const failedSet = new Set(res.failedIndices);
    await recordRecipients(
      params.broadcastId,
      group.map((m, idx) => ({
        memberId: m.memberId,
        email: m.email,
        status: failedSet.has(idx) ? "failed" : "accepted",
      })),
    );
  }
  return { accepted, failed };
}
