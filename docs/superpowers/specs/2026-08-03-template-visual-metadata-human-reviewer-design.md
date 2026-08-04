# Template Visual Metadata Human Reviewer — Design Specification

**Date:** 2026-08-03  
**Status:** Approved in conversation  
**Scope:** Local human-review tool for the generated template visual-metadata artifact

## Purpose

OpenLen has a valid suggestion artifact for 450 published templates: 440 rows contain AI-proposed visual metadata and 10 rows contain typed failures. Every successful suggestion remains `unreviewed`. The tool defined here lets a named human compare each proposal with its full-page screenshot, edit unsupported or missing tags, approve or reject the row, and export a separate import-ready artifact plus an audit record.

The tool must make human review efficient without weakening the central safety rule: no suggestion becomes `reviewed` merely because a model produced it.

## Verified Starting Point

- `lib/templates/visual-metadata.ts` owns `TemplateVisualMetadataSchema` and the `unreviewed | reviewed | rejected` status contract.
- `lib/templates/visual-metadata-review-workflow.ts` owns suggestion-artifact validation and reviewed-input import validation.
- `scripts/templates/import-visual-metadata.ts` imports only rows whose metadata is valid and marked `reviewed`.
- OpenLen already has an admin authorization helper, but it has no persistent review-session, decision-audit, conflict-control, or reviewer-specific permission model.
- The current generated artifact is local and contains evidence that must not be exposed to a deployed browser client.

## Decision and Alternatives

### Chosen: phased hybrid

Build a local, loopback-only reviewer now, with a pure review domain that can later power a deployed internal console. The local adapter uses files; the future production adapter may use database-backed sessions without changing review rules or export semantics.

### Rejected for now: raw JSON review

Editing 440 records directly is inexpensive to build but gives weak visual comparison, poor recovery, no reliable audit trail, and a high risk of accidental schema damage or blanket approval.

### Deferred: production admin console

A deployed console is the enterprise destination, but doing it now would require a new persistence model, reviewer-specific authorization, concurrency control, audit retention, and production threat modeling. Those capabilities are not required to complete the current foundation gate safely.

## Scope

### Included

- A local CLI that launches a browser reviewer on `127.0.0.1`.
- Immutable source-artifact validation and hashing.
- A resumable, versioned review session.
- Individual approve/reject decisions for every suggested row.
- Metadata editing with schema validation.
- Append-only decision and meaningful-edit history.
- Separate import-ready and audit exports.
- Exact coverage calculation against all 450 published rows.
- Keyboard navigation, accessibility, and deterministic recovery.
- A shared resilient atomic JSON writer that also replaces the fragile writer used by the suggestion workflow.

### Excluded

- Calling Gemini or any other AI service.
- Importing metadata into the database.
- Publishing templates or changing their status.
- Bulk approval or an “approve all” action.
- A deployed `openlen.com` route.
- Multi-reviewer collaboration in this phase.
- Automatic inference that changes a model proposal without a human edit.

## Operator Contract

The package command is:

```powershell
npm run templates:visual-metadata:review -- `
  --input scratch/template-visual-metadata-review.json `
  --session scratch/template-visual-metadata-review-session.json `
  --reviewed-out scratch/template-visual-metadata-reviewed.json `
  --audit-out scratch/template-visual-metadata-review-audit.json
```

Reviewer identity is required and resolved in this order:

1. `--reviewer-name` and `--reviewer-email` CLI flags.
2. `OPENLEN_REVIEWER_NAME` and `OPENLEN_REVIEWER_EMAIL` environment variables.
3. A blocking identity form before the artifact is shown.

The user-approved initial reviewer identity is supplied through local runtime configuration. Personal identity values must not be committed to source control or included in normal console logs. They are persisted only in the ignored session file and audit export.

## Architecture

```text
CLI launcher
  └─ loopback review server + per-process token
       ├─ immutable suggestion artifact adapter
       ├─ versioned review-session store
       ├─ safe review API
       └─ bundled React review client
             ├─ screenshot inspection workspace
             ├─ metadata inspector
             ├─ filters and navigation
             └─ completion/export screen
```

