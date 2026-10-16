// lib/security-review/rules.ts — PHASE 0. These are known without a model, on
// every project, for free (spec local 2026-10-15-security-review-design, 4.2):
//   · a table of `public` with RLS off. The grants hand it to the public key;
//   · a PERMISSIVE policy for UPDATE, DELETE or ALL, to anon or public, whose
//     USING is literally `true`. An open INSERT (a contact form) is fine, and an
//     open SELECT is the model's to judge: reading the menu is fine, reading the
//     orders is not;
//   · a secret key in what reaches the browser. lib/apps/env/secret-patterns.ts
//     knows the formats; a TEST key is MEDIUM.
// Each finding has a STABLE key, and an acceptance is remembered by it.

import { findSecretsInText, secretMode, SECRET_PROVIDER } from "@/lib/apps/env/secret-patterns";

import { clientShippedTexts, type ShippedText } from "./client-files";
import type { Finding, ReviewInputs, RuleId, SchemaDump, Severity } from "./types";

const OPEN_WRITE_COMMANDS: ReadonlySet<string> = new Set(["UPDATE", "DELETE", "ALL"]);
const PUBLIC_ROLES: ReadonlySet<string> = new Set(["anon", "public"]);

export function runRules(i: ReviewInputs): Finding[] {
  return [...schemaRules(i.schema), ...secretRules(clientShippedTexts(i))];
}

function ruleFinding(
  rule: RuleId,
  severity: Severity,
  key: string,
  where: { readonly file: string | null; readonly line: number | null },
  params: Readonly<Record<string, string>>,
): Finding {
  return { key, source: "rule", severity, category: rule, file: where.file, line: where.line, description: "", exploitScenario: "", recommendation: "", params };
}

/** `(true)`, ` TRUE ` → `true`. */
function bareExpression(e: string | null): string {
  let s = (e ?? "").trim();
  while (s.startsWith("(") && s.endsWith(")")) s = s.slice(1, -1).trim();
  return s.toLowerCase();
}

const NOWHERE = { file: null, line: null } as const;

function schemaRules(s: SchemaDump | null): Finding[] {
  if (!s) return [];
  const out: Finding[] = [];
  for (const t of s.tables) {
    if (!t.rls) out.push(ruleFinding("rls_disabled", "HIGH", `rls_disabled:public.${t.name}`, NOWHERE, { table: t.name }));
  }
  for (const p of s.policies) {
    if (!p.permissive || !OPEN_WRITE_COMMANDS.has(p.command)) continue;
    if (!p.roles.some((r) => PUBLIC_ROLES.has(r))) continue;
    if (bareExpression(p.using) !== "true") continue;
    const table = p.schema === "public" ? p.table : `${p.schema}.${p.table}`;
    out.push(ruleFinding("policy_open_write", "HIGH", `policy_open_write:${p.schema}.${p.table}.${p.name}`, NOWHERE, { table, policy: p.name, command: p.command }));
  }
  return out;
}

function lineAt(text: string, index: number): number {
  let line = 1;
  for (let k = 0; k < index; k++) if (text.charCodeAt(k) === 10) line++;
  return line;
}

function secretRules(texts: readonly ShippedText[]): Finding[] {
  const out: Finding[] = [];
  const seen = new Set<string>();
  for (const { path, text } of texts) {
    for (const s of findSecretsInText(text)) {
      const test = secretMode(s.value) === "test";
      const rule: RuleId = test ? "test_secret_in_client" : "secret_in_client";
      const key = `${rule}:${path}:${s.kind}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const variable = path.startsWith("env:") ? path.slice("env:".length) : null;
      // Never the value: a finding is stored and shown, and the key would travel with it.
      const params: Record<string, string> = { provider: s.kind === "private_key" ? "" : SECRET_PROVIDER[s.kind] };
      if (variable) params.variable = variable;
      out.push(ruleFinding(rule, test ? "MEDIUM" : "HIGH", key, variable ? NOWHERE : { file: path, line: lineAt(text, s.start) }, params));
    }
  }
  return out;
}
