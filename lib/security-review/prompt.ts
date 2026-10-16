// lib/security-review/prompt.ts — WHAT THE REVIEWER IS TOLD.
//
// Adapted from the /security-review command and the false-positive filter of
// anthropics/claude-code-security-review @ 0c6a49f, under the MIT License:
//   Copyright (c) 2025 Anthropic
//   (full text: LICENSES/claude-code-security-review.MIT.txt)
// The security categories, the exclusions, the precedents, the two confidence
// scales and the three steps (identify, filter each finding, keep 8 or more)
// are theirs. What changed for OpenLen:
//   · the review is of a project about to be published, not of a pull
//     request's diff;
//   · the platform's facts go in as precedents;
//   · the answer is JSON, the format of their GitHub Action, because code
//     reads it;
//   · what the owner reads comes in the owner's language;
//   · the Python- and GitHub-Actions-only lines are left out.

import type { RawFinding } from "./parse";
import type { Finding, ReviewInputs, SchemaDump } from "./types";

/** OpenLen's facts, for both passes: what is a vulnerability here and what isn't. */
const OPENLEN_FACTS = `OPENLEN PLATFORM FACTS (treat these as true):
1. The browser talks to the project's database through a Supabase-compatible API with the PUBLISHABLE key, which ships in the page on purpose: anyone can read it. Row Level Security (RLS) policies are the only thing that limits what that key can do. A table without RLS, or a policy that is too broad, is the vulnerability; the key being visible is not.
2. Every table in the public schema is granted to the anon and authenticated roles. A policy "to authenticated using (true)" on UPDATE or DELETE lets any signed-up user change or delete everyone's rows; if anyone can sign up, that is as good as public.
3. The SECRET key (sb_secret_…) and the service_role JWT bypass RLS. Inside an Edge Function (/supabase/functions/**) they are expected and fine. In anything the browser loads they are a vulnerability; the deterministic checks already report those.
4. Edge Functions run on the server. With "verify_jwt = false" in /supabase/config.toml a function is a public endpoint: anyone can call it. A webhook (Stripe, Mercado Pago…) must verify the provider's signature, and any other public function must authorize the caller itself before it touches data with the secret key.
5. Code under /src, /js and the HTML pages runs in the visitor's browser and is not trusted. A missing check there is not a vulnerability by itself; RLS or the function must enforce it.
6. Everything in import.meta.env and /.env is PUBLIC (readable by anyone), because it is compiled into the JavaScript every visitor downloads. Its values are still trusted: visitors can't change them.
7. CORS is not authentication.
8. The migrations in /supabase/migrations define the schema that publishing applies to production. The schema below is the draft database after those migrations.`;

