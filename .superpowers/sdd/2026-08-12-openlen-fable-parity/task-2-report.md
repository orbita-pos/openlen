# Task 2 report — Fireworks gateway, model policy, retry rule, and page budget

**Date:** 2026-08-13
**Task:** Fable-Parity Task 2 only
**Commit message:** `feat(ai): add budgeted Fireworks model gateway`

## Outcome

Task 2 adds the single OpenLen-owned Fireworks JSON boundary for DeepSeek, GLM,
and Qwen, the fixed role/reasoning policy, exact one-retry transport rule, a
model-keyed production cost API, and a shared per-page reservation ledger. The
implementation uses local HTTP doubles only. No Fireworks, Gemini, Fable,
network, database, migration, publication, deployment, or environment mutation
was performed.

The existing `@inariwatch/capture` dependency was already present. This task did
not create a new Node project and did not add or change monitoring setup.

## Scope ruling

The brief listed `lib/ai/fireworks-client.test.ts` and required the exact focused
Vitest command, but `vitest.config.ts` had an explicit allowlist for `lib/ai`
tests and silently excluded the new file. The first four-file command therefore
reported only three collected suites. The controller authorized exactly one
scope expansion: add `lib/ai/fireworks-client.test.ts` once to the existing
Vitest include list. No other test-runner configuration changed.

## RED evidence

### Initial policy, cost, and budget RED

Command:

```text
npm.cmd test -- lib/ai/fireworks-client.test.ts lib/generation/fable-model-policy.test.ts lib/generation/page-generation-budget.test.ts lib/generation/model-cost.test.ts
exit 1
Test Files: 3 failed (3)
Tests: 3 failed, 4 passed (7)
```

Expected failures:

- `fable-model-policy.test.ts`: missing `./fable-model-policy`;
- `page-generation-budget.test.ts`: missing `./page-generation-budget`;
- three new `model-cost.test.ts` cases: missing
  `calculateModelUsageMicromxn` / `calculateImageUsageMicromxn`.

This run also exposed that the mandatory Fireworks test was not collected by
the existing explicit Vitest allowlist. After the controller ruling, the
temporary client implementation was removed, the test was allowlisted, and the
real gateway RED was observed:

```text
npm.cmd test -- lib/ai/fireworks-client.test.ts
exit 1
Test Files: 1 failed (1)
Tests: no tests (module load stopped at the intended missing implementation)
```

Exact intended failure: Vite could not resolve `./fireworks-client` from the
now-collected test file.

### Self-review REDs

Connection timeout and invalid configured rate:

```text
npm.cmd test -- lib/ai/fireworks-client.test.ts lib/generation/page-generation-budget.test.ts
exit 1
Test Files: 2 failed (2)
Tests: 2 failed, 27 passed (29)
```

Exact intended failures:

- `ETIMEDOUT` returned `provider` after one attempt instead of retrying once;
- constructing a budget with a `NaN` GLM output rate did not fail immediately.

Final timeout classification RED:

```text
npm.cmd test -- lib/ai/fireworks-client.test.ts
exit 1
Test Files: 1 failed (1)
Tests: 1 failed, 21 passed (22)
```

Exact intended failure: two consecutive connection timeouts returned
`code: "provider"` instead of `code: "timeout"` with two attempts.

Missing-usage cost RED:

```text
npm.cmd test -- lib/ai/fireworks-client.test.ts -t "reserves every attempt"
exit 1
Test Files: 1 failed (1)
Tests: 1 failed, 21 skipped (22)
```

Exact intended failure: an attempt without reported usage completed its lease
with four zero counters instead of incomplete `{}` usage, incorrectly releasing
the conservative reservation rather than charging the worst case fail-closed.

All RED commands emitted only the pre-existing Vite CJS Node API deprecation
warning. The sandbox-local attempt could not load `vitest.config.ts` because
esbuild could not read a parent directory, so the authoritative RED/GREEN runs
used the approved `npm.cmd test` escalation. Vitest reported `.env.local`
injection, but all provider calls were local doubles and production code did not
mutate environment state.

## GREEN implementation

### Provider boundary

- One endpoint: `https://api.fireworks.ai/inference/v1/chat/completions`.
- Role model IDs are trimmed and must exactly equal the three approved IDs.
- Caller Zod contracts are converted to a bounded strict JSON Schema payload;
  unsupported schema types fail before HTTP, and the caller Zod schema parses
  the decoded content again.
- Responses are parsed into allowlisted envelope fields only: one stopped
  choice/content plus complete token usage.
- Complete usage requires safe integer input, cached, output, and reasoning
  counters; incomplete usage fails closed.
- Requests, responses, bodies, prompts, credentials, provider IDs, and errors
  are never logged or included in results.
- Empty 429/502/503/504 and exact connection/body timeouts may retry once.
  Body bytes, reported usage, schema/JSON/provider incompatibility, all other
  HTTP statuses, and other connection failures never retry.
- Both attempts reuse the same serialized payload and redacted request ID.
- Every attempt reserves the page budget before HTTP. Missing usage charges the
  attempt's conservative reservation; a retry starts only after a second
  reservation succeeds.

### Model and reasoning policy

- reasoner: `accounts/fireworks/models/deepseek-v4-flash`;
- designer: `accounts/fireworks/models/glm-5p2`;
- visual critic: `accounts/fireworks/models/qwen3p7-plus`;
- DeepSeek `none` for copy/simple extraction and `high` for page planning;
- GLM `high` for initial section programs and `max` only for visual repair;
- Qwen `none` for candidate scouting and final scoring.

