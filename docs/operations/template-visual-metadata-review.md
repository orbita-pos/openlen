# Local visual metadata review

Use this reviewer only for a human-approved local review of a previously generated suggestion artifact. It never calls Gemini, the database, an import, or a deployment service.

## Identity and launch

Set both identity variables for a configured session (or omit both to use the local identity form). Do not put an email in shell history if the form is preferred.

```powershell
$env:OPENLEN_REVIEWER_NAME = "Reviewer Name"
$env:OPENLEN_REVIEWER_EMAIL = "reviewer@example.com"
```

Launch from the repository root with distinct output paths:

```powershell
npm.cmd run templates:visual-metadata:review -- --input scratch/template-visual-metadata-review.json --session scratch/template-visual-metadata-review.session.json --reviewed-out scratch/template-visual-metadata-reviewed.json --audit-out scratch/template-visual-metadata-review-audit.json
```

The command prints a loopback origin and opens a one-use local bootstrap URL. Keep the browser on that machine. `--no-open` suppresses the automatic browser open; the process still prints the safe origin. The only accepted identity alternatives are a complete `--reviewer-name` plus `--reviewer-email` pair, a complete environment pair, or the local form. Never supply a partial pair.

The input is immutable. The reviewer hashes and validates it before opening or resuming. It never edits that source. Treat the session, its `.lock`/claim recovery files, reviewed export, audit export, and atomic-writer `*.tmp` files as runtime outputs; do not commit them. The real source is `scratch/template-visual-metadata-review.json` and remains ignored/unmodified.

## Reviewing safely

The dark evidence stage is for the proxied screenshot; the light inspector is for the proposed taxonomy. A row is `pending`, `approved`, `rejected`, or a typed `failed` row. Failed rows cannot be edited or approved. A screenshot must load successfully before approval; retry an unavailable screenshot rather than approving it.

Use the controls or these shortcuts outside editors and dialogs:

- `A` approve the current valid, loaded proposal.
- `R` open rejection; a trimmed non-empty reason of at most 500 code points is required.
- `J` / `K` move through the queue.
- `E` focus the metadata inspector.
- `Esc` closes the rejection dialog.

The completion gate is 95% rounded up across all rows: the production artifact requires 428 approvals out of 450. Final export also requires every suggested row to have a decision. The UI displays both the exact remaining approvals and remaining decisions. An audit backup is available before the final gate; it is not a reviewed import artifact.

## Restart, recovery, and export

Stop the process with `Ctrl+C`; it closes the loopback server and releases the single-writer lock. Restart with the same input, session, outputs, and reviewer identity to resume. Do not delete a live lock.

If a prior process is definitely gone, restart normally. The store reclaims a stale lock only after confirming the recorded process is absent and validating the matching session/source. If restart reports a lock or corrupt-session error, preserve the session, lock, and any `*.tmp` file for investigation; do not overwrite or hand-edit them.

At the final gate, use **Export reviewed artifact**. Confirm both output files exist and parse as JSON: the reviewed export contains only reviewed metadata and the audit export contains the review history/source proof. Verify the input hash is unchanged before authorizing any later operation.

The separate existing import command is intentionally a later human-authorized operation; do not run it as part of review or merely because exports exist:

```powershell
npm.cmd run templates:visual-metadata:import -- --input scratch/template-visual-metadata-reviewed.json
```

## Troubleshooting

- **Screenshot unavailable:** retry the screenshot. Approval stays disabled until the proxy serves a valid image. Check the template screenshot URL later; do not bypass this gate.
- **Hash mismatch or source validation failure:** the source changed or is invalid. Stop, preserve outputs, and obtain an approved replacement artifact; never edit the source to force resume.
- **Corrupt session:** retain the file untouched and begin a new, explicitly named session only after human review of the corruption.
- **Atomic-write exhaustion or paused review:** do not make another decision. Preserve the destination and retained `*.tmp` file, free the filesystem/lock contention, then restart so the last durable session is resumed.

## Read-only source validation

To validate an artifact without identity, client build, listener, session, lock, or outputs:

```powershell
npm.cmd run --silent templates:visual-metadata:review -- --input scratch/template-visual-metadata-review.json --validate-only
```

For the current real artifact, the only output line is:

```text
rows=450 unique=450 suggested=440 failed=10 requiredApprovals=428 decisions=0
```