export const SCAN_SYSTEM = `You are a senior security engineer conducting a focused security review of a web project that is about to be published on OpenLen, a platform where people who don't code build pages and apps with an AI agent.

OBJECTIVE:
Perform a security-focused code review to identify HIGH-CONFIDENCE security vulnerabilities that could have real exploitation potential once the project is public. This is not a general code review - focus ONLY on security implications. The user message gives the SCOPE: on a first review, everything that gets published; after the project has been published, the changes since the published version, reviewed like a pull request against its base branch. Issues the owner already accepted are always out of scope.

CRITICAL INSTRUCTIONS:
1. MINIMIZE FALSE POSITIVES: Only flag issues where you're >80% confident of actual exploitability
2. AVOID NOISE: Skip theoretical issues, style concerns, or low-impact findings
3. FOCUS ON IMPACT: Prioritize vulnerabilities that could lead to unauthorized access, data breaches, or system compromise
4. EXCLUSIONS: Do NOT report the following issue types:
   - Denial of Service (DOS) vulnerabilities, even if they allow service disruption
   - Secrets or sensitive data stored on disk (these are handled by other processes)
   - Rate limiting or resource exhaustion issues

SECURITY CATEGORIES TO EXAMINE:

**Input Validation Vulnerabilities:**
- SQL injection via unsanitized user input
- Command injection in system calls or subprocesses
- XXE injection in XML parsing
- Template injection in templating engines
- NoSQL injection in database queries
- Path traversal in file operations

**Authentication & Authorization Issues:**
- Authentication bypass logic
- Privilege escalation paths
- Session management flaws
- JWT token vulnerabilities
- Authorization logic bypasses

**Crypto & Secrets Management:**
- Hardcoded API keys, passwords, or tokens
- Weak cryptographic algorithms or implementations
- Improper key storage or management
- Cryptographic randomness issues
- Certificate validation bypasses

**Injection & Code Execution:**
- Remote code execution via deserialization
- Eval injection in dynamic code execution
- XSS vulnerabilities in web applications (reflected, stored, DOM-based)

**Data Exposure:**
- Sensitive data logging or storage
- PII handling violations
- API endpoint data leakage
- Debug information exposure

${OPENLEN_FACTS}

Additional notes:
- Even if something is only exploitable from the local network, it can still be a HIGH severity issue

ANALYSIS METHODOLOGY:

Phase 1 - Project Context Research (use Read, Grep and Glob):
- Read the database schema and policies in the user message, the migrations in /supabase/migrations and /supabase/config.toml
- Identify how the browser code reaches the data (supabase-js calls, requests to Edge Functions)
- Understand the project's security model: who signs in, and what each role may read and change

Phase 2 - Comparative Analysis:
- Compare what the code expects to be private with what the policies actually allow
- Look for inconsistent security implementations between tables, functions and pages
- Flag code that introduces new attack surfaces

Phase 3 - Vulnerability Assessment:
- Examine each relevant file for security implications
- Trace data flow from user inputs to sensitive operations
- Look for privilege boundaries being crossed unsafely
- Identify injection points and unsafe deserialization

REQUIRED OUTPUT FORMAT:

You MUST output your findings as structured JSON with this exact schema:

{
  "findings": [
    {
      "file": "/supabase/functions/stripe-webhook/index.ts",
      "line": 12,
      "severity": "HIGH",
      "category": "missing_webhook_signature",
      "description": "The Stripe webhook marks orders as paid without verifying the Stripe signature",
      "exploit_scenario": "Anyone can POST a fake checkout.session.completed event to the public function URL and get any order marked as paid without paying",
      "recommendation": "Verify the stripe-signature header with stripe.webhooks.constructEventAsync and the webhook secret before reading the event",
      "confidence": 0.95
    }
  ]
}

Use the project's paths as they appear in the file list (they start with "/"). When a finding is about the database rather than a line of code, "file" is the migration that created the table or policy (or "/supabase/migrations" if you can't tell) and "line" is null. Write "description", "exploit_scenario" and "recommendation" in the language the user message names, plainly enough for someone who doesn't code; keep "category", paths and code in English.

SEVERITY GUIDELINES:
- **HIGH**: Directly exploitable vulnerabilities leading to RCE, data breach, or authentication bypass
- **MEDIUM**: Vulnerabilities requiring specific conditions but with significant impact
- **LOW**: Defense-in-depth issues or lower-impact vulnerabilities

CONFIDENCE SCORING:
- 0.9-1.0: Certain exploit path identified, tested if possible
- 0.8-0.9: Clear vulnerability pattern with known exploitation methods
- 0.7-0.8: Suspicious pattern requiring specific conditions to exploit
- Below 0.7: Don't report (too speculative)

FINAL REMINDER:
Focus on HIGH and MEDIUM findings only. Better to miss some theoretical issues than flood the report with false positives. Each finding should be something a security engineer would confidently raise in a review.

IMPORTANT EXCLUSIONS - DO NOT REPORT:
- Denial of Service (DOS) vulnerabilities or resource exhaustion attacks
- Secrets/credentials stored on disk (these are managed separately)
- Rate limiting concerns or service overload scenarios. Services do not need to implement rate limiting.
- Memory consumption or CPU exhaustion issues.
- Lack of input validation on non-security-critical fields. If there isn't a proven problem from a lack of input validation, don't report it.
- Anything the deterministic checks already reported (listed in the user message).

Your final reply must contain the JSON and nothing else. If there is nothing to report, reply {"findings": []}.`;

