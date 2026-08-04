# Template Visual Metadata Human Reviewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a secure local review desk that lets one named human inspect every visual-metadata suggestion, resume safely, and export separate import-ready and audit artifacts without modifying templates, calling Gemini, or accessing the database.

**Architecture:** A pure versioned review domain is wrapped by a serialized file-session store and a token-protected HTTP server bound only to `127.0.0.1`. A locally bundled React client implements the approved inspection-desk UI. File storage is an adapter: the same domain and safe DTO can later support a production admin console.

**Tech Stack:** TypeScript, Zod, Node HTTP, React 19, Esbuild, Vitest/jsdom, Playwright, existing `@inariwatch/capture` instrumentation.

## Global Constraints

- The source suggestion artifact is immutable; every session and export uses a separate path.
- No Gemini, database, import, publish, or template-content mutation is permitted in this plan.
- No bulk approval. Every suggested row receives an individual approve or reject decision.
- `reviewStatus: "reviewed"` is set only by trusted server-side domain logic after an approval.
- The import-ready export is enabled only after all suggested rows are decided and approved coverage is at least `ceil(0.95 × total source rows)`.
- The current real corpus expectation is 450 unique rows, 440 suggestions, 10 typed failures, and a minimum of 428 approvals.
- Bind only to `127.0.0.1`; never use `0.0.0.0`.
- Browser DTOs and logs must exclude `evidence`, `rawModelResponse`, model prompts, credentials, reviewer email, absolute source paths, and screenshot bytes.
- Reviewer identity is provided at runtime and persisted only in ignored session/audit files; personal identity values are never committed.
- Do not add dependencies. Use React 19, Esbuild, jsdom, Vitest, and Playwright already present.
- New behavior follows strict red-green-refactor TDD. Every implementation task records the failing command/output before production code.
- Use the existing `@inariwatch/capture` automatic instrumentation; no DSN is required locally.
- The approved visual direction is the dark evidence stage plus light metadata inspector documented in `docs/superpowers/specs/2026-08-03-template-visual-metadata-human-reviewer-design.md`.

---

### Task 1: Add a resilient shared atomic JSON writer

**Files:**
- Create: `lib/fs/write-json-atomic.ts`
- Create: `lib/fs/write-json-atomic.test.ts`
- Modify: `lib/templates/visual-metadata-review-workflow.ts`
- Modify: `lib/templates/visual-metadata-review-workflow.test.ts`
- Modify: `scripts/templates/suggest-visual-metadata.ts`
- Modify: `vitest.config.ts`

**Interfaces:**
- Produces: `writeJsonAtomic(targetPath, value, options?) => Promise<AtomicWriteResult>`.
- Produces: `AtomicJsonWriteError` with `code`, relative `targetPath`, and retained `temporaryPath`.
- Changes: `writeSuggestionArtifactAtomic(path, rows) => Promise<void>`.

- [ ] **Step 1: Add the new test path to Vitest and write failing atomic-writer tests**

Add `"lib/fs/**/*.test.ts"` to `vitest.config.ts`. Create tests with this dependency-injection surface:

```typescript
interface AtomicJsonWriterOptions {
  retryDelaysMs?: readonly number[];
  sleep?: (delayMs: number) => Promise<void>;
  rename?: (from: string, to: string) => Promise<void>;
  randomId?: () => string;
}
```

Tests must prove:

```typescript
it("writes newline-terminated formatted JSON without touching the previous file early", async () => {});
it("retries EPERM with exactly 20, 40, 80, 160, and 320 millisecond bounds", async () => {});
it.each(["EACCES", "EBUSY"])("retries transient %s replacement failures", async () => {});
it("does not retry a non-transient EINVAL", async () => {});
it("preserves the prior destination and final temporary file after exhaustion", async () => {});
```

The failure-to-success tests inject a `rename` function that throws a Node-style error with `code` before delegating to `node:fs/promises.rename`.

- [ ] **Step 2: Run the writer tests and verify RED**

Run:

```powershell
npx.cmd vitest run lib/fs/write-json-atomic.test.ts
```

Expected: FAIL because `lib/fs/write-json-atomic.ts` does not exist.

- [ ] **Step 3: Implement the minimal resilient writer**

Implement:

