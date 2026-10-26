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
import type { CompactionMark } from "@/lib/agent/compaction/mark";
import { compactionMarkForStorage, historialDesdeLaBase, transcripcionParaGuardar } from "@/lib/agent/transcripcion";

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

/** Is `earlier` sent again, byte for byte on the wire, at the start of `later`? */
export function comparePrefix(earlier: readonly Message[], later: readonly Message[]): ReplayCheck {
  const index = firstPrefixMismatch(wire(earlier), wire(later));
  if (index === undefined) return { ok: true };
  const imagesOnly = firstPrefixMismatch(wire(withoutImages(earlier)), wire(withoutImages(later))) === undefined;
  return { ok: false, firstMismatch: index, cause: imagesOnly ? "images_dropped" : "bytes_differ" };
}

/** Does `lastRequest` (a request of the turn) come back as the start of what the
 *  next turn rebuilds from the saved `transcript`? */
export function checkReplay(o: {
  readonly initialMessages: readonly Message[];
  readonly lastRequest: readonly Message[];
  readonly transcript: readonly Message[];
  readonly leidos: Leidos;
  /** A11: the turn summarized; `lastRequest` came after that summary. */
  readonly compactionMark?: CompactionMark;
  /** Where the summarizable part starts (`compaction.firstIndex`). */
  readonly firstIndex?: number;
}): ReplayCheck {
  const saved = jsonbRoundTrip(transcripcionParaGuardar(o.transcript, o.leidos));
  if (o.compactionMark) {
    // The next turn rebuilds from the stored mark and the tail of the transcript.
    const mark = jsonbRoundTrip(compactionMarkForStorage(o.compactionMark));
    const stored = historialDesdeLaBase([{ userText: "", assistantReasoning: "", transcript: saved, compaction: mark }]) as Message[];
    return comparePrefix(o.lastRequest, [...o.initialMessages.slice(0, o.firstIndex ?? 2), ...stored]);
  }
  // The row's own user message comes first; the loop's messages follow it.
  const stored = historialDesdeLaBase([{ userText: "", assistantReasoning: "", transcript: saved }]).slice(1) as Message[];
  return comparePrefix([...o.initialMessages, ...o.lastRequest.slice(o.initialMessages.length)], [...o.initialMessages, ...stored]);
}

/**
 * Wraps the loop so that every turn a test runs also proves the invariant: each
 * request sent through `openStream` must replay from the saved transcript; after
 * a summary (A11), from the saved compaction mark and the transcript's tail. The
 * requests before a compaction, or after one that only pruned, are not checked:
 * the turn rewrote that history on purpose. Two requests are not part of the conversation and are not checked:
 * the closing call (`closeOut`), whose last user message is the cap notice the
 * transcript does not keep, and the compaction summary, which goes through
 * `openStream` with the summary instruction as its last message.
 */
export function withReplayInvariant(run: typeof runAgentLoop, o: { readonly allow?: readonly ReplayAllowance[] } = {}): typeof runAgentLoop {
  const allow = new Set<ReplayAllowance>(o.allow ?? ["images_dropped"]);
  return async (args: AgentLoopArgs): Promise<AgentLoopResult> => {
    // Each request with how many compactions came before it. A11: the ones after
    // the LAST summary must replay from the mark; the ones before a compaction
    // (or after a prune-only one) are not what the next turn rebuilds.
    const requests: { messages: Message[]; compactionsBefore: number }[] = [];
    let compactions = 0;
    let lastSummaryAt = -1;
    const result = await run({
      ...args,
      openStream: (messages) => {
        if (messages.at(-1)?.content !== COMPACTION_INSTRUCTION) requests.push({ messages: structuredClone(messages), compactionsBefore: compactions });
        return args.openStream(messages);
      },
      emit: (ev) => {
        if (ev.type === "compaction") {
          compactions += 1;
          if (ev.summarized) lastSummaryAt = compactions;
        }
        args.emit(ev);
      },
    });
    if (!result.transcripcion) return result;
    requests.forEach(({ messages: request, compactionsBefore }, n) => {
      const afterSummary = compactionsBefore > 0 && compactionsBefore === lastSummaryAt && result.compactionMark !== undefined;
      if (compactions > 0 && !afterSummary) return;
      const check = checkReplay({
        initialMessages: args.messages,
        lastRequest: request,
        transcript: result.transcripcion!,
        leidos: new Map(),
        ...(afterSummary ? { compactionMark: result.compactionMark, firstIndex: args.compaction?.firstIndex } : {}),
      });
      if (check.ok || (check.cause && check.cause !== "bytes_differ" && allow.has(check.cause))) return;
      throw new Error(
        `replay invariant: request ${n} does not replay from the saved transcript (message ${check.firstMismatch}, ${check.cause})`,
      );
    });
    return result;
  };
}