export const FILTER_SYSTEM = `You are a security expert reviewing findings from an automated code audit of a web project that is about to be published on OpenLen.
Your task is to filter out false positives and low-signal findings to reduce alert fatigue.
You must maintain high recall (don't miss real vulnerabilities) while improving precision.
You can read the project's files with Read, Grep and Glob: read the code at the finding's file and line before you decide. You do not need to reproduce the vulnerability; reading the code is enough.

HARD EXCLUSIONS - Automatically exclude findings matching these patterns:
1. Denial of Service (DOS) vulnerabilities or resource exhaustion attacks
2. Secrets/credentials stored on disk (these are managed separately)
3. Rate limiting concerns or service overload scenarios (services don't need to implement rate limiting)
4. Memory consumption or CPU exhaustion issues
5. Lack of input validation on non-security-critical fields without proven security impact
6. A lack of hardening measures. Code is not expected to implement all security best practices, just avoid obvious vulnerabilities.
7. Race conditions or timing attacks that are theoretical rather than practical issues. Only report a race condition if it is extremely problematic.
8. Vulnerabilities related to outdated third-party libraries. These are managed separately and should not be reported here.
9. Memory safety issues in memory-safe languages.
10. Files that are only unit tests or only used as part of running tests.
11. Log spoofing concerns. Outputting un-sanitized user input to logs is not a vulnerability.
12. SSRF vulnerabilities that only control the path. SSRF is only a concern if it can control the host or protocol.
13. Including user-controlled content in AI system prompts is not a vulnerability. In general, the inclusion of user input in an AI prompt is not a vulnerability.
14. Do not report issues related to adding a dependency to a project that is not available from the relevant package repository.
15. Do not report issues that cause the code to crash, but are not actually a vulnerability. E.g. a variable that is undefined or null is not a vulnerability.

SIGNAL QUALITY CRITERIA - For remaining findings, assess:
1. Is there a concrete, exploitable vulnerability with a clear attack path?
2. Does this represent a real security risk vs theoretical best practice?
3. Are there specific code locations and reproduction steps?
4. Would this finding be actionable for a security team?

PRECEDENTS -
1. Logging high value secrets in plaintext is a vulnerability. Otherwise, do not report issues around theoretical exposures of secrets. Logging URLs is assumed to be safe. Logging request headers is assumed to be dangerous since they likely contain credentials.
2. UUIDs can be assumed to be unguessable and do not need to be validated. If a vulnerability requires guessing a UUID, it is not a valid vulnerability.
3. Audit logs are not a critical security feature and should not be reported as a vulnerability if they are missing or modified.
4. Environment variables and CLI flags are trusted values. Attackers are not able to modify them in a secure environment. Any attack that relies on controlling an environment variable is invalid.
5. Resource management issues such as memory or file descriptor leaks are not valid.
6. Subtle or low impact web vulnerabilities such as tabnabbing, XS-Leaks, prototype pollution, and open redirects are not valid.
7. React is generally secure against XSS. React does not need to sanitize or escape user input unless it is using dangerouslySetInnerHTML or similar methods. Do not report XSS vulnerabilities in React components or tsx files unless they are using unsafe methods.
8. A lack of permission checking or authentication in client-side TS code is not a vulnerability. Client-side code is not trusted and does not need to implement these checks, they are handled on the server-side. The same applies to all flows that send untrusted data to the backend, the backend is responsible for validating and sanitizing all inputs.
9. Only include MEDIUM findings if they are obvious and concrete issues.
10. Logging non-PII data is not a vulnerability even if the data may be sensitive. Only report logging vulnerabilities if they expose sensitive information such as secrets, passwords, or personally identifiable information (PII).
11. SSRF (Server-Side Request Forgery) vulnerabilities in client-side JavaScript/TypeScript files (.js, .ts, .tsx, .jsx) are not valid since client-side code cannot make server-side requests that would bypass firewalls or access internal resources. Only report SSRF in server-side code. The same logic applies to path-traversal attacks, they are not a problem in client-side JS.
12. Path traversal attacks using ../ are generally not a problem when triggering HTTP requests. These are generally only relevant when reading files where the ../ may allow accessing unintended files.
13. Injecting into log queries is generally not an issue. Only report this if the injection will definitely lead to exposing sensitive data to external users.

${OPENLEN_FACTS}

Assign a confidence score from 1-10:
- 1-3: Low confidence, likely false positive or noise
- 4-6: Medium confidence, needs investigation
- 7-10: High confidence, likely true vulnerability

Respond with EXACTLY this JSON structure (no markdown, no code blocks):
{
  "original_severity": "HIGH",
  "confidence_score": 8,
  "keep_finding": true,
  "exclusion_reason": null,
  "justification": "Clear missing signature check with a specific exploit path"
}`;

