// Where the step rows go (layer 0 of Len 3.1, spec local
// 2026-10-24-len-3-1-layers-0-1, §4.4): written without awaiting and without ever
// throwing into a turn, pruned to 90 days by the writer itself (at most once a day
// per process — no new systemd timer), and read back as the baseline the next
// turn's first call is compared with. The real database lives in
// `step-store-db.ts`, so this file and its tests never touch one.
import type { CacheBreak, CallKind, CallSnapshot } from "./cache-break";
import type { RepeatSignals, ToolOutcomeSummary } from "./step-signals";

export interface StepRow {
  readonly id: string;
  readonly projectId: string;
  readonly turnId: string;
  readonly step: number;
  readonly kind: CallKind;
  readonly provider: string;
  readonly model: string;
  readonly effort: string | null;
  readonly startedAt: Date;
  readonly durationMs: number;
  readonly inputTokens: number | null;
  readonly cachedTokens: number | null;
  readonly outputTokens: number | null;
  readonly reasoningTokens: number | null;
  readonly systemHash: string | null;
  readonly toolsHash: string | null;
  readonly prefixHash: string;
  readonly messageCount: number;
  readonly turnFirstMessageCount: number | null;
  readonly messageHashes: readonly string[] | null;
  readonly tools: readonly ToolOutcomeSummary[];
  readonly repeats: RepeatSignals;
  readonly cacheBreak: CacheBreak | null;
  readonly endReason: string | null;
}

export interface StepStoreDb {
  insert(rows: readonly StepRow[]): Promise<void>;
  lastWithHashes(projectId: string, kind: CallKind): Promise<StepRow | null>;
  deleteOlderThan(cutoff: Date): Promise<number>;
}

export const STEP_RETENTION_MS = 90 * 24 * 60 * 60_000;
const PRUNE_EVERY_MS = 24 * 60 * 60_000;
const BASELINE_TIMEOUT_MS = 1500;

export interface StepStore {
  write(rows: readonly StepRow[]): void;
  loadBaseline(projectId: string, kind: CallKind, timeoutMs?: number): Promise<CallSnapshot | null>;
}

export function snapshotFromRow(r: StepRow): CallSnapshot {
  return {
    turnId: r.turnId,
    step: r.step,
    kind: r.kind,
    provider: r.provider,
    model: r.model,
    effort: r.effort,
    endedAt: r.startedAt.getTime() + r.durationMs,
    cachedTokens: r.cachedTokens ?? 0,
    ...(r.turnFirstMessageCount !== null ? { turnFirstMessageCount: r.turnFirstMessageCount } : {}),
    fingerprint: {
      systemHash: r.systemHash,
      toolsHash: r.toolsHash,
      messageHashes: r.messageHashes ?? [],
      prefixHash: r.prefixHash,
      messageCount: r.messageCount,
    },
  };
}

export function createStepStore(db: StepStoreDb, o: { now?: () => number; log?: (line: string) => void } = {}): StepStore {
  const now = o.now ?? Date.now;
  const log = o.log ?? ((line: string) => console.warn(line));
  let lastPrune: number | null = null;
  const fail = (what: string) => (err: unknown) => log(`[steps] ${what} failed: ${err instanceof Error ? err.message : String(err)}`);
  return {
    write(rows) {
      if (rows.length > 0) {
        try {
          db.insert(rows).catch(fail("insert"));
        } catch (err) {
          fail("insert")(err);
        }
      }
      const t = now();
      if (lastPrune === null || t - lastPrune >= PRUNE_EVERY_MS) {
        lastPrune = t;
        try {
          db.deleteOlderThan(new Date(t - STEP_RETENTION_MS)).catch(fail("prune"));
        } catch (err) {
          fail("prune")(err);
        }
      }
    },
    async loadBaseline(projectId, kind, timeoutMs = BASELINE_TIMEOUT_MS) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      });
      try {
        const row = await Promise.race([db.lastWithHashes(projectId, kind), timeout]);
        return row ? snapshotFromRow(row) : null;
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
