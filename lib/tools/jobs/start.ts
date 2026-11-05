// STARTING, FOLLOWING AND STOPPING A TOOL'S JOB (spec local 2026-11-04-herramientas-hechas-por-len, §4.6): what the
// bridge's `jobs.*` reach once the person confirmed in OpenLen's own dialog. DeepSeek's job registry scopes a job to
// its owner; here the owner is the person, and a job is found only through the tool it belongs to. A start checks, in
// this order, that the version declares the job, that its input is small JSON, that every picked file is the person's,
// the plan, that the balance covers the most it can cost, that the box is on for them and within OpenLen's daily cap,
// and that the tool's box is free — then writes the row and hands it to the runner, which never throws.
import "server-only";

import { INSTALL_ALLOWANCE_SECONDS, type RunnerDeps } from "./runner";
import { jobById, jobsOf, requestCancel, toJobView, type insertJob, type ToolJobRow } from "./store";
import { newJobId, UPLOADS_PER_PICK, type JobRefusal, type JobUpload, type ToolJobView } from "./types";

import { sandboxCenticredits } from "@/lib/agent/sandbox/billing";
import type { SandboxConfig } from "@/lib/agent/sandbox/config";
import type { Plan } from "@/lib/plan";

import { readToolJobs } from "../manifest";
import { toolProjectOf, type BridgeCaller } from "../bridge/handlers";

/** The input a tool hands a job: JSON of at most 16 KB (the picked files go apart). */
export const JOB_INPUT_MAX_BYTES = 16 * 1024;
/** The jobs the list shows: the newest. */
export const JOBS_LISTED = 20;

/** The most a job can cost, in centicredits: its minutes and the install allowance (what the confirmation shows). */
export function jobMostCentis(maxMinutes: number): number {
  return sandboxCenticredits(maxMinutes * 60 + INSTALL_ALLOWANCE_SECONDS);
}

export type { JobRefusal } from "./types";

export interface StartDeps {
  /** The version the caller runs: the installed release's job files and locale files, or the draft's current ones. */
  version(caller: BridgeCaller): Promise<{ jobFiles: Record<string, string>; locales: Record<string, string> } | null>;
  uploadsOf(personId: string, ids: readonly string[]): Promise<JobUpload[]>;
  plan(personId: string): Promise<Plan>;
  /** The person's balance, in centicredits. */
  balance(personId: string): Promise<number>;
  sandbox(): SandboxConfig | null;
  budgetOk(config: SandboxConfig): Promise<boolean>;
  /** Whether the tool project's box is taken (a Len turn, or a job). */
  busy(toolProjectId: string): Promise<boolean>;
  insert(row: Parameters<typeof insertJob>[0]): Promise<ToolJobRow>;
  run(job: ToolJobRow, o: { readonly files: Record<string, string>; readonly maxMinutes: number; readonly script: string }): void;
  newId(): string;
}