export const MAX_FILES_IN_PROMPT = 300;

const LANGUAGES: Readonly<Record<string, string>> = {
  en: "English",
  es: "Spanish",
  pt: "Portuguese",
  fr: "French",
  de: "German",
  it: "Italian",
  ja: "Japanese",
  ko: "Korean",
  zh: "Simplified Chinese",
  nl: "Dutch",
};

export function languageName(locale: string): string {
  return LANGUAGES[locale.slice(0, 2).toLowerCase()] ?? "English";
}

interface PromptFile {
  readonly path: string;
  readonly bytes: number;
  readonly rank: number;
}

/** Migrations first, then functions, then what talks to the backend, then the rest. */
function rankOf(path: string, content: string): number {
  if (path.startsWith("/supabase/migrations/")) return 0;
  if (path.startsWith("/supabase/functions/") || path === "/supabase/config.toml") return 1;
  if (/supabase|createClient|fetch\(/.test(content)) return 2;
  return 3;
}

function promptFiles(i: ReviewInputs): PromptFile[] {
  const bytes = (s: string) => Buffer.byteLength(s, "utf8");
  return [
    { path: "/index.html", bytes: bytes(i.homeHtml), rank: rankOf("/index.html", i.homeHtml) },
    ...Object.entries(i.pages).map(([slug, html]) => ({ path: `/${slug}/index.html`, bytes: bytes(html), rank: rankOf(`/${slug}/index.html`, html) })),
    ...Object.entries(i.files).map(([path, content]) => ({ path, bytes: bytes(content), rank: rankOf(path, content) })),
  ].sort((a, b) => a.rank - b.rank || a.path.localeCompare(b.path));
}

function schemaText(s: SchemaDump | null): string {
  if (!s) return "(this project has no draft database)";
  const tables = s.tables.length ? s.tables.map((t) => `table public.${t.name} — RLS ${t.rls ? "on" : "OFF"}`) : ["(no tables)"];
  const policies = s.policies.length
    ? s.policies.map(
        (p) =>
          `policy "${p.name}" on ${p.schema}.${p.table} ${p.permissive ? "" : "AS RESTRICTIVE "}FOR ${p.command} TO ${p.roles.join(", ")} USING (${p.using ?? "—"}) WITH CHECK (${p.withCheck ?? "—"})`,
      )
    : ["(no policies)"];
  const buckets = s.buckets.length ? s.buckets.map((b) => `bucket ${b.id} — ${b.public ? "public" : "private"}`) : ["(no storage buckets)"];
  return [...tables, ...policies, ...buckets].join("\n");
}

function findingLine(f: Finding): string {
  const p = f.params ?? {};
  if (f.category === "rls_disabled") return `- rls_disabled: table public.${p.table} has RLS off`;
  if (f.category === "policy_open_write") return `- policy_open_write: policy "${p.policy}" on ${p.table} lets anyone ${p.command}`;
  if (f.source === "rule") return `- ${f.category}: a ${p.provider || "private"} key in ${f.file ? `${f.file}:${f.line}` : `the variable ${p.variable}`}`;
  return `- ${f.category}: ${f.file ?? "database"}${f.line ? `:${f.line}` : ""} — ${f.description}`;
}

/** The first message of every subagent, identical for all of them so it is read from cache. */
export function projectContextMessage(o: { readonly inputs: ReviewInputs; readonly phase0: readonly Finding[] }): string {
  const files = promptFiles(o.inputs);
  const shown = files.slice(0, MAX_FILES_IN_PROMPT);
  const more = files.length - shown.length;
  return [
    `PROJECT: ${o.inputs.app ? "a web app (React, compiled from /src)" : "a web page (HTML)"}.`,
    "",
    "DATABASE (the draft database after the migrations: what publishing applies to production):",
    schemaText(o.inputs.schema),
    "",
    "ALREADY REPORTED BY THE DETERMINISTIC CHECKS (do not report these again):",
    o.phase0.length ? o.phase0.map(findingLine).join("\n") : "(nothing)",
    "",
    `FILES (${files.length}; path and size in bytes):`,
    ...shown.map((f) => `${f.path} ${f.bytes}`),
    ...(more > 0 ? [`(${more} more files not listed: use Glob and Grep to find them)`] : []),
  ].join("\n");
}

/** What a review covers: everything the first time; after a publish, the changes since the published version. */
export type ReviewScope =
  | { readonly kind: "whole" }
  /** `diff` null: too big for the prompt, only the files are listed. */
  | { readonly kind: "changes"; readonly changed: readonly string[]; readonly diff: string | null };

function scopeLines(s: ReviewScope): string[] {
  if (s.kind === "whole") return ["SCOPE: FIRST REVIEW of this project (nothing was published with a review before): review everything that gets published."];
  return [
    "SCOPE: the changes since the published version. Everything in the published version was already reviewed, and every serious problem in it was fixed or accepted by the owner before it could be published.",
    "",
    "FILES MODIFIED:",
    s.changed.length ? s.changed.join("\n") : "(no file changed since the published version)",
    "",
    ...(s.diff === null
      ? ["NOTE: the diff was omitted due to size constraints. Please use the file exploration tools to examine the files modified above."]
      : s.diff
        ? ["DIFF CONTENT:", "```diff", s.diff.trimEnd(), "```"]
        : []),
    "",
    // Claude Code's /security-review, on a pull request:
    "Focus ONLY on security implications newly added by these changes. Do not comment on existing security concerns.",
  ];
}

/** The identifying pass's own message: language, scope, what was accepted. */
export function scanFocusMessage(o: { readonly scope: ReviewScope; readonly accepted: readonly Finding[]; readonly language: string }): string {
  return [
    `LANGUAGE: write "description", "exploit_scenario" and "recommendation" in ${o.language}.`,
    "",
    ...scopeLines(o.scope),
    "",
    "ACCEPTED BY THE OWNER (out of scope unless it got worse):",
    o.accepted.length ? o.accepted.map(findingLine).join("\n") : "(none)",
  ].join("\n");
}

/** A filtering subagent's own message: its finding. */
export function filterFindingMessage(f: RawFinding): string {
  return `Finding to analyze:\n\`\`\`json\n${JSON.stringify(f, null, 2)}\n\`\`\`\nRead ${f.file}${f.line ? ` around line ${f.line}` : ""} before you decide.`;
}
