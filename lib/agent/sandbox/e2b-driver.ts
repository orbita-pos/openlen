// The real terminal's box on E2B (spec local 2026-10-21-real-terminal-e2b, §4 and §7). Closed by
// default: every outbound address denied but a short allow list (E2B allows at most 10 domains),
// no inbound traffic, no environment variables (nothing secret enters the box), and a box that
// times out pauses instead of dying.
//
// The SDK comes in through `loadSdk` and is described by the small `E2b*Like` types below — only
// what this file uses, from E2B's docs (read 2026-10-21). Jesús installs `e2b` (Task 0 of the plan);
// the real-box acceptance (scripts/sandbox-acceptance.ts) checks these shapes against it.

import type { SandboxConfig } from "./config";
import type { RunResult, SandboxDriver, SandboxHandle } from "./driver";

/** Package registries and code hosts: Claude Code's "Trusted" level, within E2B's 10 domains. */
export const BOX_ALLOW_OUT: readonly string[] = [
  "registry.npmjs.org",
  "pypi.org",
  "files.pythonhosted.org",
  "github.com",
  "*.githubusercontent.com",
  "esm.sh",
];

/** A safety net only: the turn pauses the box itself when it closes. */
const BOX_SAFETY_TIMEOUT_MS = 15 * 60_000;

export interface E2bCommandHandleLike {
  readonly pid: number;
  wait(): Promise<{ readonly stdout: string; readonly stderr: string; readonly exitCode: number }>;
  kill(): Promise<unknown>;
}

export interface E2bSandboxLike {
  readonly sandboxId: string;
  readonly commands: {
    run(
      command: string,
      o: {
        readonly background: true;
        readonly timeoutMs: number;
        readonly onStdout?: (data: string) => void;
        readonly onStderr?: (data: string) => void;
      },
    ): Promise<E2bCommandHandleLike>;
  };
  readonly files: {
    write(entries: { path: string; data: string }[]): Promise<unknown>;
    read(path: string, o: { format: "bytes" }): Promise<Uint8Array>;
    remove(path: string): Promise<unknown>;
    list(path: string): Promise<{ readonly name: string }[]>;
  };
  pause(): Promise<unknown>;
  kill(): Promise<unknown>;
}

export interface E2bSdkLike {
  readonly Sandbox: {
    create(template: string, o: Record<string, unknown>): Promise<E2bSandboxLike>;
    connect(sandboxId: string, o: Record<string, unknown>): Promise<E2bSandboxLike>;
    kill(sandboxId: string, o: Record<string, unknown>): Promise<unknown>;
  };
}

/** Loads the `e2b` package at run time, so nothing breaks while it isn't installed and the box is off. */
async function loadE2bSdk(): Promise<E2bSdkLike> {
  const name = "e2b";
  return (await import(/* webpackIgnore: true */ /* @vite-ignore */ name)) as E2bSdkLike;
}

const utf8 = new TextDecoder("utf-8", { fatal: true });

function wrap(sbx: E2bSandboxLike): SandboxHandle {
  return {
    id: sbx.sandboxId,
    async run(command, o) {
      let stdout = "";
      let stderr = "";
      const proc = await sbx.commands.run(command, {
        background: true,
        timeoutMs: 0,
        onStdout: (d) => ((stdout += d), o.onOutput?.(d)),
        onStderr: (d) => ((stderr += d), o.onOutput?.(d)),
      });
      if (o.background) return { stdout: "", stderr: "", exitCode: 0, timedOut: false, pid: proc.pid };
      type Outcome = { kind: "done"; r: RunResult } | { kind: "timeout" } | { kind: "abort" };
      const done = proc.wait().then(
        (r): Outcome => ({ kind: "done", r: { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode, timedOut: false, pid: proc.pid } }),
        (e: unknown): Outcome => {
          // A non-zero exit is an answer (E2B throws it with its exit code and output).
          const x = e as { exitCode?: unknown; stdout?: unknown; stderr?: unknown };
          if (typeof x?.exitCode !== "number") throw e;
          return {
            kind: "done",
            r: { stdout: String(x.stdout ?? stdout), stderr: String(x.stderr ?? stderr), exitCode: x.exitCode, timedOut: false, pid: proc.pid },
          };
        },
      );
      let timer: ReturnType<typeof setTimeout> | undefined;
      let onAbort: (() => void) | undefined;
      const late = new Promise<Outcome>((resolve) => {
        timer = setTimeout(() => resolve({ kind: "timeout" }), o.timeoutMs);
        if (o.signal) {
          onAbort = () => resolve({ kind: "abort" });
          if (o.signal.aborted) onAbort();
          else o.signal.addEventListener("abort", onAbort, { once: true });
        }
      });
      try {
        const out = await Promise.race([done, late]);
        if (out.kind === "done") return out.r;
        if (out.kind === "timeout") return { stdout, stderr, exitCode: 0, timedOut: true, pid: proc.pid };
        await proc.kill().catch(() => undefined);
        return { stdout, stderr, exitCode: 130, timedOut: false, aborted: true, pid: proc.pid };
      } finally {
        clearTimeout(timer);
        if (onAbort) o.signal?.removeEventListener("abort", onAbort);
      }
    },
    async write(files) {
      const entries = Object.entries(files).map(([path, data]) => ({ path, data }));
      if (entries.length > 0) await sbx.files.write(entries);
    },
    async remove(paths) {
      for (const p of paths) await sbx.files.remove(p).catch(() => undefined);
    },
    async read(paths) {
      const out: Record<string, { text: string } | { binary: true; size: number }> = {};
      await Promise.all(
        paths.map(async (p) => {
          let bytes: Uint8Array;
          try {
            bytes = await sbx.files.read(p, { format: "bytes" });
          } catch {
            return; // gone
          }
          try {
            out[p] = { text: utf8.decode(bytes) };
          } catch {
            out[p] = { binary: true, size: bytes.byteLength };
          }
        }),
      );
      return out;
    },
    async list(dir) {
      try {
        return (await sbx.files.list(dir)).map((e) => e.name);
      } catch {
        return [];
      }
    },
    async pause() {
      try {
        await sbx.pause();
      } catch (e) {
        // E2B refuses a pause while it finishes the previous snapshot (ServiceBusyError): once more, later.
        if ((e as { name?: string })?.name !== "ServiceBusyError") throw e;
        await new Promise((r) => setTimeout(r, 5_000));
        await sbx.pause();
      }
    },
    async kill() {
      await sbx.kill();
    },
  };
}

export function e2bDriver(config: SandboxConfig, loadSdk: () => Promise<E2bSdkLike> = loadE2bSdk): SandboxDriver {
  return {
    async create(o) {
      const { Sandbox } = await loadSdk();
      return wrap(
        await Sandbox.create(o.template, {
          apiKey: config.apiKey,
          timeoutMs: BOX_SAFETY_TIMEOUT_MS,
          metadata: { ...o.metadata },
          lifecycle: { onTimeout: "pause", autoResume: false },
          network: { denyOut: ["0.0.0.0/0"], allowOut: [...BOX_ALLOW_OUT], allowPublicTraffic: false },
        }),
      );
    },
    async resume(sandboxId) {
      const { Sandbox } = await loadSdk();
      return wrap(await Sandbox.connect(sandboxId, { apiKey: config.apiKey, timeoutMs: BOX_SAFETY_TIMEOUT_MS }));
    },
    async kill(sandboxId) {
      const { Sandbox } = await loadSdk();
      await Sandbox.kill(sandboxId, { apiKey: config.apiKey });
    },
  };
}
