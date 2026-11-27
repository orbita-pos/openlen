// lib/agent/code-mode/runtime.ts — Sandboxed WebAssembly QuickJS executor for `run_code`.
//
// Runs model-authored TypeScript/JavaScript inside a disposable `quickjs-wasi`
// WebAssembly linear-memory VM:
//   - Zero host `fs`, network, `process.env`, `child_process`, or V8 prototype sharing.
//   - TypeScript type annotations stripped up front via `sucrase`.
//   - Deterministic 32 MB WASM heap limit, per-slice synchronous CPU deadline (kills
//     `while (true) {}` without starving slow async `bash`/`view_page` calls), total
//     wall-clock timeout, `AbortSignal` cancellation, and bounded sub-call count.
//   - Concurrency-safe sub-calls (`isParallel(name, args)`) run concurrently up to
//     `maxParallel`; mutating/exclusive sub-calls serialize automatically so even
//     `Promise.all([tools.Edit(...), tools.Edit(...)])` never races on project state.

import { QuickJS, type Deferred } from "quickjs-wasi";
import { transform } from "sucrase";
import { INTERACTIVE_OR_CONTROL_TOOLS } from "./declaration";

export const DEFAULT_MEMORY_LIMIT_BYTES = 32 * 1024 * 1024;
export const DEFAULT_MAX_SYNC_CPU_MS = 5_000;
export const DEFAULT_MAX_WALL_MS = 120_000;
export const DEFAULT_MAX_SUBCALLS = 25;
export const DEFAULT_MAX_PARALLEL_SUBCALLS = 10;
export const DEFAULT_MAX_LOG_CHARS = 16_000;
export const DEFAULT_MAX_RETURN_CHARS = 32_000;

export interface CodeModeSubcallRecord {
  readonly name: string;
  readonly ok: boolean;
}

