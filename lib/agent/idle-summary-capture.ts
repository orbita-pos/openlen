// THE IDLE SUMMARY'S JOB, WRITTEN TO A FILE — only for the return bench, never in production (spec local
// 2026-11-13-conversar-todo-el-mes, §8.2: «el banco llama a la misma función que llama el temporizador»).
//
// The bench has to write a conversation's summary now, several times over the same conversation, instead of
// waiting almost an hour for a timer inside another process. With `OPENLEN_IDLE_SUMMARY_CAPTURE_DIR` set, the
// route hands over the job's plain values (./idle-summary-job.ts) in a file and ARMS NOTHING; the bench reads
// the file, builds the job with the same factory and runs it with the same function the timer calls.
//
// Like the request captures of layer 1 (lib/ai/request-capture.ts): the file holds the conversation, so it
// is refused in production (said once), lives outside the repo, and a write that fails never touches the
// turn.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { IdleSummaryJobInput } from "@/lib/agent/idle-summary-job";

let refusedOnce = false;

/** Where a conversation's job is written: one file per conversation, replaced by each of its turns. */
export function idleSummaryCaptureFile(dir: string, key: string): string {
  return join(dir, `${key.replace(/[^A-Za-z0-9_-]/g, "_") || "conversation"}.json`);
}

/**
 * `true`: the capture folder is set, so the job went to a file (or could not be written, which is said) and
 * the caller must NOT arm a timer. `false`: nothing to do with the bench — arm it as always.
 */
export function captureIdleSummaryJob(input: IdleSummaryJobInput, env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  const dir = env.OPENLEN_IDLE_SUMMARY_CAPTURE_DIR?.trim();
  if (!dir) return false;
  if (env.NODE_ENV === "production") {
    if (!refusedOnce) {
      refusedOnce = true;
      console.warn("[idle-summary] OPENLEN_IDLE_SUMMARY_CAPTURE_DIR is ignored in production");
    }
    return false;
  }
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(idleSummaryCaptureFile(dir, input.key), JSON.stringify(input), "utf8");
  } catch (err) {
    console.warn(`[idle-summary] ${input.key}: the job could not be written to ${dir} — ${err instanceof Error ? err.message : String(err)}`);
  }
  return true;
}