```typescript
export const ATOMIC_JSON_RETRY_DELAYS_MS = [20, 40, 80, 160, 320] as const;

export interface AtomicWriteResult {
  targetPath: string;
  temporaryPath: string;
}

export class AtomicJsonWriteError extends Error {
  readonly code: string;
  readonly targetPath: string;
  readonly temporaryPath: string;
}

export async function writeJsonAtomic(
  targetPath: string,
  value: unknown,
  options: AtomicJsonWriterOptions = {},
): Promise<AtomicWriteResult>;
```

Use a unique temp name in the destination directory: `<basename>.<pid>.<randomId>.tmp`. Open it with `wx`, write `${JSON.stringify(value, null, 2)}\n`, call `FileHandle.sync()`, close it, and then replace the destination. Retry only `EPERM`, `EACCES`, and `EBUSY`. Never unlink the destination. Retain the temp after final replacement failure.

- [ ] **Step 4: Run the writer tests and verify GREEN**

Run the Step 2 command. Expected: all writer tests PASS.

- [ ] **Step 5: Write failing workflow integration tests**

Amend `lib/templates/visual-metadata-review-workflow.test.ts` to assert that:

```typescript
it("awaits the resilient atomic writer for every checkpoint", async () => {});
it("leaves the prior suggestion artifact valid when replacement is exhausted", async () => {});
```

Update existing calls in tests to await `writeSuggestionArtifactAtomic`.

- [ ] **Step 6: Run the workflow tests and verify RED**

Run:

```powershell
npx.cmd vitest run lib/templates/visual-metadata-review-workflow.test.ts
```

Expected: FAIL because the workflow still uses synchronous `writeFileSync`/`renameSync`.

- [ ] **Step 7: Adopt the shared writer in the suggestion workflow**

Remove direct `writeFileSync`/`renameSync` usage. Implement:

```typescript
export async function writeSuggestionArtifactAtomic(
  path: string,
  rows: SuggestionArtifactRow[],
): Promise<void> {
  await writeJsonAtomic(path, rows);
}
```

Await the seed, checkpoint, and final writes in `scripts/templates/suggest-visual-metadata.ts`.

- [ ] **Step 8: Verify Task 1**

Run:

```powershell
npx.cmd vitest run lib/fs/write-json-atomic.test.ts lib/templates/visual-metadata-review-workflow.test.ts
npm.cmd run typecheck
```

Expected: PASS and exit 0. Do not run Gemini.

- [ ] **Step 9: Commit Task 1**

```powershell
git add lib/fs/write-json-atomic.ts lib/fs/write-json-atomic.test.ts lib/templates/visual-metadata-review-workflow.ts lib/templates/visual-metadata-review-workflow.test.ts scripts/templates/suggest-visual-metadata.ts vitest.config.ts
git commit -m "fix(templates): harden atomic review artifacts"
```

---

### Task 2: Implement the versioned review domain and export gate

**Files:**
- Create: `lib/templates/visual-metadata-review-session.ts`
- Create: `lib/templates/visual-metadata-review-session.test.ts`
- Modify: `vitest.config.ts`

**Interfaces:**
- Consumes: `SuggestionArtifactRow`, `TemplateVisualMetadataSchema`.
- Produces: `ReviewSessionV1`, `ReviewEventV1`, `ReviewCommand`, `DerivedReviewState`.
- Produces: `createReviewSession`, `applyReviewCommand`, `deriveReviewState`, `requiredApprovalCount`, `buildReviewExports`, `buildSafeReviewDto`.

- [ ] **Step 1: Write failing schema and transition tests**

Add tests for these exact versions and commands:

```typescript
export const REVIEW_SESSION_VERSION = "template-visual-metadata-review-session/1.0" as const;
export const REVIEW_EVENT_VERSION = "template-visual-metadata-review-event/1.0" as const;

type ReviewCommand =
  | { action: "metadata_updated"; templateId: string; field: MetadataArrayField | MetadataScalarField; value: unknown }
  | { action: "approved"; templateId: string }
  | { action: "rejected"; templateId: string; reason: string }
  | { action: "reopened"; templateId: string };
```

Required tests:

```typescript
it("creates a v1 session without copying raw evidence", () => {});
it("emits contiguous sequences and deterministic derived state", () => {});
it("validates lowercase snake_case arrays through the authoritative metadata schema", () => {});
it("sets reviewed only inside an approved server-side transition", () => {});
it("rejects approval of failed rows", () => {});
it("requires a trimmed non-empty rejection reason of at most 500 code points", () => {});
it("reopens an approval without erasing history", () => {});
it.each([[450, 428], [100, 95], [3, 3], [0, 0]])("computes ceil 95 percent for %i as %i", () => {});
it("blocks final export while one suggestion is pending", () => {});
it("blocks final export at 427 of 450 and enables it at 428 of 450", () => {});
```

- [ ] **Step 2: Run the domain tests and verify RED**

```powershell
npx.cmd vitest run lib/templates/visual-metadata-review-session.test.ts
```

Expected: FAIL because the domain module does not exist.

- [ ] **Step 3: Implement schemas, replay, and transitions**

Use strict Zod schemas. Inject deterministic dependencies:

```typescript
interface ReviewTransitionDeps {
  now: () => Date;
  eventId: () => string;
}

export function createReviewSession(args: {
  sourceSha256: string;
  rows: SuggestionArtifactRow[];
  reviewer: { name: string; email: string };
  now: Date;
}): ReviewSessionV1;

export function applyReviewCommand(
  session: ReviewSessionV1,
  sourceRows: readonly SuggestionArtifactRow[],
  command: ReviewCommand,
  deps: ReviewTransitionDeps,
): ReviewSessionV1;
```

Replay immutable suggestions plus events to derive drafts and final decisions. `metadata_updated` stores a field-level `before` and `after`; it is emitted only after a committed chip/scalar edit. Approval parses the complete draft, overwrites only `reviewStatus` with `reviewed`, and appends the approved snapshot.

- [ ] **Step 4: Implement minimized DTOs and exports**

```typescript
export interface SafeReviewItemDto {
  id: string;
  name: string;
  screenshotEndpoint: string | null;
  metadata: TemplateVisualMetadata | null;
  failureKind: string | null;
  state: "pending" | "approved" | "rejected" | "failed";
}

export type SafeReviewSessionDto =
  | { phase: "identity_required" }
  | {
      phase: "review";
      reviewerName: string;
      source: { artifactVersion: string; abbreviatedSha256: string };
      progress: {
        total: number;
        suggested: number;
        failed: number;
        pending: number;
        approved: number;
        rejected: number;
        requiredApprovals: number;
        remainingApprovals: number;
        finalExportEnabled: boolean;
      };
      currentTemplateId: string | null;
    };

export function buildReviewExports(...): {
  reviewed: Array<{ id: string; metadata: TemplateVisualMetadata & { reviewStatus: "reviewed" } }>;
  audit: ReviewAuditV1;
};
```

`buildSafeReviewDto` must construct new objects field by field and never spread source rows.

- [ ] **Step 5: Run the domain tests and verify GREEN**

Run the Step 2 command. Expected: all domain tests PASS.

- [ ] **Step 6: Verify Task 2**

```powershell
npx.cmd vitest run lib/templates/visual-metadata-review-session.test.ts lib/templates/visual-metadata.test.ts
npm.cmd run typecheck
```

Expected: PASS and exit 0.

- [ ] **Step 7: Commit Task 2**

```powershell
git add lib/templates/visual-metadata-review-session.ts lib/templates/visual-metadata-review-session.test.ts vitest.config.ts
git commit -m "feat(templates): add human review session domain"
```

---

### Task 3: Add the resumable single-writer session store

**Files:**
- Create: `lib/templates/visual-metadata-review-session-store.ts`
- Create: `lib/templates/visual-metadata-review-session-store.test.ts`

**Interfaces:**
- Consumes: Task 1 atomic writer and Task 2 domain.
- Produces: `loadVisualMetadataReviewSource(inputPath) => Promise<LoadedReviewSource>` for validation-only and workspace startup.
- Produces: `openVisualMetadataReviewWorkspace(config) => Promise<VisualMetadataReviewWorkspace>`.
- Produces: serialized `dispatch`, `setCurrentTemplate`, `exportFinal`, and `close` methods.

- [ ] **Step 1: Write failing workspace tests**

Use a fresh temporary directory per test. Cover:

```typescript
it("hashes and validates the immutable source before creating a session", async () => {});
it("resumes only when the source hash and reviewer identity match", async () => {});
it("refuses a corrupt session without overwriting it", async () => {});
it("serializes concurrent dispatch calls in event-sequence order", async () => {});
it("rejects a second live lock owner", async () => {});
it("reclaims a stale lock only after process absence and session validation", async () => {});
it("keeps the source bytes unchanged across edits and exports", async () => {});
it("writes reviewed and audit files only when the final gate passes", async () => {});
it("allows an audit backup but not reviewed export below the gate", async () => {});
```