### Review domain

Pure TypeScript owns:

- session and event schemas;
- derivation of pending, approved, rejected, and failed state;
- metadata-diff generation;
- edit and decision transitions;
- coverage and gate calculations;
- construction of import-ready and audit exports.

It does not read files, open sockets, launch a browser, call Gemini, or access the database.

### Session store

The store owns:

- artifact SHA-256 verification;
- one-process session locking;
- loading and validating an existing session;
- serialized autosave;
- atomic JSON writes through a shared resilient helper;
- recovery diagnostics that never print raw evidence or reviewer email.

### Local server

The server owns:

- binding to `127.0.0.1` on an available port;
- token exchange and the authenticated browser session;
- origin and request-size checks;
- safe DTO construction;
- screenshot delivery;
- mutation endpoints;
- final export orchestration.

It has no database or model credentials.

### Browser client

The client uses React 19 and a bundle produced at local startup with the repository's existing Esbuild dependency. It receives only the safe DTO. It does not receive `evidence.rawModelResponse`, API credentials, the source filesystem path, or any import capability.

No new dependency is required.

## Versioned Data Contracts

### Session

```typescript
interface ReviewSessionV1 {
  schemaVersion: "template-visual-metadata-review-session/1.0";
  source: {
    sha256: string;
    artifactVersion: string;
    rowCount: number;
    suggestedCount: number;
    failedCount: number;
  };
  reviewer: {
    name: string;
    email: string;
  };
  createdAt: string;
  updatedAt: string;
  currentTemplateId: string | null;
  events: ReviewEventV1[];
}
```

Every date is an ISO-8601 UTC timestamp. A resumed session is accepted only when its schema is valid and its source SHA-256 exactly matches the current input artifact.

### Events

```typescript
type ReviewEventV1 = {
  schemaVersion: "template-visual-metadata-review-event/1.0";
  eventId: string;
  sequence: number;
  templateId: string;
  at: string;
} & (
  | { action: "metadata_updated"; field: string; before: unknown; after: unknown }
  | { action: "approved"; metadata: TemplateVisualMetadata }
  | { action: "rejected"; reason: string }
  | { action: "reopened"; previousDecision: "approved" | "rejected" }
);
```

`sequence` begins at 1 and increases by exactly one. Event IDs are UUIDs. Metadata-update events are emitted on a committed field change, not on every keystroke. The current state is derived by replaying events over the immutable suggestions.

An approval event stores metadata whose `reviewStatus` is set to `reviewed` by trusted server-side domain logic. The client cannot set this status directly.

A rejection reason is trimmed, non-empty, and at most 500 Unicode code points.

### Import-ready export

`template-visual-metadata-reviewed.json` is an array containing only:

```typescript
interface ReviewedExportRow {
  id: string;
  metadata: TemplateVisualMetadata & { reviewStatus: "reviewed" };
}
```

It contains no reviewer identity, rejection notes, event history, raw model output, or failed rows. It is accepted by the existing import validator without relaxing that validator.

### Audit export

`template-visual-metadata-review-audit.json` contains:

- schema version;
- source SHA-256 and artifact version;
- reviewer name and email;
- session start, completion, and export timestamps;
- source totals;
- approved, rejected, failed, and pending counts;
- exact coverage fraction;
- the complete review event sequence;
- a final state summary by template ID.

It must not contain `rawModelResponse`, API credentials, screenshots, or screenshot bytes.

## Gate Semantics

- Denominator: all 450 source rows.
- Required reviewed coverage: `ceil(0.95 × 450) = 428` approved rows.
- Reviewable suggestions: 440.
- Typed failures: 10; visible for diagnosis but never approvable.
- Every one of the 440 suggested rows must receive an individual approved or rejected decision before an import-ready export is enabled.
- Both conditions must hold: no undecided suggestion and at least 428 approved rows.
- If fewer than 428 rows are approved, session and audit export remain available, but the import-ready export is blocked with the exact shortfall.

