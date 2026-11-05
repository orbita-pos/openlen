// THE JOB RUNNER (spec local 2026-11-04-herramientas-hechas-por-len, §4.6): DeepSeek's job producer (packages/jobs, at
// fcc0ad4621, MIT) for a tool's job. It opens the tool project's E2B box OUTSIDE any Len turn — holding it as the job
// (`job-<id>`), so a Len turn that starts meanwhile gets the usual terminal and a job can't start while a turn has it —
// with the job's CLOSED network (a resumed box keeps whatever network Len's last turn gave it unless it is set again),
// prepares the box (./command.ts: the job's own user, nothing of an earlier job left), writes the version's job files,
// the input and the picked files under the job's folder in /tmp, starts the script as that user, and polls it every 5 s
// (one command that reads only the progress file's last line and the exit code, and keeps E2B from pausing the box):
// its progress, a cancel request, its ceiling, its exit. On settlement it delivers `out/` (like Len's `present`: at most
// 4 files of 20 MB, each size checked before it is read), reads `result.json` (64 KB, checked first), removes its
// folder and its processes, pauses the box, releases it and charges the person the seconds it ran — never more than
// its ceiling, what the confirmation showed — on every path, also when the box fails, and when a deploy's SIGTERM
// arrives mid-run (`onExit`: the job is killed and closed the same way, `failed` «stopped_by_restart»; what dies at once
// is closed at the next boot, lib/agent/close-dead-turns.ts). `runToolJob` never throws: it always settles the row, once.
import "server-only";

import type { BoxNetwork } from "@/lib/agent/sandbox/box-network";
import type { SandboxDriver, SandboxHandle } from "@/lib/agent/sandbox/driver";
import { MAX_DELIVERABLE_BYTES, PRESENT_MAX_FILES } from "@/lib/agent/skills/present";
import { contentTypeFor } from "@/lib/agent/ficheros/folder";
import { isBlobPointer, parsePointer } from "@/lib/files/blob-pointer";

import {
  INSTALL_FAILED_EXIT,
  JOB_KILL_NOW,
  JOB_PREPARE_COMMAND,
  jobCleanupCommand,
  jobDir,
  jobKillCommand,
  jobLaunchScript,
  jobOpenUpCommand,
  jobPollCommand,
  jobShellScript,
  jobTailCommand,
  parsePoll,
  type JobInstall,
} from "./command";
import type { ToolJobRow } from "./store";
import { jobCeilingSeconds, STOPPED_BY_RESTART, type DeliveredFile, type ToolJobStatus } from "./types";

export const POLL_EVERY_MS = 5_000;
export { INSTALL_ALLOWANCE_SECONDS } from "./types";
export const RESULT_MAX_BYTES = 64 * 1024;
const STDERR_TAIL = 2_000;

type Terminal = Exclude<ToolJobStatus, "running" | "stopping">;

export interface RunnerDeps {
  readonly driver: SandboxDriver;
  readonly template: string;
  hold(projectId: string, holder: string): Promise<boolean>;
  release(projectId: string, holder: string): Promise<void>;
  boxRow(projectId: string): Promise<{ sandboxId: string | null; template: string | null; syncedManifest: Record<string, string> } | null>;
  saveBox(row: {
    projectId: string;
    sandboxId: string;
    template: string;
    state: "running" | "paused";
    syncedManifest: Record<string, string>;
    pausedAt: Date | null;
  }): Promise<void>;
  jobStatus(id: string): Promise<ToolJobStatus | null>;
  setProgress(id: string, line: string): Promise<void>;
  settle(
    id: string,
    status: Terminal,
    set: { detail?: string | null; result?: unknown; delivered?: readonly DeliveredFile[]; seconds?: number; chargedCentis?: number },
  ): Promise<unknown>;
  /** A binary file of the version (a blob pointer in its files). */
  blob(content: string): Promise<Uint8Array | null>;
  /** A file the person picked in OpenLen's picker. */
  upload(id: string): Promise<{ name: string; bytes: Uint8Array } | null>;
  deliver(o: { toolProjectId: string; jobId: string; name: string; bytes: Uint8Array; contentType: string }): Promise<{ url: string }>;
  charge(o: { userId: string; projectId: string; turnId: string; seconds: number }): Promise<number>;
  now(): number;
  sleep(ms: number): Promise<void>;
  log(line: string): void;
  /** The process's exit flush (lib/agent/exit-flush.ts): `flush` runs before a deploy's exit; returns how to let go. */
  onExit?(flush: () => Promise<void>): () => void;
}

/** What the exit flush gives the kill: the whole flush has 5 s. */
const EXIT_KILL_MS = 2_000;

/** The box's network for a job: none of the project's OpenLen hosts — only the box's own allowlist (package registries,
 *  code hosts, the pages' CDNs). Explicit, never `null`: a resumed box is set to it again (the E2B driver leaves the
 *  network as it was when it gets none), so a job never reaches the tool's backend or canvas with the box's marker. */
export const JOB_NETWORK: BoxNetwork = { hosts: [], headers: {} };