### Production cost and page ledger

- Exact brief rate map, including conservative Qwen pricing and Gemini image
  rate only.
- Rational/BigInt intermediate arithmetic with one final micromxn rounding and
  safe-integer output checks.
- The historical pilot API and calculations are unchanged; all prior pilot
  expectations continue to pass.
- Shared synchronous reservation ledger includes outstanding reservations in
  the cap decision, preventing interleaved overspend.
- Default target/cap env contracts are exactly 5,000,000 / 10,000,000 micromxn;
  the cap may be configured downward but never above 10 MXN.
- Missing/invalid version, FX, target, cap, model/image rate, usage, lease, or
  count fails closed.
- Telemetry snapshot is an allowlist of rate-card version, target/cap,
  actual/reserved micromxn, model IDs/counters/cost, and image IDs/count/cost.

## GREEN evidence

Focused intermediate GREENs:

```text
npm.cmd test -- lib/generation/fable-model-policy.test.ts lib/generation/page-generation-budget.test.ts lib/generation/model-cost.test.ts
exit 0
Test Files: 3 passed (3)
Tests: 23 passed (23)
```

```text
npm.cmd test -- lib/ai/fireworks-client.test.ts --reporter=verbose
exit 0
Test Files: 1 passed (1)
Tests: 20 passed (20)
```

Self-review fixes:

```text
npm.cmd test -- lib/ai/fireworks-client.test.ts lib/generation/page-generation-budget.test.ts
exit 0
Test Files: 2 passed (2)
Tests: 29 passed (29)
```

```text
npm.cmd test -- lib/ai/fireworks-client.test.ts
exit 0
Test Files: 1 passed (1)
Tests: 22 passed (22)
```

```text
npm.cmd test -- lib/ai/fireworks-client.test.ts -t "reserves every attempt"
exit 0
Test Files: 1 passed (1)
Tests: 1 passed, 21 skipped (22)
```

## Final verification

Fresh exact focused command on the final implementation:

```text
npm.cmd test -- lib/ai/fireworks-client.test.ts lib/generation/fable-model-policy.test.ts lib/generation/page-generation-budget.test.ts lib/generation/model-cost.test.ts
exit 0
Test Files: 4 passed (4)
Tests: 45 passed (45)
Vitest duration: 4.30s
```

Only the pre-existing Vite CJS Node API deprecation warning was emitted.

Fresh typecheck:

```text
npm.cmd run typecheck
> tsc --noEmit
exit 0
```

An earlier typecheck correctly found ten test-double tuple inference errors in
`fireworks-client.test.ts`. The doubles were typed as `typeof fetch`; the fresh
final typecheck above is clean.

Fresh diff check before report/staging:

```text
git -c safe.directory='<repo>' diff --check
exit 0
```

Git emitted only the sandbox permission warning for
`.git/objects/info/alternates`. A staged diff check will be run after exact-path
staging so new files and this report are included before commit.

## Files

Task 2 files:

- new `lib/ai/fireworks-contracts.ts`;
- new `lib/ai/fireworks-client.ts`;
- new `lib/ai/fireworks-client.test.ts`;
- new `lib/generation/fable-model-policy.ts`;
- new `lib/generation/fable-model-policy.test.ts`;
- new `lib/generation/page-generation-budget.ts`;
- new `lib/generation/page-generation-budget.test.ts`;
- modified `lib/generation/model-cost.ts`;
- modified `lib/generation/model-cost.test.ts`;
- modified `package.json` with the focused local gate;
- this report.

Controller-authorized critical test gate:

- modified `vitest.config.ts` with exactly one new include line.

No dependency or lockfile change was necessary because Zod and Vitest already
exist in the project.

## Self-review

- Confirmed every provider branch returns only typed, redacted fields.
- Confirmed no production `console`/logger call and no Gemini text/vision route
  exists in the new boundary.
- Confirmed all retry branches require no body and no usage; 400/401/403/404,
  whitespace body, usage body, malformed/schema content, and non-timeout
  connection errors remain one attempt.
- Confirmed retry payload identity is tested by object identity on the exact
  serialized body string.
- Confirmed timeout covers both fetch and response-body parsing.
- Confirmed incomplete usage consumes worst-case reserved cost and cannot make
  budget available accidentally.
- Confirmed rate validation occurs when the enabled budget is created, not only
  on first call.
- Confirmed output/reasoning is not double-charged: Fireworks completion usage
  includes reasoning; the reasoning counter is preserved for telemetry.
- Confirmed no code path prices a Gemini text/vision call; Gemini is represented
  only by `gemini-2.5-flash-image` image count.
- Confirmed legacy pilot functions and fixtures were not rewritten.
- Mutation coverage includes wrong model/effort, loose schema, body leakage,
  missing usage, extra retry, mutated retry payload, missing reservation,
  invalid rate/config, cap overspend, and unsafe/inconsistent counters.
- No independent review was run here because the controller explicitly owns
  that review step.

## Concerns

- Provider compatibility is verified only through local mocks, as required by
  the no-network/no-paid-call constraint. A later explicitly authorized canary
  must validate the live Fireworks dialect before rollout.
- The strict Zod-to-JSON-Schema translator intentionally supports a bounded
  subset. Unsupported future schema constructs fail before any paid call and
  must be added test-first by their owning task.

## Commit

Only the exact Task 2 paths listed above will be staged. The required commit
message is:

```text
feat(ai): add budgeted Fireworks model gateway
```

The resulting hash is reported in the parent handoff; embedding a commit's own
hash in a file contained by that commit is self-referential.
