// One recorder per turn (layer 0 of Len 3.1, spec local
// 2026-10-24-len-3-1-layers-0-1, §4.4): it turns the brain's `onCall` reports and
// the loop's tool batches into step rows, runs the cache-break detector against
// the previous call of the same kind (the previous turn's last one for the first
// call), and writes everything once, when the turn ends. Nothing here may throw
// into the turn or make it wait: the baseline is loaded in the background and a
// call that arrives before it simply has nothing to compare with.
import { randomUUID } from "node:crypto";

import type { BrainCall } from "@/lib/agent/brain";
import { detectCacheBreak, DEFAULT_PROVIDER_CACHE_TTL_MS, type CacheBreak, type CallKind, type CallSnapshot } from "./cache-break";
import { fingerprintWire, type RequestFingerprint } from "./request-fingerprint";
import { repeatSignals, type RepeatSignals, type ToolOutcomeSummary } from "./step-signals";
import type { StepRow, StepStore } from "./step-store";

export interface StepRecorder {
  onCall(call: BrainCall): void;
  onStepTools(batch: readonly ToolOutcomeSummary[]): void;
  onCompaction(): void;
  finish(end: { readonly endReason: string }): void;
}

interface Pending {
  readonly call: BrainCall;
  readonly step: number;
  readonly fingerprint: RequestFingerprint;
  readonly turnFirstMessageCount: number;
  readonly cacheBreak: CacheBreak | null;
  tools: ToolOutcomeSummary[];
  repeats: RepeatSignals;
}

const KINDS: readonly CallKind[] = ["loop", "closeOut"];

export function formatCacheBreak(projectId: string, turnId: string, step: number, kind: CallKind, provider: string, b: CacheBreak): string {
  const first = b.firstChangedIndex !== undefined ? `@first=${b.firstChangedIndex}` : "";
  return `[cache-break] proj=${projectId} turn=${turnId} step=${step} kind=${kind} causes=${b.causes.join(",")}${first} cached ${b.prevCached}→${b.cached} provider=${provider}`;
}

export function createStepRecorder(o: {
  readonly projectId: string;
  readonly turnId: string;
  readonly hasHistory: boolean;
  readonly store: StepStore;
  readonly log: (line: string) => void;
  readonly ttlMs?: number;
}): StepRecorder {
  const ttlMs = o.ttlMs ?? DEFAULT_PROVIDER_CACHE_TTL_MS;
  const prev = new Map<CallKind, CallSnapshot | null>();
  const firstCount = new Map<CallKind, number>();
  const compacted = new Map<CallKind, boolean>();
  const pending: Pending[] = [];
  const history: ToolOutcomeSummary[][] = [];
  let step = 0;
  let finished = false;

  const guard = (what: string, fn: () => void) => {
    try {
      fn();
    } catch (err) {
      try {
        o.log(`[steps] ${what} failed: ${err instanceof Error ? err.message : String(err)}`);
      } catch {}
    }
  };

  if (o.hasHistory) {
    for (const kind of KINDS) {
      guard("baseline", () => {
        o.store
          .loadBaseline(o.projectId, kind)
          .then((snapshot) => {
            // A call of this turn already took the place of the baseline.
            if (!prev.has(kind)) prev.set(kind, snapshot);
          })
          .catch(() => {});
      });
    }
  }

  return {
    onCall(call) {
      guard("onCall", () => {
        if (finished || !call.wire) return;
        const fingerprint = fingerprintWire(call.wire);
        if (!firstCount.has(call.kind)) firstCount.set(call.kind, fingerprint.messageCount);
        const snapshot: CallSnapshot = {
          turnId: o.turnId,
          step,
          kind: call.kind,
          provider: call.provider,
          model: call.model,
          effort: call.effort,
          endedAt: call.startedAt + call.durationMs,
          cachedTokens: call.usage?.cachedTokens ?? 0,
          fingerprint,
          turnFirstMessageCount: firstCount.get(call.kind)!,
        };
        const cacheBreak = call.usage
          ? detectCacheBreak(prev.get(call.kind) ?? null, snapshot, { ttlMs, compactedSincePrev: compacted.get(call.kind) ?? false })
          : null;
        // A failed attempt (no usage) gets its row but is not what the next call is compared with.
        if (call.usage) {
          prev.set(call.kind, snapshot);
          compacted.set(call.kind, false);
        }
        if (cacheBreak) o.log(formatCacheBreak(o.projectId, o.turnId, step, call.kind, call.provider, cacheBreak));
        pending.push({
          call,
          step,
          fingerprint,
          turnFirstMessageCount: snapshot.turnFirstMessageCount!,
          cacheBreak,
          tools: [],
          repeats: repeatSignals(history),
        });
        step++;
      });
    },
    onStepTools(batch) {
      guard("onStepTools", () => {
        const last = pending.at(-1);
        if (finished || !last) return;
        history.push([...batch]);
        last.tools.push(...batch);
        last.repeats = repeatSignals(history);
      });
    },
    onCompaction() {
      guard("onCompaction", () => {
        for (const kind of KINDS) compacted.set(kind, true);
      });
    },
    finish(end) {
      guard("finish", () => {
        if (finished) return;
        finished = true;
        const lastOfKind = new Map<CallKind, number>();
        // The baseline of the next turn: the last call of each kind that the provider answered.
        pending.forEach((p, i) => {
          if (p.call.usage || !lastOfKind.has(p.call.kind)) lastOfKind.set(p.call.kind, i);
        });
        const rows: StepRow[] = pending.map((p, i) => ({
          id: randomUUID(),
          projectId: o.projectId,
          turnId: o.turnId,
          step: p.step,
          kind: p.call.kind,
          provider: p.call.provider,
          model: p.call.model,
          effort: p.call.effort,
          startedAt: new Date(p.call.startedAt),
          durationMs: Math.round(p.call.durationMs),
          inputTokens: p.call.usage?.inputTokens ?? null,
          cachedTokens: p.call.usage?.cachedTokens ?? null,
          outputTokens: p.call.usage?.outputTokens ?? null,
          reasoningTokens: p.call.usage?.thinkingTokens ?? null,
          systemHash: p.fingerprint.systemHash,
          toolsHash: p.fingerprint.toolsHash,
          prefixHash: p.fingerprint.prefixHash,
          messageCount: p.fingerprint.messageCount,
          turnFirstMessageCount: p.turnFirstMessageCount,
          messageHashes: lastOfKind.get(p.call.kind) === i || p.cacheBreak ? p.fingerprint.messageHashes : null,
          tools: p.tools,
          repeats: p.repeats,
          cacheBreak: p.cacheBreak,
          endReason: i === pending.length - 1 ? end.endReason : null,
        }));
        o.store.write(rows);
      });
    },
  };
}
