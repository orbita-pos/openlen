// A TOOL'S JOBS (spec local 2026-11-04-herramientas-hechas-por-len, §4.6): DeepSeek's job registry
// (packages/jobs/jobs, at fcc0ad4621, MIT) for OpenLen — a job has a `<kind>-<16 hex>` id, one owner, and a status
// from `running` and `stopping` to the terminal `completed`, `killed` or `failed`, decided once. Here the kind is
// `job`, the owner is the person, and the producer is the runner that opens the tool project's box. Pure, client-safe.

export type ToolJobStatus = "running" | "stopping" | "completed" | "killed" | "failed";

export const TERMINAL_JOB_STATUSES: readonly ToolJobStatus[] = ["completed", "killed", "failed"];

/** A file a job left in `out/`, delivered to the person (the same private store as Len's `present`). */
export interface DeliveredFile {
  readonly name: string;
  readonly url: string;
  readonly size: number;
}

/** A file the person picked in OpenLen's picker, handed to a job. */
export interface JobUpload {
  readonly id: string;
  readonly name: string;
  readonly size: number;
}

/** What the tool and the person see of a job: never its input, its uploads or its owner. */
export interface ToolJobView {
  readonly id: string;
  readonly name: string;
  readonly title: string;
  readonly status: ToolJobStatus;
  readonly progress: string | null;
  readonly detail: string | null;
  readonly result: unknown;
  readonly delivered: readonly DeliveredFile[];
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly seconds: number;
  readonly chargedCentis: number;
}

/** Why a job didn't start (lib/tools/jobs/start.ts): each one the tool can read in `jobs.run`'s answer. */
export const JOB_REFUSALS = [
  "unknown_job",
  "bad_input",
  "bad_upload",
  "plan_required",
  "no_credits",
  "sandbox_off",
  "budget",
  "busy",
  "eyes_never_run",
] as const;
export type JobRefusal = (typeof JOB_REFUSALS)[number];

/** The files the person picks in OpenLen's picker at once (and hands one job). */
export const UPLOADS_PER_PICK = 8;

/** DeepSeek's id: the kind, then 16 lowercase hex characters of a UUID. */
export function newJobId(): string {
  return `job-${globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}
