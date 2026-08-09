# Visual Engine 2A pilot runbook

## Purpose and release boundary

This runbook operates the bounded `template_skeleton` pilot for OpenLen Quick. The template still owns the reviewed responsive structure; the Visual Engine may change only the validated creative direction, allowlisted tokens and CSS hooks, and replaceable catalog-backed asset slots. It does not replace the existing copy, profile, SEO, sanitization, persistence or credit paths.

Implementation completion and pilot success are separate decisions:

- Implementation is ready for a pilot only after Tasks 1-11, the non-live release gate, unset/off/shadow delivery equivalence, the complete-diff review and the privacy audit all pass.
- Pilot success is not established by merging the implementation. It requires the later 75-start scorecard in this document to pass every gate together.
- No command under **Paid pilot execution** may run without separate, explicit user authorization for the complete paid evaluation footprint.
- The implementation commit does not enable `skeleton` globally. The default and every unknown value remain `off`.

The paid footprint is larger than 75 provider requests. The evaluation performs the exact frozen 75-row safe-selection preflight before quota reservation. All 75 rows must resolve to an allowlisted `template_skeleton` route or the run stops with zero reservations. No row is retried, replaced, or selected from a larger pool. A successful preflight therefore makes exactly 75 paid intent-analysis calls before starting exactly 75 adaptations. Each adaptation can also perform Quick baseline/candidate fill work and at most one diagnostic vision critique. The operator must budget and authorize all of those calls, not describe the authorization as merely “75 Gemini calls.”

## Cohort order and authorization boundary

Follow this exact order: **qualification → human manifest review → fresh rate/FIX freeze → new explicit paid authorization → live eval → blind review → rollback → scorecard**. The read-only qualification checkpoint is `npm.cmd run generation:visual-engine-2a:qualify`; it produces an ignored local aggregate and does not make provider calls or database writes. A human must review that manifest before freezing the current provider rate card and dated foreign-exchange (FIX) basis.

The prior paid authorization was consumed by the stopped paid preflight. It does not authorize a later run. The future paid eval must receive new, explicit approval for its complete footprint; do not run `npm.cmd run generation:visual-engine-2a:eval` without it. `OPENLEN_VISUAL_ENGINE` remains `off` until a separate rollout decision.

The 2A cohort is only the frozen 15 base cases expanded to 75 rows. Selector adversarial cases remain separate from the 2A cohort. Complex coloring, minigames, and stories belong to 2B. They are not a 2A exception or replacement route.

## Runtime modes and precedence

| `OPENLEN_VISUAL_ENGINE` | Delivery behavior | Creative/pilot behavior |
| --- | --- | --- |
| unset, `off`, or any unsupported value including `on` | Existing Quick output | No Visual Engine creative call or pilot reservation |
| `shadow` | Existing Quick output and persistence | Builds an isolated candidate; consumes pilot quota when a creative call is about to start |
| `skeleton` | May deliver a fully validated skeleton adaptation | Reserved for a separately approved post-pilot rollout |

`OPENLEN_SAFE_TEMPLATE_PICKER` has lower precedence:

- When Visual Engine resolves to `off`, `OPENLEN_SAFE_TEMPLATE_PICKER=shadow` retains the legacy observational safe-selection path.
- When Visual Engine is `shadow` or `skeleton`, OpenLen reuses one safe-selection execution and suppresses the legacy shadow execution. This prevents duplicate analysis, cost and contradictory logs.
- Unsupported values for either flag do not enable a user-visible route.

Rollback is immediate: remove `OPENLEN_VISUAL_ENGINE` or set it to `off`. No database rollback or project rewrite is required. Projects already accepted in `skeleton` remain valid stored projects; the kill switch prevents new Visual Engine execution.

`section_composition` continues to use the current Quick fallback in 2A. Composition requires the separate 2B contracts and gates; 2A must not improvise a page when no safe structure exists.

## Environment contract

Provide secrets through the deployment secret store or an untracked local environment file. Never commit `.env*`, paste secrets into evidence, or save provider responses.

