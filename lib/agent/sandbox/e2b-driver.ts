// The real terminal's box on E2B (spec local 2026-10-21-real-terminal-e2b, §4 and §7). Closed by
// default: every outbound address denied but an allow list, no inbound traffic, no environment
// variables (nothing secret enters the box), and a box that times out pauses instead of dying. Its
// project's OpenLen hosts (./box-network.ts) are allowed with a header rule that adds the box's marker:
// E2B's egress proxy adds it, the box never sees it.
//
// The SDK comes in through `loadSdk` and is described by the small `E2b*Like` types below — only
// what this file uses, checked against e2b 2.56.0 (21/10).

import type { BoxNetwork } from "./box-network";
import { PAGE_CDNS } from "./box-network";
import type { SandboxConfig } from "./config";
import type { RunResult, SandboxDriver, SandboxHandle } from "./driver";

/** Package registries and code hosts (Claude Code's "Trusted" level) and the CDNs pages load from.
 *  E2B doesn't cap allowOut; its cap of 10 is for header rules (docs.e2b.dev, 21/10). */
export const BOX_ALLOW_OUT: readonly string[] = [
  "registry.npmjs.org",
  "pypi.org",
  "files.pythonhosted.org",
  "github.com",
  "*.githubusercontent.com",
  "esm.sh",
  ...PAGE_CDNS,
];

/** E2B's network for a box: closed but the allow list and the project's hosts, each with its rule
 *  (and the connected store's, with none). */
function networkOf(project: BoxNetwork | null | undefined) {
  const hosts = project?.hosts ?? [];
  return {
    denyOut: ["0.0.0.0/0"],
    allowOut: [...BOX_ALLOW_OUT, ...hosts, ...(project?.thirdPartyHosts ?? [])],
    ...(hosts.length > 0 ? { rules: Object.fromEntries(hosts.map((h) => [h, [{ transform: { headers: { ...project!.headers } } }]])) } : {}),
  };
}

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
    write(entries: { path: string; data: string | ArrayBuffer }[]): Promise<unknown>;
    read(path: string, o: { format: "bytes" }): Promise<Uint8Array>;
    remove(path: string): Promise<unknown>;
    list(path: string): Promise<{ readonly name: string }[]>;
  };
  pause(): Promise<unknown>;
  kill(): Promise<unknown>;
  /** From now, how long until E2B pauses the box by itself. */
  setTimeout(timeoutMs: number): Promise<unknown>;
  /** Replaces the box's egress configuration (allow and deny lists, rules). */
  updateNetwork(network: Record<string, unknown>): Promise<unknown>;
}

/** E2B's timeout counts from create/connect, not from the last use: a command this long after the last extension gives it back in full. */
const EXTEND_AFTER_MS = 5 * 60_000;

export interface E2bSdkLike {
  readonly Sandbox: {
    create(template: string, o: Record<string, unknown>): Promise<E2bSandboxLike>;
    connect(sandboxId: string, o: Record<string, unknown>): Promise<E2bSandboxLike>;
    kill(sandboxId: string, o: Record<string, unknown>): Promise<unknown>;
  };
}

/** Loads the `e2b` package when a box is first needed: with the box off, it is never loaded. A literal
 *  import, so the standalone build traces it (it is a `serverExternalPackages` in next.config.ts). */
async function loadE2bSdk(): Promise<E2bSdkLike> {
  return (await import("e2b")) as unknown as E2bSdkLike;
}

const utf8 = new TextDecoder("utf-8", { fatal: true });

function wrap(sbx: E2bSandboxLike, now: () => number): SandboxHandle {
  let extendedAt = now();
  return {
    id: sbx.sandboxId,
    async run(command, o) {
      // A long turn (past the 15 minutes) keeps its box; a failed extension only shortens the net.
      if (now() - extendedAt >= EXTEND_AFTER_MS) {
        extendedAt = now();
        await sbx.setTimeout(BOX_SAFETY_TIMEOUT_MS).catch(() => undefined);
      }
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
    async writeBytes(files) {
      // E2B's write takes an ArrayBuffer for binary data.
      const entries = Object.entries(files).map(([path, data]) => ({ path, data: data.slice().buffer as ArrayBuffer }));
      if (entries.length > 0) await sbx.files.write(entries);
    },
    async readBytes(paths) {
      const out: Record<string, Uint8Array> = {};
      await Promise.all(
        paths.map(async (p) => {
          try {
            out[p] = await sbx.files.read(p, { format: "bytes" });
          } catch {
            // gone
          }
        }),
      );
      return out;
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

export function e2bDriver(config: SandboxConfig, loadSdk: () => Promise<E2bSdkLike> = loadE2bSdk, now: () => number = Date.now): SandboxDriver {
  return {
    async create(o) {
      const { Sandbox } = await loadSdk();
      return wrap(
        await Sandbox.create(o.template, {
          apiKey: config.apiKey,
          timeoutMs: BOX_SAFETY_TIMEOUT_MS,
          metadata: { ...o.metadata },
          lifecycle: { onTimeout: "pause", autoResume: false },
          network: { ...networkOf(o.network), allowPublicTraffic: false },
        }),
        now,
      );
    },
    async resume(sandboxId, network) {
      const { Sandbox } = await loadSdk();
      const sbx = await Sandbox.connect(sandboxId, { apiKey: config.apiKey, timeoutMs: BOX_SAFETY_TIMEOUT_MS });
      // Since the box paused, the project may have gained a backend or a published page.
      if (network) await sbx.updateNetwork(networkOf(network));
      return wrap(sbx, now);
    },
    async kill(sandboxId) {
      const { Sandbox } = await loadSdk();
      await Sandbox.kill(sandboxId, { apiKey: config.apiKey });
    },
  };
}
