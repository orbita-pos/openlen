# Fable parity evaluation and release runbook

## Release status

OpenLen is **not** Fable-level merely because this harness or the adaptive
generation code exists. The release may use that description only after a
separately authorized live run produces a hash-pinned, passing scorecard and
the owner explicitly enables deployment. Catalog publication, database
migration, activation, and deployment are separate operations.

All evaluation evidence lives below `scratch/fable-parity/`, which is ignored.
Never commit hidden prompt plaintext, prompt manifests, HTML, screenshots,
provider responses, reviewer identity, tokens, usage telemetry, or scorecard
files. Operational telemetry remains redacted; the private evidence bundle is
not operational telemetry.

## Commands and authority

| Command | Network/provider/DB behavior | Authority |
|---|---|---|
| `npm.cmd run generation:fable-parity:gate` | deterministic tests only; none | safe non-live gate |
| `npm.cmd run generation:fable-parity:eval` | exactly 20 OpenLen and 20 Fable adapter calls | live authorization and cap required |
| `npm.cmd run generation:fable-parity:review` | loopback HTTP only; serves verified local evidence | local reviewer token required |
| `npm.cmd run generation:fable-parity:scorecard` | verified local artifacts only; none | three locked reviews required |
| `npm.cmd run generation:fable-parity:rollback` | controlled SSH transition of the configured production runtime; no provider/DB call | explicit rollback authority required |

Do not run the live eval command during implementation or routine CI. The
authorization string is exact and single-use:
`AUTHORIZED_FABLE_PARITY_EVAL_ONCE`. The evaluator atomically consumes it
before loading hidden prompts or contacting either adapter. A stopped or failed
run requires a new cohort version, a new explicit owner authorization, and a
new cap; do not delete the consumption marker to reuse approval.

## 1. Prepare the sealed cohort outside the repository

Keep eight records in an external JSON array. Each record has only
`sealedId`, `ciphertextBase64`, `nonceBase64`, and `authTagBase64`. Encrypt the
complete prompt record with AES-256-GCM; the decrypted object has exactly
`recordId`, `version`, `prompt`, `niche`, `direction`, and `forbiddenSignals`.
Use `hidden/1` for this cohort. Keep the 32-byte key outside the repository and
provide it as base64 only in the evaluation process environment.

Before authorization, verify that repository fixtures and prompts contain no
hidden plaintext. The loader rejects any plaintext or extra envelope key and
requires exactly eight unique sealed records. The fixed public cohort supplies
the other 12 comparisons.

## 2. Freeze models, rates, and the maximum cost

The OpenLen model IDs must exactly match the production policy:

- reasoner: `accounts/fireworks/models/deepseek-v4-flash`
- designer: `accounts/fireworks/models/glm-5p2`
- critic: `accounts/fireworks/models/qwen3p7-plus`
- images: `gemini-2.5-flash-image`
- reference: `fable-5`

Freeze the complete rate card as a canonical reviewed SHA-256. Set both the
actual and reviewed hash; the gate requires equality. Set the OpenLen page cap
to exactly `10000000` micromxn (10 MXN) and a positive reference-page cap.
The exact authorization maximum is:

```text
20 × (10,000,000 + reference-page-cap-micromxn)
```

The total cap must reserve at least that amount. This is the maximum approval
request, not a forecast. Ask the owner to approve that exact MXN value and the
one-time authorization before setting `OPENLEN_FABLE_PARITY_LIVE=1`.

Required live variables are:

```text
OPENLEN_FABLE_PARITY_LIVE=1
OPENLEN_FABLE_PARITY_AUTHORIZATION=AUTHORIZED_FABLE_PARITY_EVAL_ONCE
OPENLEN_FABLE_PARITY_TOTAL_CAP_MICROMXN=<exact approved maximum>
OPENLEN_FABLE_PARITY_PAGE_CAP_MICROMXN=10000000
OPENLEN_FABLE_PARITY_REFERENCE_PAGE_CAP_MICROMXN=<reviewed positive cap>
OPENLEN_FABLE_PARITY_REASONER_MODEL=accounts/fireworks/models/deepseek-v4-flash
OPENLEN_FABLE_PARITY_DESIGNER_MODEL=accounts/fireworks/models/glm-5p2
OPENLEN_FABLE_PARITY_CRITIC_MODEL=accounts/fireworks/models/qwen3p7-plus
OPENLEN_FABLE_PARITY_IMAGE_MODEL=gemini-2.5-flash-image
OPENLEN_FABLE_PARITY_REFERENCE_MODEL=fable-5
OPENLEN_FABLE_PARITY_RATE_CARD_SHA256=sha256:<reviewed hash>
OPENLEN_FABLE_PARITY_REVIEWED_RATE_CARD_SHA256=sha256:<same reviewed hash>
OPENLEN_FABLE_PARITY_HIDDEN_COHORT_PATH=<external absolute path>
OPENLEN_FABLE_PARITY_HIDDEN_KEY_BASE64=<external secret>
```