| Variable | Requirement |
| --- | --- |
| `OPENLEN_VISUAL_ENGINE` | Exactly `shadow` for the paid 2A evaluation. `skeleton` and `off` are refused by the eval runner. |
| `OPENLEN_SAFE_TEMPLATE_PICKER` | Optional. It is suppressed while Visual Engine is `shadow`/`skeleton`. |
| `DATABASE_URL` or `POSTGRES_URL` | Required for migration, quota, review decisions and scorecard. Point it at the explicitly selected pilot environment. |
| `GEMINI_API_KEY` | Required for the paid evaluation. Keep it only in the secret store. |
| `OPENLEN_VISUAL_ENGINE_MODEL` | Optional creative model ID; code default is `gemini-2.5-flash`. Record the effective ID before the pilot. |
| `OPENLEN_VISUAL_ENGINE_CRITIC_MODEL` | Optional diagnostic critic model ID; eval default is `gemini-2.5-flash`. |
| `OPENLEN_VISUAL_ENGINE_THINKING_BUDGET` | Optional integer; code clamps it to `0..2048` and defaults to `512`. Record the effective value. |
| `OPENLEN_VISUAL_ENGINE_RATE_CARD_VERSION` | Required non-empty immutable label for the dated provider rate card, model and currency basis. |
| `OPENLEN_VISUAL_ENGINE_INPUT_USD_PER_MILLION` | Required finite positive USD rate. |
| `OPENLEN_VISUAL_ENGINE_CACHED_INPUT_USD_PER_MILLION` | Required finite positive USD rate. |
| `OPENLEN_VISUAL_ENGINE_OUTPUT_USD_PER_MILLION` | Required finite positive USD rate. |
| `OPENLEN_VISUAL_ENGINE_THINKING_USD_PER_MILLION` | Required finite positive USD rate. |
| `OPENLEN_VISUAL_ENGINE_MXN_PER_USD` | Required finite positive, dated USD/MXN conversion. |
| `OPENLEN_REVIEWER_NAME` | Required only while running the blind reviewer. Written to ignored local evidence, never the pilot table. |
| `OPENLEN_REVIEWER_EMAIL` | Required only while running the blind reviewer; must look like an email address. Written only to ignored local evidence. |

Do not copy example prices into a real run. Immediately before authorization, record the current official provider prices and dated exchange rate, then freeze those exact values for all 75 starts. A changed model or price basis requires a new rate-card version; do not mix rate cards within one pilot.

## Non-live pre-pilot release gate

Run from the repository root on the exact candidate commit. These commands must not have production credentials loaded.

```powershell
npx.cmd vitest run lib/generation lib/curate lib/theme-derive.test.ts tools/visual-engine-2a-reviewer
npx.cmd tsx --require ./scripts/test-node-server-only-shim.cjs --test lib/ai/vision-critique.test.ts lib/imagery/photograph.test.ts lib/agent/theme-apply.test.ts
npx.cmd vitest run lib/templates/visual-metadata.test.ts lib/templates/suggest-visual-metadata.test.ts lib/generation/selector-scorecard.test.ts
npm.cmd run typecheck
git diff --check
```

Expected result: zero failed tests, typecheck exit `0`, and diff check exit `0`.

Verify the real delivery invariants with the deterministic fixture. This command does not call a provider or database; it writes ignored, hash-bound evidence below `scratch/visual-engine-2a/`.

```powershell
npm.cmd run generation:visual-engine-2a:rollback-check
```

Run the package command exactly; it preloads the scoped `server-only` compatibility shim required when the CLI executes outside Next.js. Do not replace it with a direct `tsx scripts/visual-engine-2a-rollback-check.ts` invocation.

The fixture must prove:

- true unset and explicit `off` have identical complete output and delivery hashes;
- unset/off have zero creative calls, reservations, completions and candidate jobs;
- `shadow` has the same selected ID, finalized HTML, preview sequence, persisted `ProjectData` and credit delta as baseline;
- `shadow` runs exactly one isolated candidate job, one reservation, one completion and one creative fixture call.

Do not replace this fixture with a mode parser unit test: the evidence covers actual delivery, persistence and credit seams.

## Migration and quota inspection

Migration is an operational write. Run it only against the approved pilot database after the non-live gate and complete-diff review pass:

```powershell
npm.cmd run visual-engine-pilot:migrate
```

The migration is idempotent and creates only the redacted budget/run ledger. It seeds `2a=75`, `2b=75`, and `2c=150` without overwriting existing rows. Inspect the result in the same database console:

```sql
SELECT "phase", "limit", "used", "updatedAt"
FROM "visualEnginePilotBudgets"
ORDER BY "phase";

SELECT "phase", "status", count(*) AS runs
FROM "visualEnginePilotRuns"
GROUP BY "phase", "status"
ORDER BY "phase", "status";
```

Before the first 2A pilot, the required state is exactly `('2a', 75, 0)`, `('2b', 75, 0)`, `('2c', 150, 0)` and no 2A run rows. If `2a.used` is non-zero, stop. Never reset or decrement it to make the runner accept a second attempt; a repeat requires an explicit new budget decision and code/migration change.

## Stale starts: abandon, never reclaim

A reservation spends quota atomically immediately before creative work. Provider failure, invalid output, render failure, process crash or missing persistence does not return that unit. Runs left `started` for more than one hour may be marked `abandoned`, but the budget remains unchanged.

First inspect, then update in one transaction:

