// The replay invariant (layer 1 of Len 3.1, spec local
// 2026-10-24-len-3-1-layers-0-1, §5.1), after DeepSeek's «reconstructable
// requests»: what the model saw during a turn must come back BYTE FOR BYTE when
// the next turn rebuilds the conversation from the saved row. Otherwise the next
// turn's first call misses the provider's cache from the first changed message
// on (the 24/10 «graciasa», 29,749 uncached tokens). Test-only code.
import type { Message } from "@/lib/ai-gateway";
import { COMPACTION_INSTRUCTION } from "@/lib/agent/compaction/summary-prompt";
import type { Leidos } from "@/lib/agent/ficheros/read";
import { messagesForFireworks } from "@/lib/agent/fireworks-bridge";
import type { AgentLoopArgs, AgentLoopResult, runAgentLoop } from "@/lib/agent/loop";
import { historialDesdeLaBase, transcripcionParaGuardar } from "@/lib/agent/transcripcion";

/**
 * What Postgres jsonb does to an object: keys ordered by UTF-8 byte length, then
 * bytewise; arrays untouched. Written again here on purpose — it must not share
 * code with `stringifyInJsonbOrder` in the bridge, or a bug in one would hide in
 * the other.
 */
export function jsonbRoundTrip<T>(value: T): T {
  const order = (a: string, b: string): number => {
    const x = Buffer.from(a, "utf8");
    const y = Buffer.from(b, "utf8");
    return x.length - y.length || Buffer.compare(x, y);
  };
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v === null || typeof v !== "object") return v;
    const record = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort(order)) out[key] = walk(record[key]);
    return out;
  };
  return walk(JSON.parse(JSON.stringify(value))) as T;
}

export type ReplayAllowance = "compaction" | "images_dropped";

export interface ReplayCheck {
  readonly ok: boolean;
  readonly firstMismatch?: number;
  readonly cause?: ReplayAllowance | "bytes_differ";
}

const wire = (messages: readonly Message[]): string[] => messagesForFireworks(messages).map((m) => JSON.stringify(m));
const withoutImages = (messages: readonly Message[]): Message[] =>
  messages.map((m) => {
    if (!m.images) return m;
    const { images: _images, ...rest } = m;
    return rest;
  });

function firstPrefixMismatch(inTurn: readonly string[], stored: readonly string[]): number | undefined {
  for (let i = 0; i < inTurn.length; i++) if (inTurn[i] !== stored[i]) return i;
  return undefined;
}

/** Does `lastRequest` (a request of the turn) come back as the start of what the
 *  next turn rebuilds from the saved `transcript`? */
export function checkReplay(o: {
  readonly initialMessages: readonly Message[];
  readonly lastRequest: readonly Message[];
  readonly transcript: readonly Message[];
  readonly leidos: Leidos;
}): ReplayCheck {
  const saved = jsonbRoundTrip(transcripcionParaGuardar(o.transcript, o.leidos));
  // The row's own user message comes first; the loop's messages follow it.
  const stored = historialDesdeLaBase([{ userText: "", assistantReasoning: "", transcript: saved }]).slice(1) as Message[];
  const inTurn = [...o.initialMessages, ...o.lastRequest.slice(o.initialMessages.length)];
  const rebuilt = [...o.initialMessages, ...stored];
  const index = firstPrefixMismatch(wire(inTurn), wire(rebuilt));
  if (index === undefined) return { ok: true };
  const imagesOnly = firstPrefixMismatch(wire(withoutImages(inTurn)), wire(withoutImages(rebuilt))) === undefined;
  return { ok: false, firstMismatch: index, cause: imagesOnly ? "images_dropped" : "bytes_differ" };
}

/**
 * Wraps the loop so that every turn a test runs also proves the invariant: each
 * request sent through `openStream` must replay from the saved transcript. A
 * `compaction` event allows a mismatch (the turn rewrote its own history on
 * purpose). Two requests are not part of the conversation and are not checked:
 * the closing call (`closeOut`), whose last user message is the cap notice the
 * transcript does not keep, and the compaction summary, which goes through
 * `openStream` with the summary instruction as its last message.
 */
export function withReplayInvariant(run: typeof runAgentLoop, o: { readonly allow?: readonly ReplayAllowance[] } = {}): typeof runAgentLoop {
  const allow = new Set<ReplayAllowance>(o.allow ?? ["images_dropped"]);
  return async (args: AgentLoopArgs): Promise<AgentLoopResult> => {
    const requests: Message[][] = [];
    let compacted = false;
    const result = await run({
      ...args,
      openStream: (messages) => {
        if (messages.at(-1)?.content !== COMPACTION_INSTRUCTION) requests.push(structuredClone(messages));
        return args.openStream(messages);
      },
      emit: (ev) => {
        if (ev.type === "compaction") compacted = true;
        args.emit(ev);
      },
    });
    if (!result.transcripcion) return result;
    requests.forEach((request, n) => {
      const check = checkReplay({ initialMessages: args.messages, lastRequest: request, transcript: result.transcripcion!, leidos: new Map() });
      if (check.ok || (check.cause && check.cause !== "bytes_differ" && allow.has(check.cause)) || compacted) return;
      throw new Error(
        `replay invariant: request ${n} does not replay from the saved transcript (message ${check.firstMismatch}, ${check.cause})`,
      );
    });
    return result;
  };
}