## Review Experience

### Approved layout: inspection desk

One template fills the workspace:

- the left pane is a dark inspection stage containing the full-page screenshot;
- the right pane is a light metadata inspector;
- progress and operator identity remain visible at the top;
- approve and reject actions remain fixed at the bottom of the inspector;
- a collapsible queue permits targeted navigation without reducing screenshot space by default.

### Visual system

- `Graphite #0B0D10`: screenshot stage.
- `Paper #F7F8FA`: metadata inspector.
- `Ink #17191D`: primary text.
- `Muted #6B7280`: secondary information.
- `Cobalt #2357E8`: focus and progress.
- `Approve #0F8A5F`: approval only.
- `Reject #C43D3D`: rejection only.
- Inter: interface text and decisions.
- JetBrains Mono: IDs, tags, counters, and shortcuts.

The distinctive element is the contrast between the dark evidence stage and the light decision surface. Decoration that does not improve inspection is excluded.

### Metadata inspector

Fields are grouped in this order:

1. domains and audiences;
2. age ranges and emotional registers;
3. visual archetypes and visual signals;
4. layout traits and required asset types;
5. supported site types and supported section roles;
6. negative tags;
7. themeability and identity strength.

String arrays use chip editors and enforce the existing lowercase `snake_case` contract. Suggested values are derived from values already present in the current artifact; choosing a suggestion is still an explicit human edit.

The schema version is visible but immutable. Review status is not editable.

### Decisions and navigation

- `A`: approve and advance.
- `R`: open rejection dialog.
- `J`/`K`: next/previous.
- `E`: focus the inspector.
- `Esc`: close a dialog.
- Shortcuts do nothing while a text or chip editor owns focus.
- There is no multi-select approval.

The approve action is disabled until the screenshot has loaded and the edited metadata passes the full schema. Rejection requires a reason. Reopening a decision appends an event and preserves all prior history.

### Filters and progress

- pending;
- approved;
- rejected;
- failed;
- search by ID, name, or metadata tag.

The progress header reports decisions out of 440, approvals out of the required 428, rejects, failures, and remaining approvals needed.

## Safety and Security

### Loopback boundary

- Bind only to `127.0.0.1`, never `0.0.0.0`.
- Generate at least 256 random bits for each server process.
- Accept the token once, set an `HttpOnly`, `SameSite=Strict` session cookie, and redirect to a URL without the token.
- Reject unauthenticated requests with 401.
- Require the exact local origin on mutation requests and reject mismatches with 403.
- Enforce JSON content type and bounded body size.
- Set `frame-ancestors 'none'`, `base-uri 'none'`, and a restrictive Content Security Policy.

### Safe DTO

The browser may receive only:

- template ID and name;
- screenshot endpoint URL;
- proposed or edited metadata;
- typed failure category for failed rows;
- derived review state and aggregate progress;
- source artifact version and abbreviated hash;
- reviewer display name, but not email.

The server must prove through tests that `evidence`, `rawModelResponse`, reviewer email, source absolute paths, credentials, and model prompts are absent.

### Single-writer lock

The session path has a companion lock containing process ID, start time, and a random process identifier. A second live process fails closed. A stale lock may be reclaimed only after its recorded process is confirmed absent and the session validates successfully.

### Shared atomic writer

The JSON writer:

- writes a uniquely named temporary file in the destination directory;
- flushes and closes it before replacement;
- retries only transient `EPERM`, `EACCES`, and `EBUSY` replacement failures;
- uses bounded exponential delays of 20, 40, 80, 160, and 320 milliseconds;
- never deletes the current destination before a successful replacement;
- preserves the final temporary file when retries are exhausted;
- surfaces a typed error containing safe paths relative to the workspace, not file contents.

The suggestion workflow must adopt this shared helper, closing the observed Windows-reader race without changing suggestion-artifact semantics.

## Failure Behavior

