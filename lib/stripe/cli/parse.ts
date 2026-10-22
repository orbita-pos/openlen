// lib/stripe/cli/parse.ts — THE `stripe` COMMAND'S ARGUMENTS, read as the Stripe
// CLI reads them (spec local 2026-10-21-stripe-integration, §6.2). A resource
// command's flag is its parameter with `-` for `_`, a dot nests
// (`--recurring.interval=month` → `recurring[interval]`) and an array takes
// `[]` (pkg/cmd/resource/operation.go); `-d` passes a parameter verbatim. The
// key never comes from here: `login`, `config` and `--api-key` are answered
// with where the key comes from.

import { operationHelp, resourceHelp, ROOT_HELP } from "./help";
import { findResource, STRIPE_CLI_VERSION, type StripeOperationSpec } from "./specs";

export type FormPair = readonly [string, string];

export type StripeCommand =
  | {
      readonly kind: "operation";
      readonly op: StripeOperationSpec;
      readonly path: string;
      readonly form: readonly FormPair[];
      readonly live: boolean;
      readonly confirm: boolean;
      readonly idempotencyKey?: string;
    }
  | {
      readonly kind: "raw";
      readonly method: "GET" | "POST" | "DELETE";
      readonly path: string;
      readonly form: readonly FormPair[];
      readonly live: boolean;
      readonly confirm: boolean;
      readonly idempotencyKey?: string;
    }
  | { readonly kind: "trigger"; readonly event: string; readonly live: boolean }
  | { readonly kind: "listen" }
  | { readonly kind: "credentials"; readonly command: string }
  | { readonly kind: "help"; readonly text: string }
  | { readonly kind: "usage_error"; readonly message: string };

const HELP = new Set(["-h", "--help", "help"]);
const CREDENTIALS = new Set(["login", "logout", "config"]);
const RAW: Readonly<Record<string, "GET" | "POST" | "DELETE">> = { get: "GET", post: "POST", delete: "DELETE" };

/** `a.b` → `a[b]`, and `[]` after an array: the request name of a dotted parameter. */
function requestName(param: string, type: string): string {
  const [head, ...rest] = param.split(".");
  return `${head}${rest.map((p) => `[${p}]`).join("")}${type === "array" ? "[]" : ""}`;
}

interface Flags {
  readonly form: FormPair[];
  live: boolean;
  confirm: boolean;
  idempotencyKey?: string;
  readonly positional: string[];
}

/** The flags every request command takes, plus the operation's own (`params`, or none for get/post/delete). */
function readFlags(args: readonly string[], params: Readonly<Record<string, string>> | null): Flags | { error: string } {
  const out: Flags = { form: [], live: false, confirm: false, positional: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (!a.startsWith("-") || a === "-") {
      out.positional.push(a);
      continue;
    }
    const eq = a.indexOf("=");
    const flag = eq === -1 ? a : a.slice(0, eq);
    const inline = eq === -1 ? undefined : a.slice(eq + 1);
    const value = (): string | null => {
      if (inline !== undefined) return inline;
      const next = args[i + 1];
      if (next === undefined) return null;
      i++;
      return next;
    };
    if (flag === "--live") {
      out.live = true;
      continue;
    }
    if (flag === "-c" || flag === "--confirm") {
      out.confirm = true;
      continue;
    }
    if (flag === "-d" || flag === "--data") {
      const v = value();
      if (v === null) return { error: `flag needs an argument: ${flag}` };
      const k = v.indexOf("=");
      if (k <= 0) return { error: `invalid data argument: ${v}` };
      out.form.push([v.slice(0, k), v.slice(k + 1)]);
      continue;
    }
    if (flag === "-e" || flag === "--expand") {
      const v = value();
      if (v === null) return { error: `flag needs an argument: ${flag}` };
      out.form.push(["expand[]", v]);
      continue;
    }
    if (flag === "-i" || flag === "--idempotency") {
      const v = value();
      if (v === null) return { error: `flag needs an argument: ${flag}` };
      out.idempotencyKey = v;
      continue;
    }
    const param = flag.startsWith("--") ? flag.slice(2).replace(/-/g, "_") : null;
    const type = param && params ? params[param] : undefined;
    if (!param || !type) return { error: `unknown flag: ${flag}` };
    if (type === "boolean" && inline === undefined && (args[i + 1] === undefined || args[i + 1]!.startsWith("-") || !/^(true|false)$/.test(args[i + 1]!))) {
      out.form.push([requestName(param, type), "true"]);
      continue;
    }
    const v = value();
    if (v === null) return { error: `flag needs an argument: ${flag}` };
    out.form.push([requestName(param, type), v]);
  }
  return out;
}

