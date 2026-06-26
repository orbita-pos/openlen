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
        hub.publish(conversationId, { type: "presence", userId, online: false });
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
        // Staff-only events (internal team routing) must never cross the
        // visitor trust boundary — they carry platform user ids + account names.
        if (evt.type === "assignment") return;
        if (evt.type === "message") {
          if (seen.has(evt.message.id)) return;
          seen.add(evt.message.id);
        }
        emit(evt.type, evt);
      };

      off = hub.subscribe(conversationId, {
        id: randomUUID(),
        userId,
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

      // Snapshot the owner's current online state so the widget shows the
      // correct dot immediately, before the next presence event arrives.
      emit("presence", { type: "presence", userId: convo.otherUserId, online: hub.isUserOnline(site.projectId, site.userId) });

      // Flush live events that arrived during backfill, deduped via seen.
      buffering = false;
      for (const evt of pending) emitEvent(evt);

      // Announce this user is online AFTER the stream is ready so the peer
      // doesn't receive a presence event before messages are in order.
      hub.publish(conversationId, { type: "presence", userId, online: true });

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
