// lib/agent/retry.ts — bounded stream-open retry for the agent route.
//
// Gemini occasionally returns transient 503 "high demand" spikes. The eval
// harness already rides these out (runLoopWithRetry); production did NOT — a
// single spike surfaced to the user as "El modelo tuvo un problema". This wraps
// a model stream so a retryable error thrown BEFORE any event is yielded re-opens
// the stream (safe: the model produced nothing yet). A failure AFTER the first
// event propagates unchanged — re-running a partially-consumed turn would
// double-apply tool calls, so mid-stream errors are never retried.
//
// Only `import type` from @/lib/ai-gateway (no value import) so this stays
// loadable by vitest without the native @openlen/ai-gateway .node binding —
// same constraint as loop.ts. isRetryable duck-types the error instead of
// `instanceof GatewayError` for exactly that reason.
import type { StreamEvent } from "@/lib/ai-gateway";

const RETRYABLE_RE =
  /\b50[234]\b|unavailable|overloaded|high demand|deadline|timeout|econnreset|etimedout|fetch failed|socket hang up/i;

/** A transient, safe-to-retry upstream failure. GatewayError carries an explicit
 *  `retryable` flag (duck-typed here); everything else falls back to a message
 *  regex covering the 502/503/504 + network-reset family. */
export function isRetryableStreamError(err: unknown): boolean {
  const e = err as { retryable?: unknown; message?: unknown } | null;
  if (e && e.retryable === true) return true;
  return RETRYABLE_RE.test(String(e?.message ?? err));
}

export interface StreamRetryOptions {
  attempts?: number; // total tries incl. the first (default 5)
  baseMs?: number; // exponential backoff base (default 1000)
  signal?: { readonly aborted: boolean; addEventListener?: (t: "abort", cb: () => void, o?: { once?: boolean }) => void };
  /** Injectable for tests — real sleep by default, abort-aware. */
  sleep?: (ms: number) => Promise<void>;
}

function abortAwareSleep(ms: number, signal?: StreamRetryOptions["signal"]): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener?.(
      "abort",
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}

/** Wrap a stream factory with a bounded, open-only retry. Re-opens `open()` on a
 *  retryable error ONLY while no event has been yielded yet; once the stream has
 *  produced anything, an error propagates (no double-execution). Honors an abort
 *  signal — a retry is never scheduled once aborted, so the caller's overall
 *  timeout still bounds total lifetime. */
export async function* streamWithRetry(
  open: () => AsyncIterable<StreamEvent>,
  opts: StreamRetryOptions = {},
): AsyncIterable<StreamEvent> {
  const attempts = opts.attempts ?? 5;
  const baseMs = opts.baseMs ?? 1000;
  const sleep = opts.sleep ?? ((ms: number) => abortAwareSleep(ms, opts.signal));

  for (let attempt = 1; ; attempt++) {
    let yielded = false;
    try {
      for await (const ev of open()) {
        yielded = true;
        yield ev;
      }
      return;
    } catch (err) {
      const canRetry =
        !yielded &&
        attempt < attempts &&
        !opts.signal?.aborted &&
        isRetryableStreamError(err);
      if (!canRetry) throw err;
      await sleep(baseMs * 2 ** (attempt - 1) + Math.random() * 300);
    }
  }
}