```sql
BEGIN;

SELECT "id", "ordinal", "templateId", "createdAt"
FROM "visualEnginePilotRuns"
WHERE "phase" = '2a'
  AND "status" = 'started'
  AND "createdAt" < now() - interval '1 hour'
ORDER BY "ordinal"
FOR UPDATE;

UPDATE "visualEnginePilotRuns"
SET "status" = 'abandoned', "completedAt" = now()
WHERE "phase" = '2a'
  AND "status" = 'started'
  AND "createdAt" < now() - interval '1 hour'
RETURNING "id", "ordinal", "status", "completedAt";

SELECT "phase", "limit", "used"
FROM "visualEnginePilotBudgets"
WHERE "phase" = '2a';

COMMIT;
```

The final query must show the same `used` value as before the update. Never run an `UPDATE ... used = used - ...`, delete a run, reuse an ordinal, or replace an abandoned row.

## Privacy audit

The ledger is redacted telemetry, not project storage. It must contain no user identity, brief, copy, HTML, profile, prompt, raw model response, raw provider/database error, API key or reviewer identity.

Verify the exact schema allowlist after migration:

```sql
WITH expected(name) AS (VALUES
  ('id'), ('phase'), ('ordinal'), ('mode'), ('route'), ('templateId'),
  ('status'), ('reasonCode'), ('promptVersion'), ('contractVersion'),
  ('policyVersion'), ('taxonomyVersion'), ('modelVersion'), ('rateCardVersion'),
  ('inputTokens'), ('outputTokens'), ('thinkingTokens'), ('cachedTokens'),
  ('productionEquivalentCostMicromxn'), ('observedPilotCostMicromxn'),
  ('durationMs'), ('criticVisualQualityScore'), ('criticBriefAdherenceScore'),
  ('criticFallback'), ('structuralFingerprintBefore'), ('structuralFingerprintAfter'),
  ('candidatePersisted'), ('structuralInvariantPassed'), ('comparisonVerdict'),
  ('acceptedForbiddenSignalCount'), ('createdAt'), ('completedAt')
), actual(name) AS (
  SELECT "column_name"
  FROM information_schema.columns
  WHERE "table_schema" = current_schema()
    AND "table_name" = 'visualEnginePilotRuns'
)
SELECT coalesce(expected.name, actual.name) AS name,
       CASE WHEN expected.name IS NULL THEN 'unexpected'
            WHEN actual.name IS NULL THEN 'missing' END AS problem
FROM expected
FULL OUTER JOIN actual USING (name)
WHERE expected.name IS NULL OR actual.name IS NULL;
```

Expected result: zero rows. Then scan all stored text values for common secret, identity and markup signatures:

```sql
SELECT r."ordinal", value.key, left(value.value, 120) AS suspicious_prefix
FROM "visualEnginePilotRuns" AS r
CROSS JOIN LATERAL jsonb_each_text(to_jsonb(r)) AS value(key, value)
WHERE r."phase" = '2a'
  AND (
    value.value ~* '<!doctype|<html|<script|<style|authorization:|api[_-]?key|BEGIN [A-Z ]*PRIVATE KEY'
    OR value.value ~* '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}'
  )
ORDER BY r."ordinal", value.key;
```

Expected result: zero rows. This signature scan is defense in depth, not a semantic proof that an arbitrary string is not prose. The stronger controls are the exact column allowlist plus code review confirming that reserve/completion/comparison accept only typed scalar fields and never accept project content. Investigate any hit; never publish suspicious values in an incident report.

Reviewer identity, JPG evidence, manifests, review session and rollback evidence belong only under ignored `scratch/visual-engine-2a/`. They must not be staged.

## Cost definitions

All persisted costs use integer micro-MXN (`1 MXN = 1,000,000 micro-MXN`) and the one frozen rate card.

- `productionEquivalentCostMicromxn` is creative usage plus the one diagnostic critic plus any supplied failed-call usage. It models the incremental provider work expected for one production adaptation.
- `observedPilotCostMicromxn` is the production-equivalent amount plus the duplicated shadow candidate-fill usage needed by the evaluation harness.
- The scorecard gate uses the mean **production-equivalent** cost over all 75 starts, including failures, and requires it to be strictly below `400,000` micro-MXN (`MXN 0.40`). `0.40` exactly fails.
- A missing production-equivalent cost on any started row is incomplete evidence and must fail the gate; it must never be coerced to a free `0` call.
- Total cash spend for the experiment is broader than the scorecard metric because preflight safe selection, baseline construction, rendering and other evaluation-only work can occur outside that definition. Record that separately for budgeting.

## Paid pilot execution — explicit authorization required

Stop here until the user explicitly authorizes the complete paid evaluation and the operator has confirmed the database, model IDs, rate card and exchange-rate values.