const safeName = (name: string) =>
  (name.split(/[\\/]/).pop() ?? "")
    .replace(/[^\p{L}\p{N}._ -]/gu, "-")
    .replace(/^[.-]+/, "")
    .slice(0, 100) || "file";

function hasDependencies(text: string | undefined): boolean {
  try {
    const deps = (JSON.parse(text ?? "{}") as { dependencies?: Record<string, unknown> }).dependencies;
    return !!deps && typeof deps === "object" && Object.keys(deps).length > 0;
  } catch {
    return false;
  }
}

/** What /jobs asks to install before the script: its own package (never the app's /package.json, whose dependencies
 *  are the browser app's), or its requirements. */
function installOf(script: string, files: Readonly<Record<string, string>>): JobInstall | null {
  if (script.endsWith(".py")) {
    const req = files["/jobs/requirements.txt"] !== undefined ? "/jobs/requirements.txt" : files["/requirements.txt"] !== undefined ? "/requirements.txt" : null;
    return req ? { pip: req } : null;
  }
  if (!hasDependencies(files["/jobs/package.json"])) return null;
  return { npm: files["/jobs/package-lock.json"] !== undefined ? "ci" : "install" };
}

export async function runToolJob(
  job: ToolJobRow,
  o: { readonly files: Readonly<Record<string, string>>; readonly maxMinutes: number; readonly script: string },
  d: RunnerDeps,
): Promise<void> {
  const dir = jobDir(job.id);
  const projectId = job.toolProjectId;
  if (!(await d.hold(projectId, job.id).catch(() => false))) {
    await d.settle(job.id, "failed", { detail: "busy" }).catch(() => null);
    return;
  }

  const ceiling = jobCeilingSeconds(o.maxMinutes);
  let handle: SandboxHandle | null = null;
  let openedAt = d.now();
  let synced: Record<string, string> = {};
  let status: Terminal = "failed";
  let detail: string | null = null;
  let result: unknown = null;
  const delivered: DeliveredFile[] = [];
  const skipped: string[] = [];
  // Closing happens once: the run's own end, or the exit flush when a deploy cuts it — whichever comes first.
  let exiting = false;
  let closing: Promise<void> | null = null;
  const close = (end: { readonly status: Terminal; readonly detail: string | null }) => (closing ??= closeTheJob(end));
  let letGo = () => {};
  try {
    const row = await d.boxRow(projectId);
    if (row?.sandboxId && row.template === d.template) {
      try {
        handle = await d.driver.resume(row.sandboxId, JOB_NETWORK);
        synced = row.syncedManifest ?? {};
      } catch {
        handle = null; // gone (reclaimed, killed): a new one below
      }
    }
    if (!handle) {
      if (row?.sandboxId) await d.driver.kill(row.sandboxId).catch(() => undefined);
      handle = await d.driver.create({ template: d.template, metadata: { projectId }, network: JOB_NETWORK });
      // A new box holds none of the project: what the old box had synced is not what this one has.
      synced = {};
    }
    openedAt = d.now();
    await d.saveBox({ projectId, sandboxId: handle.id, template: d.template, state: "running", syncedManifest: synced, pausedAt: null });
    letGo =
      d.onExit?.(async () => {
        exiting = true;
        await handle?.run(JOB_KILL_NOW, { timeoutMs: EXIT_KILL_MS }).catch(() => undefined);
        await close({ status: "failed", detail: STOPPED_BY_RESTART });
      }) ?? letGo;

    const prepared = await handle.run(JOB_PREPARE_COMMAND, { timeoutMs: 30_000 });
    if (prepared.exitCode !== 0) throw new Error(`the box couldn't make the job's user: ${prepared.stderr.slice(-300)}`);

    // The version's files, the input and the picked files — all under the job's folder, one binary at a time.
    const text: Record<string, string> = {};
    for (const [path, content] of Object.entries(o.files)) {
      if (!isBlobPointer(content)) text[`${dir}/app${path}`] = content;
      else {
        const b = parsePointer(content) ? await d.blob(content) : null;
        if (b) await handle.writeBytes?.({ [`${dir}/app${path}`]: b });
      }
    }
    text[`${dir}/input.json`] = JSON.stringify(job.input ?? null);
    text[`${dir}/run.sh`] = jobShellScript({ id: job.id, script: o.script, install: installOf(o.script, o.files) });
    text[`${dir}/launch.sh`] = jobLaunchScript(job.id);
    await handle.write(text);
    for (const u of job.uploads ?? []) {
      const f = await d.upload(u.id);
      if (f) await handle.writeBytes?.({ [`${dir}/files/${safeName(f.name)}`]: f.bytes });
    }
    await handle.run(jobOpenUpCommand(job.id), { timeoutMs: 30_000 });
    await handle.run(`bash ${dir}/launch.sh`, { timeoutMs: 15_000 });

    const limitMs = ceiling * 1000;
    let lastProgress = "";
    let exit: number | null = null;
    for (;;) {
      await d.sleep(POLL_EVERY_MS);
      if (exiting) break;
      const poll = parsePoll((await handle.run(jobPollCommand(job.id), { timeoutMs: 10_000 })).stdout);
      if (poll.progress && poll.progress !== lastProgress) {
        lastProgress = poll.progress;
        await d.setProgress(job.id, poll.progress).catch(() => undefined);
      }
      if (poll.exit !== null) {
        exit = poll.exit;
        break;
      }
      if ((await d.jobStatus(job.id).catch(() => null)) === "stopping") {
        await handle.run(jobKillCommand(), { timeoutMs: 15_000 });
        status = "killed";
        detail = "cancelled";
        break;
      }
      if (d.now() - openedAt > limitMs) {
        await handle.run(jobKillCommand(), { timeoutMs: 15_000 });
        status = "killed";
        detail = "timeout";
        break;
      }
    }

    if (exit !== null) {
      if (exit === 0) status = "completed";
      else {
        status = "failed";
        const tail = exit === INSTALL_FAILED_EXIT ? `${dir}/install.log` : `${dir}/stderr`;
        const err = (await handle.run(jobTailCommand(tail, STDERR_TAIL), { timeoutMs: 10_000 })).stdout.trimEnd();
        detail = `${exit === INSTALL_FAILED_EXIT ? "install_failed" : `exit ${exit}`}${err ? `: ${err.slice(-STDERR_TAIL)}` : ""}`;
      }
    }

    // What it left: `out/` delivered, `result.json` read — also after a cancel or a timeout, what it got done (not when
    // a deploy cut it: the exit flush closes it at once). Every size is checked before anything is read.
    const names = exiting ? [] : (await handle.list(`${dir}/out`)).sort();
    for (const n of names) {
      if (delivered.length >= PRESENT_MAX_FILES) {
        skipped.push(`${n} (more than ${PRESENT_MAX_FILES} files)`);
        continue;
      }
      const path = `${dir}/out/${n}`;
      const size = (await handle.fileSize?.(path)) ?? null;
      if (size === null) continue;
      if (size > MAX_DELIVERABLE_BYTES) {
        skipped.push(`${n} (over ${MAX_DELIVERABLE_BYTES / (1024 * 1024)} MB)`);
        continue;
      }
      const b = (await handle.readBytes?.([path]))?.[path];
      if (!b) continue;
      // A delivery that fails is that file's, never the job's: what it finished stays finished, and the detail says it.
      try {
        const { url } = await d.deliver({ toolProjectId: projectId, jobId: job.id, name: n, bytes: b, contentType: contentTypeFor(n) });
        delivered.push({ name: n, url, size: b.byteLength });
      } catch (e) {
        d.log(`[tool-jobs] ${job.id} couldn't deliver ${n}: ${String(e)}`);
        skipped.push(`${n} (couldn't be delivered)`);
      }
    }
    const resultPath = `${dir}/result.json`;
    const resultSize = exiting ? null : ((await handle.fileSize?.(resultPath)) ?? null);
    if (resultSize !== null) {
      if (resultSize > RESULT_MAX_BYTES) detail ??= "result_too_large";
      else {
        const raw = textOf((await handle.read([resultPath]))[resultPath]);
        try {
          result = JSON.parse(raw) as unknown;
        } catch {
          detail ??= "result_not_json";
        }
      }
    }
  } catch (err) {
    d.log(`[tool-jobs] ${job.id} failed in the box: ${String(err)}`);
    if (!exiting) {
      status = "failed";
      detail = handle ? "box_error" : "open_failed";
    }
  }

  letGo();
  if (skipped.length > 0) detail = [detail, `not delivered: ${skipped.join(", ")}`].filter(Boolean).join("; ");
  // A deploy's exit may break the loop before its flush reaches `close`: the job ends as the restart's either way.
  await close(exiting ? { status: "failed", detail: STOPPED_BY_RESTART } : { status, detail });

  // Always: its processes and its folder go, the box pauses, the hold is released and the seconds are charged — never
  // more than the job's ceiling, the most the confirmation showed.
  async function closeTheJob(end: { readonly status: Terminal; readonly detail: string | null }): Promise<void> {
    let seconds = 0;
    let charged = 0;
    if (handle) {
      await handle.run(jobCleanupCommand(job.id), { timeoutMs: 15_000 }).catch(() => undefined);
      await handle.pause().catch((e: unknown) => d.log(`[tool-jobs] ${job.id} couldn't pause its box: ${String(e)}`));
      seconds = Math.min(ceiling, Math.max(1, Math.ceil((d.now() - openedAt) / 1000)));
      await d
        .saveBox({ projectId, sandboxId: handle.id, template: d.template, state: "paused", syncedManifest: synced, pausedAt: new Date(d.now()) })
        .catch(() => undefined);
    }
    await d.release(projectId, job.id).catch(() => undefined);
    if (handle) charged = await d.charge({ userId: job.personId, projectId, turnId: job.id, seconds }).catch(() => 0);
    await d
      .settle(job.id, end.status, { detail: end.detail, result, delivered, seconds, chargedCentis: charged })
      .catch((e: unknown) => d.log(`[tool-jobs] ${job.id} couldn't be settled: ${String(e)}`));
  }
}

function textOf(v: { readonly text: string } | { readonly binary: true; readonly size: number } | undefined): string {
  return v && "text" in v ? v.text : "";
}
