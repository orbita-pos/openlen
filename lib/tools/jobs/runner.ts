// THE JOB RUNNER (spec local 2026-11-04-herramientas-hechas-por-len, §4.6): DeepSeek's job producer (packages/jobs, at
// fcc0ad4621, MIT) for a tool's job. It opens the tool project's E2B box OUTSIDE any Len turn — holding it as the job
// (`job-<id>`), so a Len turn that starts meanwhile gets the usual terminal and a job can't start while a turn has it —
// writes the version's job files, the input and the picked files under the job's folder in /tmp, starts the script in
// its own process group, and polls it every 5 s (each poll runs a command, which keeps E2B from pausing the box): its
// progress line, a cancel request, its ceiling of minutes, its exit. On settlement it delivers `out/` (like Len's
// `present`: at most 4 files of 20 MB), reads `result.json` (64 KB of JSON), removes its folder, pauses the box,
// releases it and charges the person the seconds it ran — on every path, also when the box fails, and when a deploy's
// SIGTERM arrives mid-run (`onExit`: the job is killed and closed the same way, `failed` «stopped_by_restart»; what dies
// at once is closed at the next boot, lib/tools/jobs/boot.ts). Nothing a job writes enters the project's files.
// `runToolJob` never throws: it always settles the row, once.
import "server-only";

import type { BoxNetwork } from "@/lib/agent/sandbox/box-network";
import type { SandboxDriver, SandboxHandle } from "@/lib/agent/sandbox/driver";
import { MAX_DELIVERABLE_BYTES, PRESENT_MAX_FILES } from "@/lib/agent/skills/present";
import { contentTypeFor } from "@/lib/agent/ficheros/folder";
import { isBlobPointer, parsePointer } from "@/lib/files/blob-pointer";

import { INSTALL_FAILED_EXIT, jobDir, jobKillCommand, jobLaunchScript, jobShellScript } from "./command";
import type { ToolJobRow } from "./store";
import { STOPPED_BY_RESTART, type DeliveredFile, type ToolJobStatus } from "./types";

export const POLL_EVERY_MS = 5_000;
/** The install step's allowance on top of the job's own minutes (also in what the confirmation shows). */
export const INSTALL_ALLOWANCE_SECONDS = 120;
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

/** The box's network for a job: none of the project's OpenLen hosts — only the box's own allowlist (npm, PyPI,
 *  GitHub). A job never reaches the tool's backend. */
export const JOB_NETWORK: BoxNetwork | null = null;

const safeName = (name: string) =>
  (name.split(/[\\/]/).pop() ?? "")
    .replace(/[^\p{L}\p{N}._ -]/gu, "-")
    .replace(/^[.-]+/, "")
    .slice(0, 100) || "file";

/** What the version's package asks to install before the script: a Node job with a lockfile and dependencies, or a
 *  Python job with requirements.txt. */
