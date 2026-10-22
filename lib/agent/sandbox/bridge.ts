// The commands OpenLen still answers when the terminal is real (spec local
// 2026-10-21-real-terminal-e2b, §6): the ones that must give what the canvas and the publish give
// (the app's checks, its build, its tests, its packages) or that touch OpenLen's data (git's
// history in Postgres, the backend's database). Everything else runs for real in the box.
//
// The rules are today's terminal's (`comandosDeApp`, `comandoGit` and `comandoSupabase` in
// lib/agent/terminal/trabajador.mjs) with one difference: what there answered "isn't available
// here" (`npx <other>`, `npm run <other>`, a page's `npm`…) runs for real here.

import type { AppProgram } from "@/lib/agent/terminal/terminal";
import { stripeNeedsConfirmation } from "@/lib/stripe/cli/run";

import type { FunctionsCurlHandler } from "./functions-curl";

export interface BridgeRequest {
  readonly id: string;
  readonly program: string;
  readonly args: readonly string[];
  readonly cwd: string;
  /** The line the command read from its stdin, when the first answer asked for it (`readLine`). */
  readonly stdinLine?: string;
}

export type BoxRoute =
  | { readonly kind: "git" }
  | { readonly kind: "supabase" }
  | { readonly kind: "stripe" }
  | { readonly kind: "functions-curl" }
  | { readonly kind: "app"; readonly program: AppProgram; readonly args: readonly string[] }
  | { readonly kind: "passthrough" };

const NPM_INSTALL = ["install", "i", "add"];
const NPM_UNINSTALL = ["uninstall", "remove", "rm", "un", "r"];

/** What follows `test` (without the `--` npm puts before its own arguments). */
const after = (rest: readonly string[]) => (rest[0] === "--" ? rest.slice(1) : rest);

/** `npm test …`, `npm run test[:x] …`: the test script's arguments, or `null`. */
function testScript(args: readonly string[]): readonly string[] | null {
  const [sub, ...rest] = args;
  if (sub === "test" || sub === "t") return after(rest);
  if ((sub === "run" || sub === "run-script") && /^test(:\S+)?$/.test(rest[0] ?? "")) return after(rest.slice(1));
  return null;
}

const PASSTHROUGH: BoxRoute = { kind: "passthrough" };
const app = (program: AppProgram, args: readonly string[]): BoxRoute => ({ kind: "app", program, args: [...args] });

export function routeBoxCommand(
  program: string,
  args: readonly string[],
  o: { readonly isApp: boolean; readonly functionsUrls: readonly string[] },
): BoxRoute {
  if (program === "git") return { kind: "git" };
  if (program === "supabase") return { kind: "supabase" };
  // Stripe (spec local 2026-10-21-stripe-integration): never a real CLI in the box, the key stays out of it.
  if (program === "stripe") return { kind: "stripe" };
  if (program === "curl") return args.some((a) => o.functionsUrls.some((u) => a.startsWith(u))) ? { kind: "functions-curl" } : PASSTHROUGH;
  if (!o.isApp) return PASSTHROUGH;
  if (program === "tsc" || program === "eslint") return app(program, args);
  if (program === "vitest") return app("test", args);
  if (program === "npx") {
    const from = args.findIndex((a) => !a.startsWith("-"));
    const [tool, ...its] = from < 0 ? [] : args.slice(from);
    if (tool === "tsc" || tool === "eslint") return app(tool, its);
    if (tool === "vitest") return app("test", its);
    return PASSTHROUGH;
  }
  if (program === "npm") {
    const [sub, ...rest] = args;
    if (NPM_INSTALL.includes(sub ?? "")) return app("npm-install", rest);
    if (NPM_UNINSTALL.includes(sub ?? "")) return app("npm-uninstall", rest);
    if (sub === "ls" || sub === "list") return app("npm-ls", rest);
    const tests = testScript(args);
    if (tests) return app("test", tests);
    if (sub === "run" || sub === "run-script") {
      if (rest[0] === "lint") return app("eslint", ["."]);
      if (rest[0] === "typecheck" || rest[0] === "type-check") return app("tsc", ["--noEmit"]);
      if (rest[0] === "build") return app("build", []);
    }
  }
  return PASSTHROUGH;
}