Inject `processExists(pid)`, `now`, `eventId`, and `lockId` for deterministic tests.

- [ ] **Step 2: Run store tests and verify RED**

```powershell
npx.cmd vitest run lib/templates/visual-metadata-review-session-store.test.ts
```

Expected: FAIL because the store module does not exist.

- [ ] **Step 3: Implement source loading and strict resume**

```typescript
export interface ReviewWorkspaceConfig {
  inputPath: string;
  sessionPath: string;
  reviewedOutputPath: string;
  auditOutputPath: string;
  reviewer: { name: string; email: string };
}

export interface VisualMetadataReviewWorkspace {
  snapshot(): ReviewWorkspaceSnapshot;
  dispatch(command: ReviewCommand): Promise<ReviewWorkspaceSnapshot>;
  setCurrentTemplate(id: string): Promise<ReviewWorkspaceSnapshot>;
  exportFinal(): Promise<{ reviewedPath: string; auditPath: string }>;
  exportAuditBackup(): Promise<{ auditPath: string }>;
  close(): Promise<void>;
}

export interface LoadedReviewSource {
  sha256: string;
  rows: SuggestionArtifactRow[];
  counts: { rows: number; unique: number; suggested: number; failed: number; requiredApprovals: number };
}
```

Read source bytes once, hash them, parse JSON, preflight non-empty unique IDs, and validate all rows with the existing suggestion-artifact validator. Save relative filenames and hash in the session, not the absolute input path.

- [ ] **Step 4: Implement locking and serialized autosave**

The lock path is `${sessionPath}.lock` and stores version, PID, process UUID, and ISO start time. Queue every mutation through one promise chain. A failed save freezes subsequent mutations with one typed error until restart; it must never advance the in-memory snapshot beyond the last durable state.

- [ ] **Step 5: Run store tests and verify GREEN**

Run the Step 2 command. Expected: all store tests PASS.

- [ ] **Step 6: Verify Task 3**

```powershell
npx.cmd vitest run lib/fs/write-json-atomic.test.ts lib/templates/visual-metadata-review-session.test.ts lib/templates/visual-metadata-review-session-store.test.ts
npm.cmd run typecheck
```

Expected: PASS and exit 0.

- [ ] **Step 7: Commit Task 3**

```powershell
git add lib/templates/visual-metadata-review-session-store.ts lib/templates/visual-metadata-review-session-store.test.ts
git commit -m "feat(templates): persist resumable review sessions"
```

---

### Task 4: Build the token-protected loopback review server

**Files:**
- Create: `lib/templates/visual-metadata-review-server.ts`
- Create: `lib/templates/visual-metadata-review-server.test.ts`

**Interfaces:**
- Consumes: a ready `VisualMetadataReviewWorkspace` or a reviewer-driven workspace factory, plus prebuilt client assets.
- Produces: `startVisualMetadataReviewServer(options) => Promise<RunningReviewServer>`.

- [ ] **Step 1: Write failing authentication and header tests**

Test a real ephemeral HTTP listener with a fake in-memory workspace. Required cases:

```typescript
it("binds explicitly to 127.0.0.1 on an ephemeral port", async () => {});
it("exchanges a one-use bootstrap token for HttpOnly SameSite Strict cookie and redirects", async () => {});
it("rejects a reused bootstrap token", async () => {});
it("returns 401 without the cookie and 403 for a foreign mutation Origin", async () => {});
it("sets the restrictive CSP and anti-framing headers", async () => {});
it("rejects non-JSON and bodies larger than 64 KiB", async () => {});
it("opens the workspace through the identity endpoint when runtime identity is absent", async () => {});
```

The CSP must contain:

```text
default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'
```

- [ ] **Step 2: Write failing safe-DTO and mutation tests**

Cover:

```typescript
it("never serializes evidence, rawModelResponse, email, prompts, credentials, or source paths", async () => {});
it("proxies only HTTPS screenshots hosted by templates.openlen.com", async () => {});
it("rejects non-image, oversized, and timed-out screenshot responses", async () => {});
it("prevents approval until that template screenshot was served successfully", async () => {});
it("dispatches edit, approve, reject, reopen, navigation, and export commands", async () => {});
```