function installOf(script: string, files: Readonly<Record<string, string>>): "npm" | "pip" | null {
  if (script.endsWith(".py")) return files["/requirements.txt"] !== undefined ? "pip" : null;
  if (files["/package-lock.json"] === undefined) return null;
  try {
    const deps = (JSON.parse(files["/package.json"] ?? "{}") as { dependencies?: Record<string, unknown> }).dependencies;
    return deps && Object.keys(deps).length > 0 ? "npm" : null;
  } catch {
    return null;
  }
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

  let handle: SandboxHandle | null = null;
  let openedAt = d.now();
  let synced: Record<string, string> = {};
  let status: Terminal = "failed";
  let detail: string | null = null;
  let result: unknown = null;
  const delivered: DeliveredFile[] = [];
  // Closing happens once: the run's own end, or the exit flush when a deploy cuts it — whichever comes first.
  let exiting = false;
  let closing: Promise<void> | null = null;
  const close = (end: { readonly status: Terminal; readonly detail: string | null }) => (closing ??= closeTheJob(end));
  let letGo = () => {};
  try {
    const row = await d.boxRow(projectId);
    synced = row?.syncedManifest ?? {};
    if (row?.sandboxId && row.template === d.template) handle = await d.driver.resume(row.sandboxId, JOB_NETWORK);
    else {
      if (row?.sandboxId) await d.driver.kill(row.sandboxId).catch(() => undefined);
      handle = await d.driver.create({ template: d.template, metadata: { projectId }, network: JOB_NETWORK });
    }
    openedAt = d.now();
    await d.saveBox({ projectId, sandboxId: handle.id, template: d.template, state: "running", syncedManifest: synced, pausedAt: null });
    letGo =
      d.onExit?.(async () => {
        exiting = true;
        await handle?.run(jobKillCommand(job.id), { timeoutMs: EXIT_KILL_MS }).catch(() => undefined);
        await close({ status: "failed", detail: STOPPED_BY_RESTART });
      }) ?? letGo;

    // The version's files, the input and the picked files — all under the job's folder.
    const text: Record<string, string> = {};
    const bytes: Record<string, Uint8Array> = {};
    for (const [path, content] of Object.entries(o.files)) {
      if (!isBlobPointer(content)) text[`${dir}/app${path}`] = content;
      else {
        const b = parsePointer(content) ? await d.blob(content) : null;
        if (b) bytes[`${dir}/app${path}`] = b;
      }
    }
    for (const u of job.uploads ?? []) {
      const f = await d.upload(u.id);
      if (f) bytes[`${dir}/files/${safeName(f.name)}`] = f.bytes;
    }
    text[`${dir}/input.json`] = JSON.stringify(job.input ?? null);
    text[`${dir}/run.sh`] = jobShellScript({ id: job.id, script: o.script, install: installOf(o.script, o.files) });
    text[`${dir}/launch.sh`] = jobLaunchScript(job.id);
    await handle.write(text);
    if (Object.keys(bytes).length > 0) await handle.writeBytes?.(bytes);
    await handle.run(`bash ${dir}/launch.sh`, { timeoutMs: 15_000 });

    const limitMs = (o.maxMinutes * 60 + INSTALL_ALLOWANCE_SECONDS) * 1000;
    let lastProgress = "";
    let exit: number | null = null;
    for (;;) {
      await d.sleep(POLL_EVERY_MS);
      if (exiting) break;
      await handle.run(":", { timeoutMs: 10_000 });
      const seen = await handle.read([`${dir}/progress`, `${dir}/exit`]);
      const progress = textOf(seen[`${dir}/progress`]).split("\n").map((l) => l.trim()).filter(Boolean).at(-1) ?? "";
      if (progress && progress !== lastProgress) {
        lastProgress = progress;
        await d.setProgress(job.id, progress).catch(() => undefined);
      }
      const exitText = textOf(seen[`${dir}/exit`]).trim();
      if (exitText) {
        exit = Number.parseInt(exitText, 10);
        break;
      }
      if ((await d.jobStatus(job.id).catch(() => null)) === "stopping") {
        await handle.run(jobKillCommand(job.id), { timeoutMs: 15_000 });
        status = "killed";
        detail = "cancelled";
        break;
      }
      if (d.now() - openedAt > limitMs) {
        await handle.run(jobKillCommand(job.id), { timeoutMs: 15_000 });
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
        const err = textOf((await handle.read([tail]))[tail]).trimEnd();
        detail = `${exit === INSTALL_FAILED_EXIT ? "install_failed" : `exit ${exit}`}${err ? `: ${err.slice(-STDERR_TAIL)}` : ""}`;
      }
    }

    // What it left: `out/` delivered, `result.json` read — also after a cancel or a timeout, what it got done (not when
    // a deploy cut it: the exit flush closes it at once).
    const names = exiting ? [] : (await handle.list(`${dir}/out`)).sort().slice(0, PRESENT_MAX_FILES);
    if (names.length > 0) {
      const got = (await handle.readBytes?.(names.map((n) => `${dir}/out/${n}`))) ?? {};
      for (const n of names) {
        const b = got[`${dir}/out/${n}`];
        if (!b || b.byteLength > MAX_DELIVERABLE_BYTES) continue;
        const { url } = await d.deliver({ toolProjectId: projectId, jobId: job.id, name: n, bytes: b, contentType: contentTypeFor(n) });
        delivered.push({ name: n, url, size: b.byteLength });
      }
    }
    const raw = exiting ? "" : textOf((await handle.read([`${dir}/result.json`]))[`${dir}/result.json`]);
    if (raw) {
      if (new TextEncoder().encode(raw).byteLength > RESULT_MAX_BYTES) detail ??= "result_too_large";
      else {
        try {
          result = JSON.parse(raw) as unknown;
        } catch {
          detail ??= "result_not_json";
        }
      }
    }
  } catch (err) {
    d.log(`[tool-jobs] ${job.id} failed in the box: ${String(err)}`);
    status = "failed";
    detail = handle ? "box_error" : "open_failed";
  }

  letGo();
  // A deploy's exit may break the loop before its flush reaches `close`: the job ends as the restart's either way.
  await close(exiting ? { status: "failed", detail: STOPPED_BY_RESTART } : { status, detail });

  // Always: the folder goes, the box pauses, the hold is released and the seconds are charged.
  async function closeTheJob(end: { readonly status: Terminal; readonly detail: string | null }): Promise<void> {
    let seconds = 0;
    let charged = 0;
    if (handle) {
      await handle.remove([dir]).catch(() => undefined);
      await handle.pause().catch((e: unknown) => d.log(`[tool-jobs] ${job.id} couldn't pause its box: ${String(e)}`));
      seconds = Math.max(1, Math.ceil((d.now() - openedAt) / 1000));
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
