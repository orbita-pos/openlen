// lib/backend/split-off-thread.ts — SPLITTING MIGRATION SQL OFF THE APP'S THREAD (14/10).
//
// On 14/10 `supabase db push` hung the whole server: a catastrophic regex in the
// splitter kept the app's MAIN thread at 100% CPU forever (fixed in 2196943f).
// Nothing answered, not even the terminal's command timeout, whose answer has
// to be handled by that same blocked thread. In Claude Code a hanging command
// is its own process: its timeout kills it and the host carries on. Here the
// split runs in its own thread (`sql-split-worker.mjs`, through the same
// `WorkerQueue` as the bundler and the type checker), so whatever the SQL is,
// the app keeps answering, and a split that doesn't end is ended from outside:
//   · in Len's terminal, by the command's `signal` when the command times out;
//   · anywhere else (a draft born from a visitor's request), by `SPLIT_CAP_MS`.
// `null` = it didn't end in time, was aborted, or the thread failed.
import path from "node:path";

import { WorkerQueue } from "@/lib/apps/worker-queue";

const WORKER_PATH = path.join(process.cwd(), "lib", "backend", "sql-split-worker.mjs");

/** A real migration splits in about a millisecond (Len's 8 KB one, 14/10); the
 *  largest file allowed is 256 KB. 30 s only ends what is already broken. */
export const SPLIT_CAP_MS = 30_000;

export interface SqlSplitter {
  split(sql: string, o: { readonly timeoutMs: number; readonly signal?: AbortSignal }): Promise<string[] | null>;
  /** For tests and shutdown: drops what is pending and ends the thread. */
  stop(): void;
}

export function createSqlSplitter(o: { readonly workerPath?: string } = {}): SqlSplitter {
  const queue = new WorkerQueue<string[]>({ workerPath: o.workerPath ?? WORKER_PATH, resourceLimits: { maxOldGenerationSizeMb: 256 } });
  return {
    split: (sql, opts) => queue.run({ sql }, { timeoutMs: opts.timeoutMs, ...(opts.signal ? { signal: opts.signal } : {}) }),
    stop: () => queue.stop(),
  };
}

let shared: SqlSplitter | null = null;

/** Splits `sql` into statements in the splitter's thread. */
export function splitSqlOffThread(sql: string, o: { readonly signal?: AbortSignal; readonly timeoutMs?: number } = {}): Promise<string[] | null> {
  shared ??= createSqlSplitter();
  return shared.split(sql, { timeoutMs: o.timeoutMs ?? SPLIT_CAP_MS, ...(o.signal ? { signal: o.signal } : {}) });
}