Inject `fetchImpl` and use small byte fixtures; never call the real CDN in tests.

- [ ] **Step 3: Run server tests and verify RED**

```powershell
npx.cmd vitest run lib/templates/visual-metadata-review-server.test.ts
```

Expected: FAIL because the server module does not exist.

- [ ] **Step 4: Implement the loopback server and API**

```typescript
export interface ReviewClientAssets { javascript: string; css: string; }
export interface RunningReviewServer {
  bootstrapUrl: string;
  origin: string;
  close(): Promise<void>;
}

export async function startVisualMetadataReviewServer(options: {
  workspace?: VisualMetadataReviewWorkspace;
  workspaceFactory?: (reviewer: { name: string; email: string }) => Promise<VisualMetadataReviewWorkspace>;
  assets: ReviewClientAssets;
  fetchImpl?: typeof fetch;
  randomBytes?: (size: number) => Buffer;
}): Promise<RunningReviewServer>;
```

Require exactly one of `workspace` or `workspaceFactory`. Until a factory has accepted valid identity, authenticated session reads return `{ phase: "identity_required" }` and no source row is sent to the browser.

Use these routes:

```text
GET   /?bootstrap=<token>             exchange token and redirect
GET   /                              app shell
GET   /assets/app.js                 bundled client
GET   /assets/app.css                approved styles
GET   /api/session                   safe snapshot and progress
POST  /api/identity                  create workspace when identity is absent
GET   /api/items?status=&q=          filtered safe items
GET   /api/items/:id/screenshot      validated same-origin image proxy
PATCH /api/items/:id/metadata        one committed field edit
POST  /api/items/:id/decision        approve or reject
POST  /api/items/:id/reopen          append reopen event
POST  /api/navigation                persist current template
POST  /api/export                    final export or typed gate failure
POST  /api/export/audit              audit backup below gate
```

Mark a screenshot as served only after the proxy has obtained a valid `image/*` response no larger than 20 MiB. Use a 20-second abort timeout.

- [ ] **Step 5: Run server tests and verify GREEN**

Run the Step 3 command. Expected: all server tests PASS.

- [ ] **Step 6: Verify Task 4**

```powershell
npx.cmd vitest run lib/templates/visual-metadata-review-server.test.ts lib/templates/visual-metadata-review-session-store.test.ts lib/templates/visual-metadata-review-session.test.ts
npm.cmd run typecheck
```

Expected: PASS and exit 0.

- [ ] **Step 7: Commit Task 4**

```powershell
git add lib/templates/visual-metadata-review-server.ts lib/templates/visual-metadata-review-server.test.ts
git commit -m "feat(templates): serve secure local review sessions"
```

---

### Task 5: Build the approved React inspection desk

**Files:**
- Create: `tools/template-visual-metadata-reviewer/api.ts`
- Create: `tools/template-visual-metadata-reviewer/app.tsx`
- Create: `tools/template-visual-metadata-reviewer/app.test.tsx`
- Create: `tools/template-visual-metadata-reviewer/components/inspection-workspace.tsx`
- Create: `tools/template-visual-metadata-reviewer/components/metadata-inspector.tsx`
- Create: `tools/template-visual-metadata-reviewer/components/review-queue.tsx`
- Create: `tools/template-visual-metadata-reviewer/components/completion-panel.tsx`
- Create: `tools/template-visual-metadata-reviewer/styles.css`
- Modify: `vitest.config.ts`

**Interfaces:**
- Consumes: Task 4 JSON API.
- Produces: a browser entry at `tools/template-visual-metadata-reviewer/app.tsx` and a CSS entry.

- [ ] **Step 1: Add the client test path and write failing interaction tests**

Add these Vitest includes:

```typescript
"tools/template-visual-metadata-reviewer/**/*.test.ts",
"tools/template-visual-metadata-reviewer/**/*.test.tsx",
```

Using jsdom, `createRoot`, and React `act`, test:

```typescript
it("renders the screenshot stage and metadata inspector from the safe DTO", async () => {});
it("shows a blocking identity form before requesting any review item", async () => {});
it("disables approval until the screenshot load event and valid metadata", async () => {});
it("commits snake_case chip edits and shows validation errors", async () => {});
it("requires rejection reason and advances after a successful decision", async () => {});
it("supports A R J K E and Esc but suppresses shortcuts in editors", async () => {});
it("filters pending approved rejected failed and searches id name or tag", async () => {});
it("shows exact remaining approvals and completion gate state", async () => {});
it("never renders reviewer email or raw evidence", async () => {});
```

Mock only the typed `ReviewerApi` boundary, not the components or state transitions.

- [ ] **Step 2: Run client tests and verify RED**

```powershell
npx.cmd vitest run tools/template-visual-metadata-reviewer/app.test.tsx
```

Expected: FAIL because the client files do not exist.

- [ ] **Step 3: Implement the API client and app state**

```typescript
export interface ReviewerApi {
  getSession(): Promise<SafeReviewSessionDto>;
  submitIdentity(reviewer: { name: string; email: string }): Promise<SafeReviewSessionDto>;
  getItems(filters: { status?: ReviewState; q?: string }): Promise<SafeReviewItemDto[]>;
  updateMetadata(id: string, field: string, value: unknown): Promise<SafeReviewSessionDto>;
  decide(id: string, decision: { action: "approved" } | { action: "rejected"; reason: string }): Promise<SafeReviewSessionDto>;
  reopen(id: string): Promise<SafeReviewSessionDto>;
  navigate(id: string): Promise<void>;
  exportFinal(): Promise<ExportResultDto>;
  exportAudit(): Promise<ExportResultDto>;
}
```

Use explicit JSON parsing and typed error mapping. Do not use `dangerouslySetInnerHTML`.

- [ ] **Step 4: Implement focused UI components**

Keep the approved responsibilities:

- `InspectionWorkspace`: screenshot, zoom/fit controls, load/error state, current identity.
- `MetadataInspector`: seven approved field groups, chip/scalar editors, validation, fixed decision dock.
- `ReviewQueue`: collapsible filters, search, and safe item navigation.
- `CompletionPanel`: totals, exact shortfall, audit backup, and final export.

Implement the approved shortcuts with one document listener that ignores events originating from `input`, `textarea`, `select`, `[contenteditable]`, or open dialogs.

- [ ] **Step 5: Implement the approved visual tokens and accessibility**

Define CSS custom properties with the exact approved palette:

```css
:root {
  --review-stage: #0b0d10;
  --review-paper: #f7f8fa;
  --review-ink: #17191d;
  --review-muted: #6b7280;
  --review-focus: #2357e8;
  --review-approve: #0f8a5f;
  --review-reject: #c43d3d;
}
```

Use existing Inter and JetBrains Mono fallbacks. Add visible `:focus-visible`, 44px primary targets, dialog focus trap/restoration, labeled status icons, reduced-motion handling, and the approved narrow stacked layout.

- [ ] **Step 6: Run client tests and verify GREEN**

Run the Step 2 command. Expected: all client tests PASS.

- [ ] **Step 7: Verify Task 5**

```powershell
npx.cmd vitest run tools/template-visual-metadata-reviewer/app.test.tsx lib/templates/visual-metadata-review-server.test.ts
npm.cmd run typecheck
```

Expected: PASS and exit 0.

- [ ] **Step 8: Commit Task 5**

```powershell
git add tools/template-visual-metadata-reviewer vitest.config.ts
git commit -m "feat(templates): add metadata inspection desk"
```

---

### Task 6: Add the instrumented launcher and local bundle

