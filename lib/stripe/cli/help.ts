// lib/stripe/cli/help.ts — WHAT `stripe … --help` PRINTS, in the shape of the
// Stripe CLI's own help (its operation usage template, pkg/cmd/resource/operation.go,
// Apache License 2.0): the usage line, the operations of a resource, and the
// request parameters and flags of an operation.

import { STRIPE_CLI_RESOURCES, type StripeOperationSpec, type StripeResourceSpec } from "./specs";

const flagName = (param: string) => param.replace(/_/g, "-");

export const ROOT_HELP = [
  "Usage:",
  "  stripe [command]",
  "",
  "Resource commands:",
  ...STRIPE_CLI_RESOURCES.map((r) => `  ${r}`),
  "",
  "Other commands:",
  "  get, post, delete   Make a request to a path of the API (stripe get /v1/balance)",
  "  trigger             Trigger a test webhook event",
  "  listen              Show where test events are sent",
  "",
  "Flags:",
  "  --live   Make a live-mode request (read-only here)",
  "",
  'Use "stripe [command] --help" for more information about a command.',
  "",
].join("\n");

export function resourceHelp(r: StripeResourceSpec): string {
  return [
    "Usage:",
    `  stripe ${r.name} <operation> [parameters...]`,
    "",
    "Available Operations:",
    ...Object.keys(r.operations).sort().map((o) => `  ${o}`),
    "",
    `Use "stripe ${r.name} [operation] --help" for more information about an operation.`,
    "",
  ].join("\n");
}

export function operationHelp(resource: string, op: StripeOperationSpec): string {
  const urlArgs = (op.path.match(/\{\w+\}/g) ?? []).map((a) => `<${a.slice(1, -1)}>`).join(" ");
  const params = Object.entries(op.params).sort(([a], [b]) => a.localeCompare(b));
  return [
    "Usage:",
    `  stripe ${resource} ${op.name} ${urlArgs ? `${urlArgs} ` : ""}[--param=value] [--parent[child]=value] [-d "nested[param]=value"]`,
    ...(params.length > 0 ? ["", "Request Parameters:", ...params.map(([p, t]) => `      --${flagName(p)}${t === "boolean" ? "" : ` ${t === "integer" || t === "number" ? "int" : t === "array" ? "stringArray" : "string"}`}`)] : []),
    "",
    "Flags:",
    "  -c, --confirm              Skip the warning prompt and automatically confirm the command being entered",
    '  -d, --data stringArray     Data for the API request',
    "  -e, --expand stringArray   Response attributes to expand inline",
    "  -i, --idempotency string   Set the idempotency key for the request, prevents replaying the same requests within 24 hours",
    "      --live                 Make a live request (default: test)",
    "",
  ].join("\n");
}