1. Set `OPENLEN_VISUAL_ENGINE=shadow` in the approved pilot environment. Do not enable `skeleton`.
2. Confirm the migration/zero-use inspection and privacy schema audit.
3. Run exactly once:

```powershell
npm.cmd run generation:visual-engine-2a:eval
```

The runner refuses `off`/`skeleton`, missing provider/database/rate-card configuration, inconsistent quota, any result other than a 75/75 allowlisted skeleton preflight, or a non-zero 2A budget. It completes the deterministic frozen 75-row preflight before any reservation. Every row must pass; there is no larger candidate pool, retry, removal, or replacement. Do not remove failures, replace an unattractive result or replenish quota.

After the command, inspect counts without exposing content:

```sql
SELECT "status", count(*) AS runs
FROM "visualEnginePilotRuns"
WHERE "phase" = '2a'
GROUP BY "status"
ORDER BY "status";

SELECT "limit", "used"
FROM "visualEnginePilotBudgets"
WHERE "phase" = '2a';
```

Required accounting is exactly 75 used units and exactly 75 2A rows. Mark only genuinely stale starts as `abandoned`; do not reclaim them.

## Blind review and resume

The reviewer source must contain 72-75 hash-verified manifests: exactly one for every technically successful candidate and none for technical failures. All technically successful rows must receive one valid blind verdict. Technical failures remain in the 75-start denominator.

Set reviewer identity only in the local runtime, then start or resume:

```powershell
npm.cmd run generation:visual-engine-2a:review
```

The command verifies every manifest and JPG hash, randomizes baseline/candidate sides, binds resume to the same source SHA, listens only on loopback and prints a tokenized local URL. Do not share or log the URL token. A repeat command resumes the same source; it must refuse substituted bytes or a different source. Stop the server with `Ctrl+C` after review.

For each technically successful row, record one of `candidate`, `baseline`, `tie`, or `invalid` and the accepted forbidden-signal count. A tie is comparable but not a candidate win. `invalid` is not an acceptable completed review and causes the gate to fail. Any accepted forbidden signal causes the gate to fail.

## Rollback evidence and scorecard

Regenerate rollback evidence on the exact evaluated commit; this fixture is non-live:

```powershell
npm.cmd run generation:visual-engine-2a:rollback-check
```

Then calculate the database-backed scorecard:

```powershell
npm.cmd run generation:visual-engine-2a:scorecard
```

The scorecard exits non-zero unless all gates pass together:

| Gate | Required result |
| --- | --- |
| Starts | Exactly `75` |
| Technical success | At least `72/75` |
| Review coverage | All `72..75` technically successful candidates reviewed; zero unreviewed and zero invalid |
| Blind preference | Candidate wins at least `ceil(0.90 × comparable)`; ties are denominator non-wins |
| Structure/behavior/data | Zero structural-invariant failures |
| Partial persistence | Zero candidates persisted by the shadow evaluation |
| Forbidden signals | Zero accepted forbidden signals |
| Cost | All 75 starts have cost evidence; mean production-equivalent cost `< 400,000` micro-MXN |
| Rollback | Hash-bound unset/off/shadow fixture verified |

Passing one gate never compensates for another. A Quick fallback is safe for the user but counts as a technical failure. Failed and abandoned starts remain in the 75 denominator.

## Rollout decision and incident response

Even a passing scorecard does not automatically enable `skeleton`. Preserve the scorecard, privacy audit, rate-card sources and complete-diff review, then request a separate user decision for a limited rollout. Global `skeleton` remains disabled until that decision.

For any incident:

1. Set `OPENLEN_VISUAL_ENGINE=off` or remove it.
2. Confirm new requests have zero creative calls and pilot reservations.
3. Preserve scalar ledger rows and ignored hash-bound evidence; do not paste HTML, briefs, secrets or raw provider responses into tickets.
4. Mark starts older than one hour `abandoned` without decrementing quota.
5. Classify the typed reason code and verify whether the accepted project came from baseline fallback.
6. Do not re-enable, retry the pilot or consume the 2B reserve without a new explicit decision.

If any gate fails, correct 2A and request a new budget decision. Do not borrow the 75-unit 2B reserve. 2B starts only after 2A succeeds and composition has its own implementation and gate.

## Repository artifact audit

Before commit, merge, deployment or pilot execution, inspect both unstaged and staged state:

```powershell
git status --short
git diff --stat
git diff --check
git diff --cached --stat
git diff --cached --check
```

Confirm that no `.env*`, `scratch/`, JPG/JPEG/PNG screenshot, reviewer identity/session, provider/model raw response, API key, absolute local path, local audit JSON or ignored generated binding is staged. The five pre-existing `scratch/*.json` selector audit files are local user artifacts: preserve them unchanged and never stage them as part of 2A.
