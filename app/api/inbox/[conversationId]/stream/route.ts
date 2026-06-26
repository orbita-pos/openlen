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
      let closed = false;
      let keepaliveId: ReturnType<typeof setInterval> | undefined;
      let off: (() => void) | undefined;

      const emit = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            ENCODER.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          closed = true;
        }
      };

      const cleanup = () => {
        if (closed) return;
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

      // Backfill messages the owner missed
      const backfill = await listMessagesSince(conversationId, since);
      for (const m of backfill) {
        emit("message", { type: "message", message: m });
      }

      // Announce owner is online
      hub.publish(conversationId, {
        type: "presence",
        userId: ownerChatUserId,
        online: true,
      });

      off = hub.subscribe(conversationId, {
        id: randomUUID(),
        userId: ownerChatUserId,
        send: (evt: HubEvent) => emit(evt.type, evt),
      });

      keepaliveId = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(ENCODER.encode(": keepalive\n\n"));
        } catch {
          /* ignore */
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