export function parseStripeArgs(args: readonly string[]): StripeCommand {
  if (args.some((a) => a === "--api-key" || a.startsWith("--api-key="))) return { kind: "credentials", command: "--api-key" };
  const [first, ...rest] = args;
  if (first === undefined || HELP.has(first)) return { kind: "help", text: ROOT_HELP };
  if (first === "resources") return { kind: "help", text: ROOT_HELP };
  // pkg/cmd/root.go (`--version`, `-v`) and pkg/cmd/version.go print version.Template.
  if (first === "--version" || first === "-v" || first === "version") return { kind: "help", text: `stripe version ${STRIPE_CLI_VERSION}\n` };
  if (CREDENTIALS.has(first)) return { kind: "credentials", command: first };
  if (first === "listen") return { kind: "listen" };
  if (first === "trigger") {
    const event = rest.find((a) => !a.startsWith("-"));
    if (!event) return { kind: "usage_error", message: 'Error: requires at least 1 arg(s), only received 0\nUsage: stripe trigger <event>\n' };
    return { kind: "trigger", event, live: rest.includes("--live") };
  }

  const method = RAW[first];
  if (method) {
    const f = readFlags(rest, null);
    if ("error" in f) return { kind: "usage_error", message: `Error: ${f.error}\n` };
    const [path] = f.positional;
    if (!path || f.positional.length > 1) return { kind: "usage_error", message: `Error: accepts 1 arg(s), received ${f.positional.length}\nUsage: stripe ${first} <path>\n` };
    const full = path.startsWith("/") ? path : `/v1/${path}`;
    return { kind: "raw", method, path: full, form: f.form, live: f.live, confirm: f.confirm, ...(f.idempotencyKey ? { idempotencyKey: f.idempotencyKey } : {}) };
  }

  const r = findResource(args);
  if (!r) return { kind: "usage_error", message: `Error: unknown command "${first}" for "stripe"\nRun 'stripe --help' for usage.\n` };
  const after = args.slice(r.consumed);
  const [opName, ...opArgs] = after;
  if (opName === undefined || HELP.has(opName)) return { kind: "help", text: resourceHelp(r) };
  const op = Object.hasOwn(r.operations, opName) ? r.operations[opName]! : null;
  if (!op) return { kind: "usage_error", message: `Error: unknown command "${opName}" for "stripe ${r.name}"\n\n${resourceHelp(r)}` };
  if (opArgs.some((a) => HELP.has(a))) return { kind: "help", text: operationHelp(r.name, op) };

  const f = readFlags(opArgs, op.params);
  if ("error" in f) return { kind: "usage_error", message: `Error: ${f.error}\n\n${operationHelp(r.name, op)}` };
  const slots = op.path.match(/\{\w+\}/g) ?? [];
  if (f.positional.length !== slots.length) {
    return { kind: "usage_error", message: `Error: accepts ${slots.length} arg(s), received ${f.positional.length}\n\n${operationHelp(r.name, op)}` };
  }
  let path = op.path;
  for (const value of f.positional) path = path.replace(/\{\w+\}/, encodeURIComponent(value));
  return { kind: "operation", op, path, form: f.form, live: f.live, confirm: f.confirm, ...(f.idempotencyKey ? { idempotencyKey: f.idempotencyKey } : {}) };
}