function inputOf(value: unknown): { ok: true; input: unknown } | { ok: false } {
  try {
    const text = JSON.stringify(value ?? null);
    if (new TextEncoder().encode(text).byteLength > JOB_INPUT_MAX_BYTES) return { ok: false };
    return { ok: true, input: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

function titleOf(titles: Readonly<Record<string, string>>, locale: string, name: string): string {
  return titles[locale] ?? titles[locale.split("-")[0]!] ?? titles.en ?? Object.values(titles)[0] ?? name;
}

export async function startToolJob(
  caller: BridgeCaller,
  req: { readonly name: unknown; readonly input: unknown; readonly uploads: unknown },
  d: StartDeps,
): Promise<{ ok: true; job: ToolJobView } | { ok: false; reason: JobRefusal }> {
  const refuse = (reason: JobRefusal) => ({ ok: false as const, reason });
  const version = await d.version(caller);
  const jobs = version ? readToolJobs({ ...version.locales, ...version.jobFiles }) : {};
  const name = typeof req.name === "string" ? req.name : "";
  const job = Object.prototype.hasOwnProperty.call(jobs, name) ? jobs[name] : undefined;
  if (!version || !job) return refuse("unknown_job");

  const input = inputOf(req.input);
  if (!input.ok) return refuse("bad_input");

  const ids = req.uploads ?? [];
  if (!Array.isArray(ids) || ids.length > UPLOADS_PER_PICK || !ids.every((id): id is string => typeof id === "string")) return refuse("bad_upload");
  const wanted = [...new Set(ids)];
  const uploads = await d.uploadsOf(caller.personId, wanted);
  if (uploads.length !== wanted.length) return refuse("bad_upload");

  if ((await d.plan(caller.personId)) === "free") return refuse("plan_required");
  if ((await d.balance(caller.personId)) < jobMostCentis(job.maxMinutes)) return refuse("no_credits");
  const config = d.sandbox();
  if (!config || (config.onlyUsers && !config.onlyUsers.includes(caller.personId))) return refuse("sandbox_off");
  if (!(await d.budgetOk(config))) return refuse("budget");
  const toolProjectId = toolProjectOf(caller);
  if (await d.busy(toolProjectId)) return refuse("busy");

  const row = await d.insert({
    id: d.newId(),
    personId: caller.personId,
    toolProjectId,
    installationId: caller.mode === "installed" ? caller.installation.id : null,
    releaseSha: caller.mode === "installed" ? caller.installation.releaseSha : null,
    name,
    title: titleOf(job.titles, caller.locale, name),
    input: input.input,
    uploads,
  });
  d.run(row, { files: version.jobFiles, maxMinutes: job.maxMinutes, script: job.script });
  return { ok: true, job: toJobView(row) };
}

/** What OpenLen's confirmation shows before a job runs (§4.4): the job's title in the person's language, its
 *  minutes and the most it can cost — from the version's declaration, never from the tool. */
export async function describeToolJob(
  caller: BridgeCaller,
  name: string,
  d: Pick<StartDeps, "version">,
): Promise<{ name: string; title: string; maxMinutes: number; mostCentis: number } | null> {
  const version = await d.version(caller);
  const jobs = version ? readToolJobs({ ...version.locales, ...version.jobFiles }) : {};
  const job = Object.prototype.hasOwnProperty.call(jobs, name) ? jobs[name] : undefined;
  return job ? { name, title: titleOf(job.titles, caller.locale, name), maxMinutes: job.maxMinutes, mostCentis: jobMostCentis(job.maxMinutes) } : null;
}

async function ownJob(id: string, personId: string, toolProjectId: string): Promise<ToolJobRow | null> {
  const row = await jobById(id);
  return row && row.personId === personId && row.toolProjectId === toolProjectId ? row : null;
}

export async function toolJobView(id: string, personId: string, toolProjectId: string): Promise<ToolJobView | null> {
  const row = await ownJob(id, personId, toolProjectId);
  return row ? toJobView(row) : null;
}

/** DeepSeek's cancellation request: `running → stopping`, then the runner settles it `killed`. Asking again, or
 *  asking a settled job, answers what it is now. */
export async function cancelToolJob(id: string, personId: string, toolProjectId: string): Promise<ToolJobView | null> {
  const row = await ownJob(id, personId, toolProjectId);
  if (!row) return null;
  const moved = await requestCancel(id);
  return toJobView(moved ?? (await jobById(id)) ?? row);
}

export async function listToolJobs(personId: string, toolProjectId: string): Promise<ToolJobView[]> {
  return (await jobsOf(personId, toolProjectId, JOBS_LISTED)).map(toJobView);
}

export async function realStartDeps(): Promise<StartDeps> {
  const [sandboxStore, budget, limits, credits, tools, release, backendFiles, uploads, jobStore, { runToolJob }] = await Promise.all([
    import("@/lib/agent/sandbox/store"),
    import("@/lib/agent/sandbox/budget"),
    import("@/lib/limits"),
    import("@/lib/credits"),
    import("../store"),
    import("../release"),
    import("@/lib/backend/files"),
    import("../uploads"),
    import("./store"),
    import("./runner"),
  ]);
  const { sandboxConfig } = await import("@/lib/agent/sandbox/config");
  const localesOf = (files: Readonly<Record<string, string>>) => Object.fromEntries(Object.entries(files).filter(([p]) => /^\/locale\/[A-Za-z-]+\.json$/.test(p)));
  return {
    version: async (caller) => {
      if (caller.mode === "installed") {
        const [served, jobFiles] = await Promise.all([tools.readRelease(caller.installation.releaseSha), tools.readReleaseJobs(caller.installation.releaseSha)]);
        if (!served || !jobFiles) return null;
        return { jobFiles, locales: localesOf(Object.fromEntries(Object.entries(served).map(([p, f]) => [p, f.content]))) };
      }
      const files = await backendFiles.listProjectFiles(caller.toolProjectId);
      return { jobFiles: release.jobFilesOf(files), locales: localesOf(files) };
    },
    uploadsOf: uploads.uploadsOf,
    plan: (p) => limits.getUserPlan(p),
    balance: async (p) => (await credits.getCreditState(p)).balance,
    sandbox: () => sandboxConfig(),
    budgetOk: (config) => budget.sandboxBudgetOk({ now: new Date(), dailyUsd: config.dailyUsd, spentTodayMicroUsd: budget.spentTodayMicroUsd }),
    // A dead holder's hold (older than two hours) is taken over by the runner's own hold; this is the quick answer.
    busy: async (toolProjectId) => !!(await sandboxStore.getProjectSandbox(toolProjectId))?.heldBy,
    insert: jobStore.insertJob,
    run: (job, o) => {
      void realRunnerDeps().then((deps) => runToolJob(job, o, deps)).catch((err: unknown) => {
        console.error(`[tool-jobs] ${job.id} never reached its runner: ${String(err)}`);
        void jobStore.settleJob(job.id, "failed", { detail: "open_failed" }).catch(() => null);
      });
    },
    newId: newJobId,
  };
}

/** The runner's real hands: the project's E2B box through the same store as Len's turns, the delivery store, the
 *  credit ledger. Built only with the box on. */
export async function realRunnerDeps(): Promise<RunnerDeps> {
  const [{ sandboxConfig }, { e2bDriver }, sandboxStore, { chargeSandbox }, jobStore, blob, uploads, { flushOnExit }] = await Promise.all([
    import("@/lib/agent/sandbox/config"),
    import("@/lib/agent/sandbox/e2b-driver"),
    import("@/lib/agent/sandbox/store"),
    import("@/lib/agent/sandbox/billing"),
    import("./store"),
    import("@/lib/files/blob"),
    import("../uploads"),
    import("@/lib/agent/exit-flush"),
  ]);
  const config = sandboxConfig();
  if (!config) throw new Error("the box is off");
  return {
    driver: e2bDriver(config),
    template: config.template,
    hold: sandboxStore.holdProjectSandbox,
    release: sandboxStore.releaseProjectSandbox,
    boxRow: async (projectId) => {
      const row = await sandboxStore.getProjectSandbox(projectId);
      return row ? { sandboxId: row.sandboxId, template: row.template, syncedManifest: row.syncedManifest } : null;
    },
    saveBox: sandboxStore.saveProjectSandbox,
    jobStatus: async (id) => (await jobStore.jobById(id))?.status ?? null,
    setProgress: jobStore.setProgress,
    settle: jobStore.settleJob,
    blob: async (content) => blob.getBlob(content).catch(() => null),
    upload: uploads.readToolUpload,
    deliver: (o) => uploads.deliverFromTool(o.toolProjectId, { name: o.name, contentType: o.contentType, bytes: o.bytes }, o.jobId),
    charge: (o) => chargeSandbox(o),
    now: Date.now,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log: (line) => console.log(line),
    onExit: flushOnExit,
  };
}
