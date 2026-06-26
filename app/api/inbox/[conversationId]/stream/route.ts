import { randomUUID } from "node:crypto";
import { hub } from "@/lib/chat/hub";
import type { HubEvent } from "@/lib/chat/hub";
import { listMessagesSince } from "@/lib/chat/store";
import { json, requireOwnerForConversation } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ENCODER = new TextEncoder();

export async function GET(
  req: Request,
  { params }: { params: Promise<{ conversationId: string }> },
): Promise<Response> {
  const { conversationId } = await params;

  const ctx = await requireOwnerForConversation(conversationId);
  if ("error" in ctx)
    return json(
      { error: ctx.error === 401 ? "unauthorized" : "not_found" },
      ctx.error,
    );

  const url = new URL(req.url);
  const since = url.searchParams.get("since") ?? null;

  // userId = platform user id (for markOnline/markOffline presence tracking)
  // ownerChatUserId = the chat_user row for the owner (for subscription, so
  //   mine-math and presence events use the correct chat-layer identity)
  const { userId, projectId, ownerChatUserId } = ctx;

  let cleanupFn: (() => void) | undefined;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;   // Fix 2: stop emitting
      let cleaned = false;  // Fix 2: cleanup already ran
      let keepaliveId: ReturnType<typeof setInterval> | undefined;
      let off: (() => void) | undefined;

      const emit = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            ENCODER.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          // Fix 2: emit failure triggers full cleanup, not just a flag flip.
          closed = true;
          cleanup();
        }
      };

      // Fix 2: cleanup guards on `cleaned`, not `closed`, so an emit failure
      // before cancel/abort doesn't poison the cleanup path.
      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        closed = true;
        if (keepaliveId !== undefined) clearInterval(keepaliveId);
        off?.();
        hub.markOffline(projectId, userId);
        hub.publish(conversationId, {
          type: "presence",
          userId: ownerChatUserId,
          online: false,
        });
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      cleanupFn = cleanup;

      hub.markOnline(projectId, userId);

      // Fix 1: Subscribe BEFORE backfill so live events published during the
      // await are captured in the pending buffer rather than lost.
      const seen = new Set<string>();
      const pending: HubEvent[] = [];
      let buffering = true;

      const emitEvent = (evt: HubEvent) => {
        if (evt.type === "message") {
          if (seen.has(evt.message.id)) return;
          seen.add(evt.message.id);
        }
        emit(evt.type, evt);
      };

      off = hub.subscribe(conversationId, {
        id: randomUUID(),
        userId: ownerChatUserId,
        send: (evt: HubEvent) => {
          if (buffering) pending.push(evt);
          else emitEvent(evt);
        },
      });

      // Fix 3: Wrap backfill so a rejection doesn't leave presence leaked.
      try {
        const backfill = await listMessagesSince(conversationId, since);
        for (const m of backfill) emitEvent({ type: "message", message: m });
      } catch {
        cleanup();
        return;
      }

      // Flush live events that arrived during backfill, deduped via seen.
      buffering = false;
      for (const evt of pending) emitEvent(evt);

      // Announce owner is online AFTER the stream is ready so the peer
      // doesn't receive a presence event before messages are in order.
      hub.publish(conversationId, {
        type: "presence",
        userId: ownerChatUserId,
        online: true,
      });

      // 25s keepalive so Caddy / proxies don't close the idle connection.
      keepaliveId = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(ENCODER.encode(": keepalive\n\n"));
        } catch {
          // Fix 2: keepalive failure also triggers full cleanup.
          closed = true;
          cleanup();
        }
      }, 25_000);

      req.signal.addEventListener("abort", cleanup, { once: true });
    },

    cancel() {
      cleanupFn?.();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
