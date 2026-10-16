// lib/security-review/view.ts — what the owner and Len see of a review:
//   · the HIGH findings not accepted, which block;
//   · the MEDIUM ones, which are only shown;
//   · the accepted ones.
// The rules' findings always count; the model's only once its review is done.
// Len reads one English line per finding, never a secret's value.

import type { Finding, ReviewRecord, ReviewView } from "./types";

export function buildView(r: ReviewRecord, accepted: ReadonlyMap<string, Finding>): ReviewView {
  const all = [...r.phase0, ...(r.status === "done" ? r.findings : [])];
  return {
    fingerprint: r.fingerprint,
    status: r.status,
    blocking: all.filter((f) => f.severity === "HIGH" && !accepted.has(f.key)),
    medium: all.filter((f) => f.severity === "MEDIUM" && !accepted.has(f.key)),
    accepted: all.filter((f) => accepted.has(f.key)),
  };
}

const VERBS: Readonly<Record<string, string>> = { UPDATE: "change", DELETE: "delete", ALL: "read, change and delete" };

export function findingLineForAgent(f: Finding): string {
  const p = f.params ?? {};
  const where = f.file ? `${f.file}${f.line ? `:${f.line}` : ""}` : p.variable ? `the variable ${p.variable}` : "the database";
  switch (f.category) {
    case "rls_disabled":
      return `[rls_disabled] Table public.${p.table} has Row Level Security off: anyone with the page's public key can read, change and delete every row. Fix: enable RLS on it in a new migration and add policies for what each role may do.`;
    case "policy_open_write":
      return `[policy_open_write] Policy "${p.policy}" on ${p.table} lets anyone, signed in or not, ${VERBS[p.command ?? ""] ?? "change"} its rows (USING true). Fix: limit it to each row's owner in a new migration.`;
    case "secret_in_client":
      return `[secret_in_client] A ${p.provider || "private"} secret key reaches the browser in ${where}. Fix: remove it from browser code, tell the owner to roll it, and use it only inside an Edge Function, as a secret.`;
    case "test_secret_in_client":
      return `[test_secret_in_client] A ${p.provider} test key reaches the browser in ${where}. Fix: move it to an Edge Function secret.`;
    default:
      return `[${f.category}] ${where} — ${f.description}${f.recommendation ? ` Fix: ${f.recommendation}` : ""}`;
  }
}

export const ENDING_FOR_LEN =
  "Fix them, then call publish again. If the owner should decide instead, call publish again without changes: the publish card will show them these issues.";
export const ENDING_FOR_MCP =
  "Fix them and call publish again. Accepting them is the owner's decision: they can publish anyway from the publish dialog in OpenLen.";

export function agentBlockedText(v: ReviewView, ending: string): string {
  const n = v.blocking.length;
  return [
    `Security review found ${n} high-severity issue${n === 1 ? "" : "s"} (nothing was published):`,
    ...v.blocking.map((f, k) => `${k + 1}. ${findingLineForAgent(f)}`),
    ending,
  ].join("\n");
}