The OpenLen and reference adapter endpoints each receive one prompt per request
and must return the HTML bytes, native full-page desktop and mobile screenshot
bytes with viewport metadata, technical/eligibility status, critical failures,
and a complete paid-call ledger. The OpenLen adapter must invoke the production
Create-with-AI path; a fixture or alternate generator invalidates the run. The
harness makes one call to each adapter per comparison in strict sequence and
does not add creative retries beyond production policy.

## 3. Conduct three independent blind reviews

Create three distinct random 24-hex reviewer session IDs and strong tokens of
at least 32 visible characters. Run one session at a time with:

```text
OPENLEN_FABLE_REVIEW_HOST=127.0.0.1
OPENLEN_FABLE_REVIEW_PORT=4319
OPENLEN_FABLE_REVIEW_TOKEN=<unique strong token>
OPENLEN_FABLE_REVIEW_MANIFEST_PATH=<scratch manifest path>
OPENLEN_FABLE_REVIEW_SESSION_PATH=<unique scratch session path>
OPENLEN_FABLE_REVIEW_SESSION_ID=<unique 24-hex ID>
```

Then run `npm.cmd run generation:fable-parity:review` and open the printed
loopback URL. Do not proxy or bind the reviewer to a LAN interface. The server
requires the bearer token for prompt and screenshot bytes, exposes only opaque
A/B routes, never serves the privately verified HTML, and revalidates the
entire artifact bundle before each serve and each locked decision. Each serve
returns the immutable bytes retained by that verification, so a later path
replacement cannot change what the reviewer receives. Reviewers
must not coordinate, see side
assignments, model/provider identity, costs, or telemetry. Each reviewer locks
all 20 decisions; incomplete or duplicate coverage is rejected.

## 4. Produce and approve the immutable scorecard

Set the original manifest path, the three comma-separated completed session
paths, and a new output path below `scratch/fable-parity/`:

```text
OPENLEN_FABLE_REVIEW_MANIFEST_PATH=<manifest path>
OPENLEN_FABLE_REVIEW_SESSION_PATHS=<session-1>,<session-2>,<session-3>
OPENLEN_FABLE_PARITY_SCORECARD_OUTPUT=<new scorecard path>
```

Run `npm.cmd run generation:fable-parity:scorecard`. It revalidates every
prompt manifest, HTML file, desktop/mobile screenshot, side assignment, result,
and sealed decision before scoring. Technical failures remain losses, all 20
comparisons remain in the denominator, and every recorded paid failure remains
in page cost.

The thresholds are immutable: at least 70% wins-or-ties; at least 40% outright
wins unless ties alone reach 80%; zero majority wrong-niche pages; at least 18
eligible OpenLen pages; zero whole-template clone, critical safety, horizontal
overflow, unreadable-primary-text, or persistence/credit atomicity failure;
median OpenLen cost at most 5 MXN; and every OpenLen page strictly below 10 MXN.
Any failure blocks rollout. Diagnosing the same bytes is allowed; rerunning the
paid comparison requires a new versioned cohort and new authorization.

## 5. Activate or roll back

Every deploy must explicitly declare `OPENLEN_AI_CREATION_TARGET_MODE=enabled`
or `OPENLEN_AI_CREATION_TARGET_MODE=disabled` before
`infra/scripts/deploy.ps1` runs. This is the requested state of the remote
runtime environment, not a statement about the local shell. Disabled
deployments require no parity scorecard. Enabling requires all four source and
approval inputs:

```text
OPENLEN_FABLE_PARITY_SCORECARD_PATH=<passing scorecard below scratch/fable-parity>
OPENLEN_FABLE_PARITY_SCORECARD_SHA256=sha256:<owner-approved scorecard hash>
OPENLEN_FABLE_REVIEW_MANIFEST_PATH=<exact source manifest below scratch/fable-parity>
OPENLEN_FABLE_REVIEW_SESSION_PATHS=<exact session-1>,<exact session-2>,<exact session-3>
```

The deploy script runs the deterministic parity gate and rebuilds the sealed
scorecard from the exact manifest and three locked reviewer sessions before
its first `OPENLEN_SKIP_BUILD` branch, so a reused build cannot bypass those
controls. Only after those gates pass does it atomically patch
`/etc/openlen/openlen.env` on the target host. It verifies the stored target
mode before starting the service and verifies the effective value again in the
started process environment.

For rollback, run `npm.cmd run generation:fable-parity:rollback` only with
explicit production rollback authority and the configured SSH target. The CLI
atomically sets `OPENLEN_AI_CREATION=disabled` in the real remote environment,
restarts the service, reads the effective value from the running process, and
verifies through an anonymous fail-closed HTTP probe that the explicit
user-selected template clone route remains reachable.
An unchanged enabled state, unreachable clone route, or missing readback fails
closed. The rollback never calls a provider and never enables a whole-template
AI fallback.
