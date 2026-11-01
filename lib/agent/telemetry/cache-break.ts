// The cache-break detector (layer 0 of Len 3.1, spec local
// 2026-10-24-len-3-1-layers-0-1, §4.2), after Claude Code's cache-break warning:
// when a call reads clearly less from the provider's cache than
// the previous call of the same kind, name why, with the same vocabulary.
import type { RequestFingerprint } from "./request-fingerprint";

export type CallKind = "loop" | "closeOut";

export type CacheBreakCause =
  | "provider_changed"
  | "model_changed"
  | "effort_changed"
  | "system_changed"
  | "tools_changed"
  | "compaction"
  | "messages_rewritten"
  | "ttl_expired"
  | "likely_server_side"
  | "unknown";

export interface CallSnapshot {
  readonly turnId: string;
  readonly step: number;
  readonly kind: CallKind;
  readonly provider: string;
  readonly model: string;
  readonly effort: string | null;
  readonly endedAt: number;
  readonly cachedTokens: number;
  readonly fingerprint: RequestFingerprint;
  /** The messageCount of this turn's first call of the same kind: what tells the
   *  next turn which turn owns a changed message. */
  readonly turnFirstMessageCount?: number;
}

export interface CacheBreak {
  readonly causes: readonly CacheBreakCause[];
  readonly firstChangedIndex?: number;
  readonly changedOwner?: { readonly turnId: string; readonly positionInTurn: number } | "earlier";
  readonly prevCached: number;
  readonly cached: number;
}

export const CACHE_BREAK_MIN_TOKENS = 2048;
export const CACHE_BREAK_MIN_RATIO = 0.02;
/** A placeholder until measured: on 23/10 a turn 50 min after the previous one
 *  still read 99 % from DeepInfra's cache. */
export const DEFAULT_PROVIDER_CACHE_TTL_MS = 60 * 60_000;

function firstDifference(a: readonly string[], b: readonly string[]): number | undefined {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return undefined;
}

export function detectCacheBreak(
  prev: CallSnapshot | null,
  cur: CallSnapshot,
  opts: { readonly ttlMs: number; readonly compactedSincePrev: boolean },
): CacheBreak | null {
  if (!prev || prev.kind !== cur.kind) return null;
  const drop = prev.cachedTokens - cur.cachedTokens;
  if (drop <= CACHE_BREAK_MIN_TOKENS || drop <= prev.cachedTokens * CACHE_BREAK_MIN_RATIO) return null;

  const causes: CacheBreakCause[] = [];
  if (prev.provider !== cur.provider) causes.push("provider_changed");
  if (prev.model !== cur.model) causes.push("model_changed");
  if (prev.effort !== cur.effort) causes.push("effort_changed");
  if (prev.fingerprint.systemHash !== cur.fingerprint.systemHash) causes.push("system_changed");
  if (prev.fingerprint.toolsHash !== cur.fingerprint.toolsHash) causes.push("tools_changed");
  if (opts.compactedSincePrev) causes.push("compaction");
  const index = firstDifference(prev.fingerprint.messageHashes, cur.fingerprint.messageHashes);
  const shortened = index === undefined && cur.fingerprint.messageHashes.length < prev.fingerprint.messageHashes.length;
  const rewritten = index !== undefined || shortened;
  if (rewritten) causes.push("messages_rewritten");

  if (causes.length === 0) {
    causes.push(cur.endedAt - prev.endedAt > opts.ttlMs ? "ttl_expired" : "likely_server_side");
  }

  const changedAt = index ?? (shortened ? cur.fingerprint.messageHashes.length : undefined);
  const ownStart = prev.turnFirstMessageCount !== undefined ? prev.turnFirstMessageCount - 1 : undefined;
  return {
    causes,
    ...(rewritten && changedAt !== undefined ? { firstChangedIndex: changedAt } : {}),
    ...(rewritten && changedAt !== undefined && ownStart !== undefined
      ? { changedOwner: changedAt >= ownStart ? { turnId: prev.turnId, positionInTurn: changedAt - ownStart } : ("earlier" as const) }
      : {}),
    prevCached: prev.cachedTokens,
    cached: cur.cachedTokens,
  };
}