/** The same handlers today's terminal gets (lib/agent/terminal/herramienta.ts). */
export interface BridgeHandlers {
  readonly git?: (
    args: readonly string[],
    cwd: string,
    files: Readonly<Record<string, string>>,
  ) => Promise<{ stdout: string; stderr: string; exitCode: number; write?: Readonly<Record<string, string | null>> }>;
  readonly supabase?: (
    args: readonly string[],
    files: Readonly<Record<string, string>>,
    o?: { readonly signal?: AbortSignal },
  ) => Promise<{ stdout: string; stderr: string; exitCode: number; escribir?: Record<string, string>; borrar?: string[] }>;
  readonly appTools?: {
    readonly run: (
      program: AppProgram,
      args: readonly string[],
      files: Readonly<Record<string, string>>,
      timeLeftMs?: number,
      signal?: AbortSignal,
    ) => Promise<{ stdout: string; stderr: string; exitCode: number; files?: Readonly<Record<string, string | null>> }>;
  };
  /** `stripe …` with the project's key, answered by OpenLen (lib/stripe/cli/real.ts). */
  readonly stripe?: (
    args: readonly string[],
    o?: { readonly signal?: AbortSignal; readonly stdin?: string },
  ) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
  /** The project's Edge Functions' URLs (FunctionsCurl.prefixes). */
  readonly functionsUrls?: readonly string[];
  /** `curl` to one of them, through OpenLen's door (./functions-curl.ts). */
  readonly functionsCurl?: FunctionsCurlHandler;
}

export type BridgeAnswer =
  | { readonly passthrough: true }
  /** Read one line of the command's stdin and ask again with it (`stdinLine`). */
  | { readonly readLine: true }
  | { readonly stdout: string; readonly stderr: string; readonly exitCode: number; readonly files: Readonly<Record<string, string | null>> };

function abortable<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return work;
  if (signal.aborted) return Promise.reject(new DOMException("The turn was stopped", "AbortError"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException("The turn was stopped", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (v) => (signal.removeEventListener("abort", onAbort), resolve(v)),
      (e) => (signal.removeEventListener("abort", onAbort), reject(e)),
    );
  });
}

/** Answers one request from the box; `files` is the project's tree as the box has it now. */
export async function answerBridgeRequest(
  req: BridgeRequest,
  handlers: BridgeHandlers,
  files: Readonly<Record<string, string>>,
  o: { readonly signal?: AbortSignal; readonly timeLeftMs?: number } = {},
): Promise<BridgeAnswer> {
  const route = routeBoxCommand(req.program, req.args, { isApp: Boolean(handlers.appTools), functionsUrls: handlers.functionsUrls ?? [] });
  switch (route.kind) {
    case "git": {
      if (!handlers.git) return { passthrough: true };
      const r = await abortable(handlers.git(req.args, req.cwd, files), o.signal);
      return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode, files: { ...(r.write ?? {}) } };
    }
    case "supabase": {
      if (!handlers.supabase) return { passthrough: true };
      const r = await abortable(handlers.supabase(req.args, files, { signal: o.signal }), o.signal);
      const out: Record<string, string | null> = { ...(r.escribir ?? {}) };
      for (const p of r.borrar ?? []) out[p] = null;
      return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode, files: out };
    }
    case "stripe": {
      if (!handlers.stripe) return { stdout: "", stderr: "stripe: not available in this project\n", exitCode: 127, files: {} };
      // The CLI reads a DELETE's confirmation from stdin, one line, and only then: the box reads that
      // line only when asked, so it takes nothing from a pipe the real CLI wouldn't have read.
      if (req.stdinLine === undefined && stripeNeedsConfirmation(req.args)) return { readLine: true };
      const r = await abortable(handlers.stripe(req.args, { signal: o.signal, ...(req.stdinLine !== undefined ? { stdin: req.stdinLine } : {}) }), o.signal);
      return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode, files: {} };
    }
    case "functions-curl": {
      if (!handlers.functionsCurl) return { passthrough: true };
      const r = await abortable(handlers.functionsCurl(req.args, req.cwd, files, { signal: o.signal }), o.signal);
      return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode, files: { ...r.files } };
    }
    case "app": {
      if (!handlers.appTools) return { passthrough: true };
      const r = await abortable(handlers.appTools.run(route.program, route.args, files, o.timeLeftMs, o.signal), o.signal);
      return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode, files: { ...(r.files ?? {}) } };
    }
    case "passthrough":
      return { passthrough: true };
  }
}