**Files:**
- Create: `lib/templates/visual-metadata-review-launcher.ts`
- Create: `lib/templates/visual-metadata-review-launcher.test.ts`
- Create: `scripts/templates/review-visual-metadata.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: Tasks 3–5.
- Produces: `parseReviewCliArgs`, `buildReviewClientAssets`, `openReviewBrowser`, `runVisualMetadataReviewer`.
- Produces: `npm run templates:visual-metadata:review`.

- [ ] **Step 1: Write failing argument, bundle, and lifecycle tests**

Cover:

```typescript
it("requires input session reviewed-out and audit-out paths", () => {});
it("resolves reviewer identity flags before environment values", () => {});
it("permits an identity-form fallback without logging the email", () => {});
it("builds one JavaScript and one CSS asset without writing a dist directory", async () => {});
it("opens only the server-generated localhost bootstrap URL", async () => {});
it("supports --no-open and releases server plus lock on SIGINT", async () => {});
it("requires only --input in --validate-only mode and prints safe aggregate counts", async () => {});
```

Inject environment, argv, Esbuild `build`, browser opener, signal registrar, and server/workspace factories.

- [ ] **Step 2: Run launcher tests and verify RED**

```powershell
npx.cmd vitest run lib/templates/visual-metadata-review-launcher.test.ts
```

Expected: FAIL because the launcher module does not exist.

- [ ] **Step 3: Implement in-memory Esbuild bundling**

Bundle `tools/template-visual-metadata-reviewer/app.tsx` with `bundle: true`, `write: false`, `format: "iife"`, `platform: "browser"`, `jsx: "automatic"`, and production defines. Capture the emitted JavaScript and CSS output files; fail if either is absent.

- [ ] **Step 4: Implement safe browser opening and lifecycle**

Support `win32`, `darwin`, and Linux using injected `spawn`, `windowsHide: true`, and fixed executable/argument arrays. The URL must be parsed and accepted only when hostname is `127.0.0.1` or `localhost`, protocol is `http:`, and it contains the server-generated bootstrap token.

Register `SIGINT` and `SIGTERM` handlers that close server then workspace exactly once.

When neither flags nor environment provide identity, start the server with `workspaceFactory`; the client submits name and email once to `POST /api/identity`. Implement `--validate-only` by calling `loadVisualMetadataReviewSource` directly. It requires only `--input`, prints only `rows`, `unique`, `suggested`, `failed`, `requiredApprovals`, and `decisions=0`, and exits without creating a session, building client assets, or opening a listener.

- [ ] **Step 5: Create the instrumented CLI and package scripts**

Start the entry with:

```typescript
import "@inariwatch/capture/auto";
```

Add:

```json
"templates:visual-metadata:review": "tsx --env-file=.env.local --tsconfig tsconfig.eval.json scripts/templates/review-visual-metadata.ts",
"test:template-reviewer": "vitest run lib/fs/write-json-atomic.test.ts lib/templates/visual-metadata-review-session.test.ts lib/templates/visual-metadata-review-session-store.test.ts lib/templates/visual-metadata-review-server.test.ts lib/templates/visual-metadata-review-launcher.test.ts tools/template-visual-metadata-reviewer/app.test.tsx"
```

Console output is limited to safe relative filenames, aggregate counts, origin without bootstrap token, and typed error categories.

- [ ] **Step 6: Run launcher tests and verify GREEN**

Run the Step 2 command. Expected: all launcher tests PASS.

- [ ] **Step 7: Verify Task 6**

```powershell
npm.cmd run test:template-reviewer
npm.cmd run typecheck
```

Expected: PASS and exit 0.

- [ ] **Step 8: Commit Task 6**

```powershell
git add lib/templates/visual-metadata-review-launcher.ts lib/templates/visual-metadata-review-launcher.test.ts scripts/templates/review-visual-metadata.ts package.json
git commit -m "feat(templates): launch local metadata reviewer"
```

---

### Task 7: Add browser, visual, and real-artifact verification

**Files:**
- Create: `tests/e2e/template-visual-metadata-reviewer.spec.ts`
- Create: `tests/e2e/template-visual-metadata-reviewer.spec.ts-snapshots/reviewer-desktop-chromium-win32.png`
- Create: `tests/e2e/template-visual-metadata-reviewer.spec.ts-snapshots/reviewer-narrow-chromium-win32.png`
- Create: `docs/operations/template-visual-metadata-review.md`

**Interfaces:**
- Consumes: the completed local reviewer.
- Produces: repeatable E2E/visual verification and the operator runbook.

- [ ] **Step 1: Write the failing Playwright critical path**

Create a temporary 20-row artifact per test: 19 valid suggestions and one typed failure. Start the real workspace, real server, and real built client in `beforeAll`; never call Gemini or the database.

Cover:

```typescript
test("reviews every suggestion, resumes, and exports 19 of 20 at the 95 percent gate", async ({ page }) => {});
test("cannot approve before the screenshot proxy succeeds", async ({ page }) => {});
test("requires rejection reason and reports the exact gate shortfall", async ({ page }) => {});
test("supports the keyboard-only critical path", async ({ page }) => {});
test("never exposes raw evidence or reviewer email in API responses or DOM", async ({ page }) => {});
test("matches the approved desktop inspection desk", async ({ page }) => {});
test("matches the approved narrow stacked layout", async ({ page }) => {});
```

Stub only the screenshot network dependency with valid in-memory image bytes.

- [ ] **Step 2: Run the new E2E suite and record the integration baseline**

```powershell
npx.cmd playwright test tests/e2e/template-visual-metadata-reviewer.spec.ts --project=chromium
```

Expected at task completion: PASS. If any assertion fails, treat it as an integration defect and follow Step 3; do not weaken the E2E assertion to match the implementation.

- [ ] **Step 3: Convert every integration defect into a focused RED regression before fixing it**

For each failing E2E assertion, identify the owning boundary and add one focused test first:

- domain behavior → `lib/templates/visual-metadata-review-session.test.ts`;
- persistence/lock behavior → `lib/templates/visual-metadata-review-session-store.test.ts`;
- HTTP/auth/screenshot behavior → `lib/templates/visual-metadata-review-server.test.ts`;
- launcher/lifecycle behavior → `lib/templates/visual-metadata-review-launcher.test.ts`;
- rendering/interaction behavior → `tools/template-visual-metadata-reviewer/app.test.tsx`.

Run the focused test and confirm RED for the same reason as the E2E failure. Implement only the behavior required by that test, confirm GREEN, then re-run the single E2E test. Repeat per distinct defect; never bundle unrelated corrections.

- [ ] **Step 4: Create and inspect visual baselines**

```powershell
npx.cmd playwright test tests/e2e/template-visual-metadata-reviewer.spec.ts --project=chromium --update-snapshots
```

Inspect both PNGs. Confirm the dark screenshot stage, light inspector, fixed decisions, visible focus, progress, and narrow stacking match the approved companion mockup. Remove any decorative element that competes with the screenshot.

- [ ] **Step 5: Re-run E2E against the baselines**

Run the Step 2 command. Expected: all reviewer E2E tests PASS with `maxDiffPixelRatio <= 0.001` from the existing Playwright config.

- [ ] **Step 6: Write the exact operator runbook**

Document:

- required local identity environment variables;
- the exact launch command from the design spec;
- source immutability and ignored output files;
- states, shortcuts, rejection rule, and 428/450 gate;
- safe restart and stale-lock recovery;
- final validation of both exports;
- the separate existing import command, explicitly labeled as a later human-authorized operation;
- troubleshooting for screenshot failure, hash mismatch, corrupt session, and atomic-write exhaustion.

- [ ] **Step 7: Verify against the real artifact without creating decisions**

Run the completed CLI against the real input without creating a session:

```powershell
npm.cmd run templates:visual-metadata:review -- --input scratch/template-visual-metadata-review.json --validate-only
```

Verify it prints only these aggregates:

```text
rows=450 unique=450 suggested=440 failed=10 requiredApprovals=428 decisions=0
```

Confirm the source SHA-256 remains `1ED7746FB4221C8089C6F41841515A0AEF8857CDBFCFC79F2A0A2B1872FA947A`. Confirm no session, reviewed output, audit output, lock, or listener was created.

- [ ] **Step 8: Run the full reviewer verification**

```powershell
npm.cmd run test:template-reviewer
npx.cmd playwright test tests/e2e/template-visual-metadata-reviewer.spec.ts --project=chromium
npm.cmd run typecheck
git diff --check
```

Expected: all commands PASS. Full-repository DB integration failures remain outside this plan; do not claim the full repository suite passed unless it was actually run with its required database.

- [ ] **Step 9: Commit Task 7**

```powershell
git add tests/e2e/template-visual-metadata-reviewer.spec.ts tests/e2e/template-visual-metadata-reviewer.spec.ts-snapshots docs/operations/template-visual-metadata-review.md
git commit -m "test(templates): verify metadata reviewer workflow"
```

---

## Completion and Handoff

After all seven task reviews and the whole-branch review are clean:

1. Launch the local reviewer with the real artifact and the user-approved reviewer identity supplied through local runtime configuration.
2. Hand control to the human reviewer. AI agents must not make or simulate the 440 human decisions.
3. After the human finishes, validate both exported files structurally and report coverage.
4. Import only after separate explicit human authorization.
5. Return to Task 4 Step 10 of `2026-08-03-openlen-generation-foundation-safe-selection.md`, then continue Tasks 5–10 of that foundation plan.
