# AI hybrid-only generation runbook

This runbook governs production “Create with AI.” Explicit “Use this template” cloning remains available through `/api/projects/from-template`; it is a separate product command.

## Mode and failure contract

`OPENLEN_AI_CREATION=enabled|disabled` is exact and case-sensitive. `enabled`
still exposes nobody unless `OPENLEN_AI_CREATION_ROLLOUT_PERCENT` is an explicit
integer from 1 through 99. Stable user IDs are bucketed deterministically with
SHA-256; requests outside the cohort fail closed before runtime construction,
budgets, providers, persistence, or credits. Missing, `0`, and `100` are invalid
for enabled mode; an unset value is therefore fail-closed. Disabled mode is zero exposure. Explicit template cloning is
unaffected.

Disabled behavior is error-only and never legacy fallback. A disabled or failed request must not load or deliver `weighted`, `template_full`, `template_skeleton`, or any whole template. It produces no preview, project insert, completion event, or creation-credit debit.

The copy model precedence is:

1. an explicitly injected test/caller option;
2. `OPENLEN_PAGE_COPY_MODEL`;
3. `CURATE_PICK_MODEL`;
4. `STYLE_MATCH_TEXT_MODEL`;
5. `gemini-2.5-flash`.

Provider-capable boundaries make at most one call. There is no automatic retry for intent, copy, creative direction, asset generation, critic, or repair failures.

Operational telemetry is redacted and the default production route always
installs a nonthrowing retained structured sink. It accepts only strict parsed
scalars: stage/typed result, reason code, model role/ID, aggregate usage,
calculated cost, duration, and attempts. Never record a brief, copy, HTML,
prompt, screenshot, URL, credential, user identity, or raw provider/error body.
Never retain brief, copy, HTML, prompt, raw response, private URL, credential,
or user identity.
The older broad `stage`, `reasonCode`, `contract`, `section IDs`, `hash`,
`usage`, `cost`, and `duration` allowlist is superseded by this narrower schema;
contract payloads, section identifiers, and arbitrary hashes are not retained.

## Local release gate

Run the following deterministic, non-live checks on the exact release commit. They require no Gemini request, production database write, deployment, or paid operation.

```powershell
npm.cmd run generation:ai-hybrid:gate
npm.cmd run generation:visual-engine-assets:gate
npm.cmd run typecheck
npm.cmd test
npm.cmd run generation:visual-engine-2a:rollback-check
npm.cmd run build
git diff --check
```

All commands must exit `0`. The focused gate covers copy, composition, delivery, 2C, route atomicity, the deterministic seven-case cohort, the transitive import boundary, the explicit clone distinction, and this operations contract. The deploy script runs the focused gate and typecheck before its `OPENLEN_SKIP_BUILD` branch, so reusing a build cannot bypass either safety check.

## Deterministic section semantics and visual acceptance

Section selection is deterministic and model-free. OpenLen profiles only the
curated section ID, name, and variant label into a closed semantic vocabulary.
It never profiles section HTML, copy, prompts, provider responses, or private
metadata. A variant that conflicts with a forbidden visual signal is rejected
before mode, radius, density, or seeded tie-breaking. If every available
variant for a required role is forbidden, generation fails closed with
`section_role_coverage_failed`; it does not choose the least-bad fragment or
load a whole template.

Use `OPENLEN_VISUAL_ENGINE_ASSETS=hybrid` for real visual acceptance. Asset
mode `off` is a rollback/control state and is not evidence that an
illustration-first or photography-first brief was visually satisfied. Local
tests mock provider and storage boundaries and therefore make no paid call.

For live visual acceptance, run `kids-coloring` (Mundo Pincel) first with one
request and no retry. Require zero forbidden semantic matches, at least three
distinct section content hashes, no `hero-01` or `features-01`, a resolved
asset manifest/trace pair, clean deterministic mobile diagnostics, and an
explicit desktop/mobile visual review with no dashboard or software-mockup
appearance. Run the remaining six cases sequentially only after Mundo Pincel
passes. Stop the sequence at the first failure.

## Production activation and rollback

Activate only after every local release check succeeds. Set the exact approved
revision, scorecard sources/hash, mode, and a bounded rollout percent, then let
the deploy script atomically apply and verify both remote values:

```powershell
$env:OPENLEN_AI_CREATION_TARGET_MODE = "enabled"
$env:OPENLEN_AI_CREATION_TARGET_ROLLOUT_PERCENT = "10"
$env:OPENLEN_FABLE_PARITY_APPROVED_REVISION = "<exact current revision>"
npm.cmd run deploy:prod
```

Confirm the production process receives both `OPENLEN_AI_CREATION=enabled` and
the approved rollout percent. Increasing the percentage requires another
explicit deployment and matching sealed scorecard. Percentages remain 1..99;
100% requires a future policy change. Do not place secrets in command history
or this repository.

Do not bypass this coupled deploy transition with `OPENLEN_ENV_LOCAL` and
`bash infra/scripts/push-env.sh`; that older single-variable path cannot bind
or atomically verify the approved scorecard, build identity, mode, and percent.

Immediate rollback disables creation without restoring any legacy fallback:

```powershell
$env:OPENLEN_AI_CREATION_TARGET_MODE = "disabled"
$env:OPENLEN_AI_CREATION_TARGET_ROLLOUT_PERCENT = "0"
npm.cmd run deploy:prod
```

After rollback, verify new Create-with-AI requests return the stable disabled error and make no provider calls. Explicit template cloning must remain available.
Likewise, do not perform rollback through `OPENLEN_ENV_LOCAL` plus
`bash infra/scripts/push-env.sh`: the authorized rollback boundary must set
`OPENLEN_AI_CREATION=disabled` and the rollout percent to zero together.

## Separately authorized live canary

The live canary is closed by default and is not part of deploy or any local gate. Immediately before it runs, obtain one-time authorization for the exact seven requests and a positive MXN cap. Present the estimated maximum cost and stop if the owner does not explicitly approve that cap. Do not infer authorization from an earlier pilot or deploy approval.

The seven synthetic cases are:

1. `kids-coloring`
2. `horror-experience`
3. `comedy-club`
4. `video-game-launch`
5. `school-website`
6. `cooking-publication`
7. `physical-product-sale`

Issue exactly one request per case, sequentially, with no automatic retries. Use only synthetic briefs and no private project data. Review each final page for immediate theme recognition, required and forbidden signals, ordered section coherence, mobile quality, and absence of legacy-template residue.

For the canary, retain only the strict production telemetry scalars: stage,
typed result/reason, model role/ID, aggregate usage, calculated cost, duration,
and attempts. Never retain briefs, copy, HTML, prompts, raw responses, URLs,
credentials, user identity, screenshots, or provider error bodies.

If any case fails, set `OPENLEN_AI_CREATION=disabled`, keep explicit template cloning available, preserve only the redacted scalar evidence, and diagnose before requesting authorization for another paid run.
