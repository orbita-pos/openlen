// One recorder per turn (layer 0 of Len 3.1, spec local
// 2026-10-24-len-3-1-layers-0-1, §4.4): it turns the brain's `onCall` reports and
// the loop's tool batches into step rows, runs the cache-break detector against
// the previous call of the same kind (the previous turn's last one for the first
// call), and writes each row as it happens: when its call ends, again when its
// tools answer, and the turn's end. Like Claude Code's telemetry (an event per API
// call, sent as it goes) and DeepSeek's durable log: a deploy that kills the turn
// leaves the calls it already made. Nothing here may throw into the turn or make it
// wait: the baseline is loaded in the background and a call that arrives before it
// simply has nothing to compare with.
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
  /** Resolves once every row handed to the store is written (the process is about to exit). */
  flush(): Promise<void>;
}

interface Pending {
  readonly id: string;
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
  /** Los Read del turno por fichero (hash de la ruta → hashes de sus argumentos), hasta que se escribe en él. */
  const lecturas = new Map<string, Set<string>>();
  const conRelecturas = (batch: readonly ToolOutcomeSummary[]): ToolOutcomeSummary[] =>
    batch.map((t) => {
      if (!t.pathHash) return t;
      if (t.name !== "Read") {
        lecturas.delete(t.pathHash);
        return t;
      }
      const vistas = lecturas.get(t.pathHash) ?? new Set<string>();
      lecturas.set(t.pathHash, vistas);
      if (vistas.has(t.argsHash)) return { ...t, reread: true as const };
      vistas.add(t.argsHash);
      return t;
    });
  let step = 0;
  let finished = false;

  /** A row as it stands now. Hashes only on the last call of each kind the provider answered (the
   *  next turn's baseline) and on broken calls; the end reason only on the turn's last row. */
  const rowsNow = (endReason: string | null): StepRow[] => {
    const lastOfKind = new Map<CallKind, number>();
    pending.forEach((p, i) => {
      if (p.call.usage || !lastOfKind.has(p.call.kind)) lastOfKind.set(p.call.kind, i);
    });
    return pending.map((p, i) => ({
      id: p.id,
      projectId: o.projectId,
      turnId: o.turnId,
      step: p.step,
      kind: p.call.kind,
      provider: p.call.provider,
      model: p.call.model,
      effort: p.call.effort,
      startedAt: new Date(p.call.startedAt),
      durationMs: Math.round(p.call.durationMs),
      firstByteMs: p.call.firstEventMs == null ? null : Math.round(p.call.firstEventMs),
      longestGapMs: p.call.longestGapMs == null ? null : Math.round(p.call.longestGapMs),
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
      tools: [...p.tools],
      repeats: p.repeats,
      cacheBreak: p.cacheBreak,
      endReason: i === pending.length - 1 ? endReason : null,
    }));
  };

  // What changes in a row after its first write: its tools (and with them its repeats), whether it
  // keeps the hashes, and the end reason.
  const versionOf = (r: StepRow) => `${r.tools.length}:${r.messageHashes ? 1 : 0}:${r.endReason ?? ""}`;
  const written = new Map<string, string>();
  // Claude Code's write queue: one write at a time, and what changes meanwhile goes in the next, so
  // an older copy of a row never lands after a newer one.
  const queued = new Map<string, StepRow>();
  let inFlight: Promise<void> | null = null;
  const drain = (): void => {
    if (inFlight || queued.size === 0) return;
    const rows = [...queued.values()];
    queued.clear();
    let sent: Promise<void>;
    try {
      sent = Promise.resolve(o.store.write(rows));
    } catch {
      sent = Promise.resolve();
    }
    inFlight = sent
      .catch(() => {})
      .finally(() => {
        inFlight = null;
        drain();
      });
  };
  const persist = (endReason: string | null): void => {
    for (const r of rowsNow(endReason)) {
      const v = versionOf(r);
      if (written.get(r.id) === v) continue;
      written.set(r.id, v);
      queued.set(r.id, r);
    }
    drain();
  };

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
          id: randomUUID(),
          call,
          step,
          fingerprint,
          turnFirstMessageCount: snapshot.turnFirstMessageCount!,
          cacheBreak,
          tools: [],
          repeats: repeatSignals(history),
        });
        step++;
        persist(null);
      });
    },
    onStepTools(batch) {
      guard("onStepTools", () => {
        const last = pending.at(-1);
        if (finished || !last) return;
        const marcado = conRelecturas(batch);
        history.push(marcado);
        last.tools.push(...marcado);
        last.repeats = repeatSignals(history);
        persist(null);
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
        persist(end.endReason);
      });
    },
    async flush() {
      while (inFlight) await inFlight;
    },
  };
}