export interface ExecuteCodeModeOptions {
  readonly code: string;
  /** Tool names declared in the current session (`args.tools`). */
  readonly declaredTools: ReadonlySet<string>;
  /** Executes a validated sub-tool through the agent loop's own runtime and guards. */
  readonly callTool: (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>;
  /** Whether a sub-call may overlap with other parallel-safe sub-calls. */
  readonly isParallel?: (name: string, args: Record<string, unknown>) => boolean;
  readonly signal?: AbortSignal;
  readonly memoryLimitBytes?: number;
  readonly maxSyncCpuMs?: number;
  readonly maxWallMs?: number;
  readonly maxSubcalls?: number;
  readonly maxParallel?: number;
  readonly maxLogChars?: number;
  readonly maxReturnChars?: number;
}

export interface ExecuteCodeModeResult {
  readonly ok: boolean;
  readonly value?: unknown;
  readonly logs: readonly string[];
  readonly calls: readonly CodeModeSubcallRecord[];
  readonly error?: string;
  /** Formatted text delivered in `tool_result` for the model. */
  readonly formatted: string;
}

// THE WASM IS quickjs-wasi's OWN TO FIND (`QuickJS.create` without `wasm` reads `../quickjs.wasm` next to its own
// `import.meta.url`). The package is in `serverExternalPackages`, so that path is real in dev, in tests and in the
// standalone. Finding it from here broke under the Next server's webpack (measured 2026-11-26 through /api/agent):
// a dynamic `import("node:module")` came back without `createRequire`, and a static one's `resolve` answered a
// webpack module id (`(rsc)/node_modules/…`), not a path — every `run_code` failed while vitest and tsx passed. Not
// caching the compiled module costs ~5 ms per call (measured; the first ~25 ms).

/** Strips TypeScript syntax while preserving ES2023 async/await for QuickJS-NG. */
export function stripTypeScriptForQuickJs(source: string): { ok: true; js: string } | { ok: false; error: string } {
  try {
    const out = transform(source, {
      transforms: ["typescript"],
      disableESTransforms: true,
    });
    return { ok: true, js: out.code };
  } catch (err) {
    return {
      ok: false,
      error: `TypeScript syntax error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** Serializes exclusive calls while letting parallel-safe calls overlap up to `maxParallel`. */
function createSubcallGate(maxParallel: number) {
  let activeParallel = 0;
  let activeExclusive = false;
  const queue: { parallel: boolean; go: () => void }[] = [];

  const pump = () => {
    while (queue.length > 0) {
      const next = queue[0]!;
      if (next.parallel) {
        if (activeExclusive || activeParallel >= maxParallel) break;
        queue.shift();
        activeParallel += 1;
        next.go();
      } else {
        if (activeExclusive || activeParallel > 0) break;
        queue.shift();
        activeExclusive = true;
        next.go();
        break;
      }
    }
  };

  return async <T>(parallel: boolean, fn: () => Promise<T>): Promise<T> => {
    await new Promise<void>((resolve) => {
      queue.push({ parallel, go: resolve });
      pump();
    });
    try {
      return await fn();
    } finally {
      if (parallel) activeParallel -= 1;
      else activeExclusive = false;
      pump();
    }
  };
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const head = Math.floor(maxChars * 0.75);
  const tail = Math.max(0, maxChars - head);
  const omitted = text.length - head - tail;
  return `${text.slice(0, head)}\n…[${omitted} chars truncated]…\n${text.slice(text.length - tail)}`;
}

function formatReturnValue(value: unknown, maxChars: number): string {
  if (value === undefined) return "";
  if (typeof value === "string") return truncateText(value, maxChars);
  try {
    return truncateText(JSON.stringify(value, null, 2) ?? String(value), maxChars);
  } catch {
    return truncateText(String(value), maxChars);
  }
}

function enrichToolResponse(raw: Record<string, unknown>): Record<string, unknown> {
  if ("text" in raw) return raw;
  if (typeof raw.tool_result === "string") return { ...raw, text: raw.tool_result };
  if (typeof raw.error === "string") return { ...raw, text: raw.error };
  return raw;
}

const GUEST_PRELUDE = `
"use strict";
(() => {
  const callHost = globalThis.__openlen_call_tool;
  const logHost = globalThis.__openlen_log;
  delete globalThis.__openlen_call_tool;
  delete globalThis.__openlen_log;

  const formatArg = (v) => {
    if (typeof v === "string") return v;
    if (v instanceof Error) return v.stack || v.message || String(v);
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  };
  const makeLogger = (level) => (...parts) => {
    logHost(level, parts.map(formatArg).join(" "));
  };
  globalThis.console = Object.freeze({
    log: makeLogger("log"),
    info: makeLogger("info"),
    warn: makeLogger("warn"),
    error: makeLogger("error"),
    debug: makeLogger("debug"),
  });

  const cache = Object.create(null);
  globalThis.tools = new Proxy(Object.freeze(Object.create(null)), {
    get(_target, prop) {
      if (typeof prop !== "string") return undefined;
      if (!cache[prop]) {
        cache[prop] = async (args) => {
          const payload = args === undefined ? "{}" : JSON.stringify(args);
          const rawJson = await callHost(prop, payload ?? "{}");
          return JSON.parse(rawJson);
        };
      }
      return cache[prop];
    },
  });
})();
`;

export async function executeCodeMode(opts: ExecuteCodeModeOptions): Promise<ExecuteCodeModeResult> {
  const code = opts.code.trim();
  if (!code) {
    const error = "The run_code tool requires non-empty code.";
    return { ok: false, logs: [], calls: [], error, formatted: error };
  }
  if (opts.signal?.aborted) {
    const error = "The run_code execution was cancelled.";
    return { ok: false, logs: [], calls: [], error, formatted: error };
  }

  const stripped = stripTypeScriptForQuickJs(code);
  if (!stripped.ok) {
    return { ok: false, logs: [], calls: [], error: stripped.error, formatted: stripped.error };
  }

  const memoryLimit = opts.memoryLimitBytes ?? DEFAULT_MEMORY_LIMIT_BYTES;
  const maxSyncCpuMs = opts.maxSyncCpuMs ?? DEFAULT_MAX_SYNC_CPU_MS;
  const maxWallMs = opts.maxWallMs ?? DEFAULT_MAX_WALL_MS;
  const maxSubcalls = opts.maxSubcalls ?? DEFAULT_MAX_SUBCALLS;
  const maxParallel = Math.max(1, opts.maxParallel ?? DEFAULT_MAX_PARALLEL_SUBCALLS);
  const maxLogChars = opts.maxLogChars ?? DEFAULT_MAX_LOG_CHARS;
  const maxReturnChars = opts.maxReturnChars ?? DEFAULT_MAX_RETURN_CHARS;

  const logs: string[] = [];
  let loggedChars = 0;
  let logTruncated = false;
  const calls: CodeModeSubcallRecord[] = [];
  let subcallCount = 0;

  const wallDeadline = Date.now() + maxWallMs;
  let syncSliceDeadline = Date.now() + maxSyncCpuMs;
  let interruptedReason: string | null = null;

  const triggerInterrupt = (reason: string): true => {
    if (!interruptedReason) {
      interruptedReason = reason;
      queueMicrotask(() => rejectFatal(new Error(reason)));
    }
    return true;
  };

  // An engine that can't start is THIS tool's error, never the step's: a throw here failed the whole tool step and
  // ended the turn. The model gets a result it can act on and keeps working with the tools directly.
  let vm: QuickJS;
  try {
    vm = await QuickJS.create({
      memoryLimit,
      interruptHandler: () => {
        // QuickJS-NG already throttles `host_interrupt` internally (every ~10k ops);
        // once interrupted, let QuickJS unwind and settle rejection jobs cleanly.
        if (interruptedReason !== null) return false;
        if (opts.signal?.aborted) {
          return triggerInterrupt("Execution cancelled.");
        }
        const now = Date.now();
        if (now > wallDeadline) {
          return triggerInterrupt(`Execution exceeded wall-clock timeout (${maxWallMs} ms).`);
        }
        if (now > syncSliceDeadline) {
          return triggerInterrupt(`Synchronous JS computation exceeded CPU slice limit (${maxSyncCpuMs} ms).`);
        }
        return false;
      },
    });
  } catch (err) {
    const error = `run_code is unavailable: its engine could not start (${err instanceof Error ? err.message : String(err)}). Call the tools directly instead.`;
    return { ok: false, logs: [], calls: [], error, formatted: error };
  }

  let closed = false;
  const inFlight = new Set<Promise<void>>();
  const pendingDeferredHandles = new Set<Deferred["handle"]>();
  const gate = createSubcallGate(maxParallel);

  let rejectFatal!: (reason: Error) => void;
  const fatalPromise = new Promise<never>((_res, rej) => {
    rejectFatal = rej;
  });
  // Avoid Node unhandled-rejection noise when `settledPromise` wins `Promise.race` first.
  fatalPromise.catch(() => {});

  const onAbort = () => {
    interruptedReason = "Execution cancelled.";
    rejectFatal(new Error(interruptedReason));
  };
  opts.signal?.addEventListener("abort", onAbort, { once: true });

  const wallTimer = setTimeout(() => {
    interruptedReason = `Execution exceeded wall-clock timeout (${maxWallMs} ms).`;
    rejectFatal(new Error(interruptedReason));
  }, maxWallMs);
  wallTimer.unref?.();

  const pumpJobsSafely = () => {
    if (closed) return;
    syncSliceDeadline = Date.now() + maxSyncCpuMs;
    try {
      vm.executePendingJobs();
    } catch (err) {
      const msg = interruptedReason ?? (err instanceof Error ? err.message : String(err));
      rejectFatal(new Error(msg));
    }
  };

  try {
    const logFn = vm.newFunction("__openlen_log", (levelH, msgH) => {
      const level = String(vm.dump(levelH) ?? "log");
      const msg = String(vm.dump(msgH) ?? "");
      const line = level === "log" || level === "info" ? msg : `[${level}] ${msg}`;
      if (!logTruncated) {
        if (loggedChars + line.length <= maxLogChars) {
          logs.push(line);
          loggedChars += line.length;
        } else {
          const room = Math.max(0, maxLogChars - loggedChars);
          if (room > 0) logs.push(line.slice(0, room));
          logs.push("…[console output truncated]…");
          logTruncated = true;
        }
      }
      return vm.undefined;
    });
    vm.setProp(vm.global, "__openlen_log", logFn);
    logFn.dispose();

    const callToolFn = vm.newFunction("__openlen_call_tool", (nameH, argsJsonH) => {
      const toolName = String(vm.dump(nameH) ?? "");
      const argsJson = String(vm.dump(argsJsonH) ?? "{}");
      const deferred = vm.newPromise();
      pendingDeferredHandles.add(deferred.handle);

      const settleWithError = (message: string) => {
        if (closed) return;
        const errH = vm.newError(message);
        deferred.reject(errH);
        errH.dispose();
        pumpJobsSafely();
      };

      const settleWithJson = (json: string) => {
        if (closed) return;
        const strH = vm.newString(json);
        deferred.resolve(strH);
        strH.dispose();
        pumpJobsSafely();
      };

      let parsedArgs: Record<string, unknown>;
      try {
        const parsed = JSON.parse(argsJson);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error(`Tool "${toolName}" expects an arguments object.`);
        }
        parsedArgs = parsed as Record<string, unknown>;
      } catch (err) {
        queueMicrotask(() => settleWithError(err instanceof Error ? err.message : String(err)));
        return deferred.handle;
      }

      if (INTERACTIVE_OR_CONTROL_TOOLS.has(toolName)) {
        queueMicrotask(() =>
          settleWithError(
            `Tool "${toolName}" requires direct interaction or turn control and cannot be called inside run_code. Call "${toolName}" directly as a top-level tool call.`,
          ),
        );
        return deferred.handle;
      }

      if (!opts.declaredTools.has(toolName)) {
        queueMicrotask(() =>
          settleWithError(
            `Tool "${toolName}" is not available in this session. Available tools can be called via tools.<exact_name>(args).`,
          ),
        );
        return deferred.handle;
      }

      subcallCount += 1;
      if (subcallCount > maxSubcalls) {
        queueMicrotask(() =>
          settleWithError(
            `run_code reached its limit of ${maxSubcalls} tool calls in a single script. Return what you have and continue in the next step if needed.`,
          ),
        );
        return deferred.handle;
      }

      const parallel = opts.isParallel ? opts.isParallel(toolName, parsedArgs) : false;
      const task = gate(parallel, async () => {
        if (closed || opts.signal?.aborted) {
          settleWithError("Execution cancelled.");
          return;
        }
        try {
          const response = await opts.callTool(toolName, parsedArgs);
          const ok = response.ok !== false && response.isError !== true;
          calls.push({ name: toolName, ok });
          settleWithJson(JSON.stringify(enrichToolResponse(response)));
        } catch (err) {
          calls.push({ name: toolName, ok: false });
          settleWithError(err instanceof Error ? err.message : String(err));
        }
      });
      inFlight.add(task);
      void task.finally(() => inFlight.delete(task));

      return deferred.handle;
    });
    vm.setProp(vm.global, "__openlen_call_tool", callToolFn);
    callToolFn.dispose();

    syncSliceDeadline = Date.now() + maxSyncCpuMs;
    vm.evalCode(GUEST_PRELUDE, "<code-mode-prelude>").dispose();

    // Wrap the stripped script in an async IIFE so both top-level `await` and
    // top-level `return` work naturally and evaluate to a standard ES Promise.
    const wrapped = `(async () => {\n${stripped.js}\n})()`;
    syncSliceDeadline = Date.now() + maxSyncCpuMs;
    const promiseHandle = vm.evalCode(wrapped, "run_code.ts");
    try {
      const settledPromise = vm.resolvePromise(promiseHandle);
      pumpJobsSafely();
      const outcome = await Promise.race([settledPromise, fatalPromise]);
      if ("error" in outcome) {
        const dumped = vm.dump(outcome.error);
        outcome.error.dispose();
        const errMessage =
          interruptedReason ??
          (dumped instanceof Error
            ? `${dumped.name}: ${dumped.message}`
            : typeof dumped === "object" && dumped !== null && "message" in dumped
              ? String((dumped as { message: unknown }).message)
              : String(dumped));
        const formatted = buildFormattedOutput({ ok: false, logs, calls, error: errMessage, returnText: "" });
        return { ok: false, logs, calls, error: errMessage, formatted };
      }
      const value = vm.dump(outcome.value);
      outcome.value.dispose();
      const returnText = formatReturnValue(value, maxReturnChars);
      const formatted = buildFormattedOutput({ ok: true, logs, calls, returnText });
      return { ok: true, value, logs, calls, formatted };
    } finally {
      promiseHandle.dispose();
    }
  } catch (err) {
    const errMessage = interruptedReason ?? (err instanceof Error ? err.message : String(err));
    const formatted = buildFormattedOutput({ ok: false, logs, calls, error: errMessage, returnText: "" });
    return { ok: false, logs, calls, error: errMessage, formatted };
  } finally {
    closed = true;
    clearTimeout(wallTimer);
    opts.signal?.removeEventListener("abort", onAbort);
    // Wait for any already-dispatched host tool call to settle so no DB write
    // continues orphaned after `run_code` finishes.
    if (inFlight.size > 0) {
      await Promise.allSettled([...inFlight]);
    }
    for (const h of pendingDeferredHandles) {
      try {
        h.dispose();
      } catch {
        // Disposed with VM.
      }
    }
    vm.dispose();
  }
}

function buildFormattedOutput(o: {
  readonly ok: boolean;
  readonly logs: readonly string[];
  readonly calls: readonly CodeModeSubcallRecord[];
  readonly returnText: string;
  readonly error?: string;
}): string {
  const sections: string[] = [];
  if (o.calls.length > 0) {
    const counts = new Map<string, number>();
    for (const c of o.calls) counts.set(c.name, (counts.get(c.name) ?? 0) + 1);
    const summary = [...counts.entries()].map(([n, k]) => (k > 1 ? `${n}×${k}` : n)).join(", ");
    sections.push(`[tools: ${summary}]`);
  }
  if (o.logs.length > 0) {
    sections.push(`Console:\n${o.logs.join("\n")}`);
  }
  if (!o.ok && o.error) {
    sections.push(`Error: ${o.error}`);
  } else if (o.returnText) {
    sections.push(o.logs.length > 0 ? `Return:\n${o.returnText}` : o.returnText);
  } else if (o.logs.length === 0) {
    sections.push("(completed with no output)");
  }
  return sections.join("\n\n");
}
