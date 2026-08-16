import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/** The gate is only one gate while nothing else can do its job. Six months
 *  from now someone in a hurry will import sealRelease directly; this is what
 *  tells them why they should not.
 *
 *  This is a ratchet, not a claim that today's five callers are clean.
 *  Verified against `git grep` on 2026-08-15 (see task-4-report.md for the
 *  full audit). Each entry says how it uses sealRelease; where that use
 *  cannot be honestly called equivalent to the gate, the comment says so
 *  instead of pretending otherwise. The test's job is only to stop a SIXTH
 *  caller from appearing without the same scrutiny. */
const ALLOWED = new Set([
  // The definition itself: `export function sealRelease(` lives here, so the
  // literal-text search below always matches this file. Not an importer.
  "lib/html-engine.ts",

  // Publish-time CSP seal, applied to the final HTML right before
  // publishToDir writes it to /var/www/openlen (guarded by
  // OPENLEN_CSP_SEAL). This is the last hardening pass before nginx serves
  // the file, not an editing surface the gate is meant to cover.
  "lib/publish/filesystem.ts",

  // Does not import or call sealRelease at all. The only match is a comment
  // ("...before sealRelease, so the IIFE's hash lands in script-src")
  // describing bake ordering relative to filesystem.ts's own seal call. It
  // is a false positive of the literal-text search, kept here so the ratchet
  // does not need the comment reworded; safe to drop if that comment ever
  // changes.
  "lib/publish/video-embed.ts",

  // Injects `seal: sealRelease` into createCreativeSandbox as that sandbox's
  // dependency; every sandbox mutation (applyPatch/adopt) then flows through
  // passHtmlGate carrying that seal. An injection site, not a second sealer.
  "lib/curate/run-ai-creation.ts",

  // NOT fully justified — recorded here as a known gap, not a blessing.
  // Seals the AI-creation baseline directly, before the sandbox (and the
  // gate it wraps) exist. When the creative session makes zero edits, this
  // is the "degraded" path in run-creative-generation.ts, and the sealed
  // baseline ships to commitAiCompositionDocument untouched — it never runs
  // normalizeBornCanonical or validateBehaviors, which is exactly the gap
  // document-gate.ts's own comment says the gate exists to close ("The
  // Agent ran these three and the creative sandbox did not..."). Kept in
  // ALLOWED because it is live in production today; belongs in the next
  // migration plan, not in this allowlist forever.
  "lib/curate/creative-baseline.ts",

  // Seals inside the pre-cutover adaptive pipeline that the creative-sandbox
  // cutover replaced. As of 2026-08-15 nothing in the live request path
  // imports it — curate-post-handler.ts calls run-ai-creation.ts, not this
  // file, and this file's only production-adjacent caller
  // (quick-section-composition.ts) is itself reached only from an offline
  // eval script (scripts/visual-engine-2b-eval.ts) and tests. Kept in
  // ALLOWED because the code still exists and still seals; likely dead,
  // not deleted here per instruction.
  "lib/curate/fable-adaptive-pipeline.ts",
]);

/** Plain (non-`:(glob)`) git pathspecs treat a bare `**` as requiring at
 *  least one path segment either side of it, so `lib/**\/*.ts` silently
 *  skips files directly under `lib/` (e.g. `lib/html-engine.ts` itself) —
 *  verified empirically against this repo's git (2.45.2). `:(glob)` forces
 *  real globstar semantics so a new sealer dropped at the top level of
 *  `lib/` or `app/` cannot dodge this search.
 *
 *  `--untracked` matters too: plain `git grep` only searches tracked
 *  content, so a brand-new file that has never been `git add`-ed is
 *  invisible without it — and this repo's workflow is sessions full of
 *  uncommitted files (see the "Git workflow" memory), so the common case
 *  IS an uncommitted new file. Without `--untracked` this test would stay
 *  green until someone staged the very bypass it exists to catch. */
function importersOf(symbol: string): string[] {
  const out = execSync(`git grep --untracked -l "${symbol}" -- ":(glob)lib/**/*.ts" ":(glob)app/**/*.ts"`, { encoding: "utf8" });
  return out.split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.endsWith(".test.ts"));
}

describe("no bypass of the html gate", () => {
  it("keeps sealRelease inside the gate", () => {
    const offenders = importersOf("sealRelease").filter((file) => !ALLOWED.has(file));
    expect(offenders, `these seal a document without the gate: ${offenders.join(", ")}`).toEqual([]);
  });
});