| Failure | Required behavior |
|---|---|
| Invalid source JSON or schema | Fail before creating or modifying a session. |
| Duplicate/missing template IDs | Fail before launch and report counts plus safe IDs. |
| Artifact hash differs from session | Refuse resume; preserve both files. |
| Screenshot fails to load | Keep row reviewable only for rejection; disable approval and offer retry. |
| Invalid metadata edit | Preserve draft, show field error, disable approval. |
| Session save fails | Freeze mutations and navigation, retain recoverable temp, show retry/exit actions. |
| Second reviewer process | Fail closed without modifying the session. |
| Corrupt existing session | Preserve it, refuse to overwrite, and show a recovery command. |
| Gate below 428 approvals | Allow session/audit backup; block import-ready export with the exact shortfall. |
| Export replacement fails | Preserve prior export and recoverable temp; never report success. |

## Accessibility and Responsive Behavior

- Every control is reachable by keyboard and has a visible focus state.
- Status is conveyed by label and icon as well as color.
- Dialog focus is trapped and restored correctly.
- The screenshot has a meaningful accessible name derived from the template name.
- The interface honors `prefers-reduced-motion`.
- At desktop widths the approved split layout is preserved.
- At narrow widths the inspector stacks below the screenshot; all actions remain available and no field becomes read-only.
- Minimum target sizes are 44 CSS pixels for primary pointer actions.

## Test Strategy and Acceptance Criteria

Implementation follows strict red-green-refactor TDD.

### Domain tests

- valid and invalid session/event schemas;
- exact event sequencing and replay;
- edit, approve, reject, reopen, and repeated-decision transitions;
- non-empty 500-code-point rejection bound;
- server-owned `reviewStatus: reviewed` transition;
- exact `ceil(0.95 × denominator)` behavior, including 428/450 and 427/450;
- final-export blocking until all 440 suggestions are decided;
- import-ready and audit output minimization.

### Store tests

- new session and exact-hash resume;
- hash mismatch and corrupt-session refusal;
- live and stale locks;
- serialized autosave;
- transient Windows replacement failure followed by success;
- retry exhaustion preserving the prior destination and temp;
- source artifact remains byte-for-byte unchanged.

### Server tests

- loopback-only binding;
- one-time token exchange, cookie attributes, and redirect;
- 401 without authentication;
- 403 on origin mismatch;
- request content-type and size limits;
- CSP and anti-framing headers;
- safe DTO excludes raw evidence, email, prompts, paths, and credentials;
- failed screenshot prevents approval;
- no database or Gemini module is imported by the server boundary.

### Browser tests

- identity fallback form when local identity is absent;
- load, edit, approve, and advance;
- rejection reason requirement;
- shortcuts and focus suppression while typing;
- filters and search;
- restart and resume;
- reopening a prior decision;
- completion state and both exports;
- gate failure with exact shortfall;
- desktop and narrow viewport visual snapshots;
- keyboard-only critical path and reduced-motion behavior.

### Completion evidence

- Focused Vitest suites pass.
- Typecheck passes.
- Playwright critical-path and visual checks pass.
- The real artifact opens with 450 unique rows, 440 suggestions, and 10 failures.
- A disposable copy can be reviewed and exported without modifying the source.
- No real reviewed artifact is imported during automated verification.

## Observability

The local Node entry uses the repository's existing `@inariwatch/capture` automatic instrumentation. Local development needs no DSN. Logs may include operation kind, safe template ID, counts, duration, and typed error category; they must not include metadata bodies, raw responses, screenshot bytes, tokens, reviewer email, or absolute source paths.

## Production Evolution

The future internal console reuses the review domain and safe DTO, replacing only the file session store and loopback authentication adapter. Before deployment it requires:

- a database-backed review-session/event model;
- a least-privilege `template_reviewer` permission separate from import permission;
- authenticated per-request authorization;
- optimistic concurrency control;
- protected audit retention;
- production CSP and CSRF verification;
- operational monitoring and backup policy;
- a separate, explicitly privileged import action.

This future phase is not required to review the current artifact and is not authorized by this specification.
