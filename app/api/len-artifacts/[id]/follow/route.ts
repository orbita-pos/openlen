// ─────────────────────────────────────────────────────────────────────────────
// GET /api/len-artifacts/[id]/follow — every open screen follows one tool's data (spec local
// 2026-11-22-artifacts-de-len, §4), the way DeepSeek's screens follow a session: ONE connection per open tool; on
// opening a complete baseline, then each change as it happens, and on reconnect the baseline again. What the agent writes
// with `artifact_data` and what the person changes on another screen (the phone and the web at once) show up without reloading.
//
//   event: baseline   data: {"kind":"baseline","docs":[…]}
//   event: change     data: {"kind":"change","by":"agent"|"person","docs":[…],"deleted":[{"collection","docId"}]}
//   event: gone       data: {}          ← the person deleted the tool; the stream ends
//   : keepalive                         ← every 25 s, so no proxy closes an idle stream
//
// The data of each event is the bridge's `data.changed` params, byte for byte (`lib/tools/bridge/protocol.ts`): the screen that
// frames the tool forwards it untouched. A screen that loses the stream reconnects and is given the baseline again.
//
// 🔴 It tells what is STORED, never what a writer meant to store. A change on the bus names documents; this route reads them
// again from the store and sends those values — a document that isn't there any more goes in `deleted`. Two writers to one
// document can publish out of the order they committed in, and only a re-read makes the stream's last word the stored one.
// Reads and events go through one queue, so a slow read never lets a later change overtake an earlier one; and a read that fails
// closes the stream — a screen that missed a change must not carry on as if it hadn't — so it reconnects for a whole baseline.
//
// It subscribes to the bus BEFORE it reads the baseline (as `app/api/inbox/[conversationId]/stream/route.ts` does for the chat):
// a write that lands while the baseline is read is queued behind it and told after it, never lost.
//
// 🔴 The tool's owner only — the person's session or the phone's key, which comes in an `authorization` header (the phone reads
// the stream with a fetch reader, so this can't depend on a cookie) — and ONE 404 for everything else: the tools are off, nobody
// is signed in, there is no such tool, it is another person's. No plan check, no credits. What is in the database is DATA.
// ─────────────────────────────────────────────────────────────────────────────
import { subscribeArtifactChanges, type LenArtifactChange } from "@/lib/len-artifacts/bus";
import { lenArtifactsEnabled } from "@/lib/len-artifacts/enabled";
import { lenArtifactById, readDocs, readDocsByKeys } from "@/lib/len-artifacts/store";
import type { DataChangedParams } from "@/lib/tools/bridge/protocol";
import { toBridgeDoc } from "@/lib/len-artifacts/wire";
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";
import { usuarioDeLaPeticion } from "@/lib/movil/quien";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ENCODER = new TextEncoder();
const KEEPALIVE_MS = 25_000;
/** The most a screen may leave unread before its stream is closed: more than two whole baselines of a full tool (5 MB of
 *  data each). A screen that stopped reading would otherwise keep every change in this process's memory; closed, it
 *  reconnects when it can and gets one fresh baseline — a slow follower is dropped, never waited for (DeepSeek's follow). */
export const FOLLOW_UNREAD_MAX_BYTES = 16 * 1024 * 1024;

const notFound = () =>
  new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { "content-type": "application/json", "cache-control": "no-store" } });

type Key = { collection: string; docId: string };
const keyOf = (k: Key) => JSON.stringify([k.collection, k.docId]);

/** Follows one tool on behalf of one screen, writing to `controller` until the screen goes away, the tool is deleted or a
 *  read fails. Returns what stops it. */
function follow(toolId: string, controller: ReadableStreamDefaultController<Uint8Array>, signal: AbortSignal): () => void {
  let closed = false;
  let off: (() => void) | undefined;
  let keepalive: ReturnType<typeof setInterval> | undefined;

  const stop = () => {
    if (closed) return;
    closed = true;
    if (keepalive !== undefined) clearInterval(keepalive);
    signal.removeEventListener("abort", stop);
    off?.();
    try {
      controller.close();
    } catch {
      // already closed (the screen cancelled it)
    }
  };

  const send = (chunk: string) => {
    if (closed) return;
    try {
      controller.enqueue(ENCODER.encode(chunk));
    } catch {
      stop();
      return;
    }
    // The queue counts bytes (see the stream's strategy): past the cap the screen isn't reading, so it is let go.
    const unread = controller.desiredSize === null ? 0 : -controller.desiredSize;
    if (unread > FOLLOW_UNREAD_MAX_BYTES) stop();
  };
  const event = (name: string, data: unknown) => send(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);

  // One queue: the baseline first, then each change or the end, in the order the bus gave them.
  let queue: Promise<void> = Promise.resolve();
  const enqueue = (job: () => Promise<void>) => {
    queue = queue
      .then(() => (closed ? undefined : job()))
      .catch((err: unknown) => {
        // A read that fails ends the stream: the screen reconnects for a baseline. Said here, so an outage shows.
        console.warn("[len-artifacts] follow closed", toolId, err);
        stop();
      });
  };

  const baseline = async () => {
    // A tool deleted between the check that let this screen in and the subscription below would never be told.
    if (!(await lenArtifactById(toolId))) {
      event("gone", {});
      stop();
      return;
    }
    const docs = await readDocs(toolId);
    event("baseline", { kind: "baseline", docs: docs.map(toBridgeDoc) } satisfies DataChangedParams);
  };

  const change = async (c: LenArtifactChange) => {
    const keys = new Map<string, Key>();
    for (const k of [...c.docs, ...c.deleted]) keys.set(keyOf(k), { collection: k.collection, docId: k.docId });
    if (keys.size === 0) return;
    const stored = await readDocsByKeys(toolId, [...keys.values()]);
    const there = new Set(stored.map(keyOf));
    const deleted = [...keys].filter(([key]) => !there.has(key)).map(([, k]) => k);
    event("change", { kind: "change", by: c.by, docs: stored.map(toBridgeDoc), deleted } satisfies DataChangedParams);
  };

  if (signal.aborted) {
    stop();
    return stop;
  }
  signal.addEventListener("abort", stop, { once: true });
  keepalive = setInterval(() => send(": keepalive\n\n"), KEEPALIVE_MS);
  off = subscribeArtifactChanges(
    toolId,
    (c) => enqueue(() => change(c)),
    () =>
      enqueue(async () => {
        event("gone", {});
        stop();
      }),
  );
  enqueue(baseline);
  return stop;
}

export const GET = paraLaApp(async (req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> => {
  if (!lenArtifactsEnabled()) return notFound();
  const userId = await usuarioDeLaPeticion(req);
  if (!userId) return notFound();
  const { id } = await params;
  const tool = await lenArtifactById(id);
  if (!tool || tool.personId !== userId) return notFound();

  let stop: (() => void) | undefined;
  const stream = new ReadableStream<Uint8Array>(
    {
      start(controller) {
        stop = follow(tool.id, controller, req.signal);
      },
      cancel() {
        stop?.();
      },
    },
    // Bytes, not chunks: `desiredSize` is then minus what the screen hasn't read yet.
    { highWaterMark: 0, size: (chunk) => chunk.byteLength },
  );

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
});

export const OPTIONS = respuestaPrevia;
