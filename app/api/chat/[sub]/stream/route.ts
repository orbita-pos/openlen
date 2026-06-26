import { randomUUID } from "node:crypto";
import { hub } from "@/lib/chat/hub";
import type { HubEvent } from "@/lib/chat/hub";
import { getConversationForUser, listMessagesSince } from "@/lib/chat/store";
import { json, loadChatSite, requireChatSession } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ENCODER = new TextEncoder();

export async function GET(
  req: Request,
  { params }: { params: Promise<{ sub: string }> },
): Promise<Response> {
  const { sub } = await params;

  const site = await loadChatSite(sub);
  if (!site || !site.chatEnabled) return json({ error: "not_found" }, 404);

  const session = await requireChatSession(req, site.projectId);
  if (!session) return json({ error: "unauthorized" }, 401);

  const url = new URL(req.url);
  const conversationId = url.searchParams.get("conversationId") ?? "";
  const since = url.searchParams.get("since") ?? null;

  const convo = await getConversationForUser(site.projectId, conversationId, session.user.id);
  if (!convo) return json({ error: "not_found" }, 404);

  const userId = session.user.id;
  const { projectId } = site;

  // Shared cleanup handle so both cancel() and req.signal "abort" converge.
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
        hub.publish(conversationId, { type: "presence", userId, online: false });
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      cleanupFn = cleanup;

      hub.markOnline(projectId, userId);

      // Backfill messages the client missed (since cursor)
      const backfill = await listMessagesSince(conversationId, since);
      for (const m of backfill) {
        emit("message", { type: "message", message: m });
      }

      // Announce this user is online to the other participant
      hub.publish(conversationId, { type: "presence", userId, online: true });

      // Subscribe to live hub events for this conversation
      off = hub.subscribe(conversationId, {
        id: randomUUID(),
        userId,
        send: (evt: HubEvent) => emit(evt.type, evt),
      });

      // 25s comment keepalive so Caddy / proxies don't close the idle connection
      keepaliveId = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(ENCODER.encode(": keepalive\n\n"));
        } catch {
          /* ignore */
        }
      }, 25_000);

      // Wire HTTP-level abort (client navigates away, connection reset, etc.)
      req.signal.addEventListener("abort", cleanup, { once: true });
    },

    cancel() {
      // Called when the ReadableStream is cancelled by the runtime (client disconnects).
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
