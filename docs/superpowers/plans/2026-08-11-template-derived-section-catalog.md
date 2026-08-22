# Template-Derived Section Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn OpenLen's 451 published templates into a verified, semantically searchable section catalog and use bounded per-section generation only when no compatible donor exists.

**Architecture:** A read-only offline compiler extracts top-level bands from authoritative template HTML, scopes their dependencies, validates and deduplicates them, then atomically publishes provenance-bearing fragments. Runtime selection uses hard semantic exclusions and donor-diversity rules; an absent role is fulfilled from a strict component specification rendered by OpenLen, never from model-authored HTML or a whole-template fallback.

**Tech Stack:** TypeScript, Vitest, Zod, Drizzle/Postgres, existing template object storage, `node-html-parser`, PostCSS section scoping, existing Rust-backed HTML/image engines, Playwright render checks, Google Gemini through the existing provider boundary only for authorized per-section fallback/canary.

## Global Constraints

- Exactly five tasks; release blockers are fixed inside the task that exposes them, while optional hardening is deferred.
- Source templates are read-only and AI hybrid creation never loads or clones a complete template at runtime.
- Catalog compilation makes no Gemini, asset-provider, project, credit, or user-data calls.
- Only `status === "published"` templates with canonical storage key and matching authoritative bytes enter the corpus.
- No raw HTML, copy, prompt, URL, credential, reviewer identity, or private metadata enters reports or operational telemetry.
- Every published fragment passes grammar, sanitizer, scoped-CSS, desktop/mobile render, geometry, mobile-overflow, asset, and content-hash gates.
- A forbidden semantic candidate is ineligible; it cannot win as the least-incompatible result.
- Normal delivery uses at least three distinct content hashes from at least three source templates, at most two content bands from one source, and never reconstructs a source template's original ordered bands.
- A missing role generates only a strict section specification and OpenLen renders the HTML deterministically; invalid generation returns a typed atomic failure.
- Existing copy, design-token, assets, 2C repair, credits, persistence, explicit-template clone, and delivery invariants remain unchanged.
- No paid/live canary runs without a new explicit authorization at Task 5.

---

## File Structure

### Corpus and extraction

- `lib/generation/template-section-corpus.ts`: canonical 451-row corpus manifest and authoritative byte verification.
- `lib/generation/template-section-extractor.ts`: pure HTML band extraction and dependency discovery.
- Matching `.test.ts` files: strict RED/GREEN coverage without DB or network.

### Compilation and publication

- `lib/generation/derived-section-contracts.ts`: strict provenance, semantic metadata, candidate, report, and catalog-manifest schemas.
- `lib/generation/derived-section-compiler.ts`: scope, lint, sanitize, render-check orchestration, classification, and deduplication.
- `lib/sections/store.ts` and `lib/db/schema.ts`: persist optional derived provenance without changing manual section behavior.
- `scripts/sections-derived-migrate.ts`: idempotent provenance-column migration.
- `scripts/sections-compile-templates.ts`: dry-run/report/publish CLI with injected boundaries and atomic publication.
- `scripts/build-migrations.mjs` and `package.json`: deployable migration and deterministic catalog command.

### Retrieval and composition

- `lib/generation/section-inventory.ts`: include trusted provenance/semantics and enforce donor diversity.
- `lib/generation/section-composition-contracts.ts`: manifest v2 provenance arrays and typed retrieval failures.
- `lib/generation/section-variant-semantics.ts`: consume closed derived semantics instead of guessing IDs.
- `lib/generation/compose-sections.ts`: enforce originality after final adaptation.

### Missing-section fallback

- `lib/generation/generated-section-contracts.ts`: strict component vocabulary and provider response.
- `lib/generation/generate-missing-section.ts`: provider boundary, deterministic renderer, compiler validation.
- `lib/generation/gemini-section-spec-provider.ts`: existing REST `generateContent` pattern with one call/no retry and safe usage.
- `lib/curate/quick-section-composition.ts` and `lib/curate/run-ai-creation.ts`: invoke fallback only for missing compatible roles.

### Acceptance and operations

- `lib/generation/template-derived-niche-cohort.ts`: six deterministic niche fixtures and forbidden structures.
- `scripts/template-derived-sections-canary.ts`: separately authorized bounded live runner.
- `docs/generation/template-derived-sections-runbook.md`: compile, publish, canary, rollback, privacy, and incident steps.
- `infra/scripts/deploy.ps1` and `package.json`: mandatory pre-build catalog gates.

---

### Task 1: Authoritative Corpus and Deterministic Extraction

**Files:**
- Create: `lib/generation/template-section-corpus.ts`
- Create: `lib/generation/template-section-corpus.test.ts`
- Create: `lib/generation/template-section-extractor.ts`
- Create: `lib/generation/template-section-extractor.test.ts`

**Interfaces:**
- Consumes: `TemplateRecord` from `lib/templates/store.ts`; injected `fetchText(storageUrl)`.
- Produces:

```ts
export interface TemplateCorpusRow {
  templateId: string;
  templateContentHash: string;
  storageKey: string;
  storageUrl: string;
  mode: "light" | "dark" | "cream";
  visualMetadata: TemplateVisualMetadata | null;
  html: string;
}

export interface TemplateCorpusManifest {
  schemaVersion: "template-section-corpus/1.0";
  expectedCount: 451;
  rows: readonly TemplateCorpusRow[];
  manifestHash: `sha256:${string}`;
}

export interface ExtractedTemplateBand {
  templateId: string;
  templateContentHash: string;
  ordinal: number;
  rootTag: "nav" | "header" | "section" | "footer";
  sourceHtml: string;
  sourceHash: `sha256:${string}`;
  sourceIds: readonly string[];
}

export function buildTemplateCorpus(
  records: readonly TemplateRecord[],
  deps: { fetchText(url: string): Promise<string | null> },
): Promise<TemplateCorpusManifest>;

export function extractTemplateBands(row: TemplateCorpusRow):
  | { ok: true; bands: readonly ExtractedTemplateBand[] }
  | { ok: false; code: "invalid_template_document" | "no_extractable_bands" };
```

- [ ] **Step 1: Write corpus RED tests**

Add fixtures proving: exactly 451 unique published IDs are required; draft/archived rows are rejected rather than filtered silently; key must equal `templates/<id>-<12hex>.html`; fetched bytes must hash to `contentHash`; fetch failure, duplicates, unexpected count, stale bytes, and noncanonical IDs return typed `TemplateCorpusError`; output ordering and manifest hash are deterministic; no HTML appears in the serializable report projection.

```ts
await expect(buildTemplateCorpus(rows451, { fetchText })).resolves.toMatchObject({
  schemaVersion: "template-section-corpus/1.0",
  expectedCount: 451,
  rows: expect.arrayContaining([expect.objectContaining({ templateId: "arcana" })]),
});
await expect(buildTemplateCorpus([...rows451.slice(0, 450)], { fetchText }))
  .rejects.toMatchObject({ code: "template_corpus_count_mismatch" });
```

- [ ] **Step 2: Run corpus RED**

Run: `npm.cmd test -- lib/generation/template-section-corpus.test.ts`

Expected: FAIL because `template-section-corpus.ts` does not exist.

- [ ] **Step 3: Implement corpus verification**

Use `canonicalJsonSha256` for the manifest, `createHash("sha256")` for authoritative HTML bytes, `Promise.all` for fetches, and a final all-rows barrier before returning any manifest. Preserve HTML only in the in-memory row; expose a separate `redactTemplateCorpusManifest()` containing IDs/hashes/counts only.

- [ ] **Step 4: Run corpus GREEN**

Run: `npm.cmd test -- lib/generation/template-section-corpus.test.ts`

Expected: all corpus tests PASS.

- [ ] **Step 5: Write extractor RED tests**

Cover nested sections, quoted `>` attributes, comments, script/style raw text, SVG/MathML foreign content, top-level `nav/header/section/footer`, document text between bands, duplicate IDs, `<html>` disguised inside raw text, a nested full page, unbalanced markup, and empty documents. Assert only top-level page bands are emitted and ordinals preserve source order.

```ts
const result = extractTemplateBands(corpusRow(`
  <!doctype html><html><head><style>.hero{color:red}</style></head><body>
  <header id="nav"><nav>Menu</nav></header>
  <section id="hero"><section>Nested card</section></section>
  <footer id="end">End</footer></body></html>`));
expect(result).toMatchObject({ ok: true, bands: [
  { ordinal: 0, rootTag: "header" },
  { ordinal: 1, rootTag: "section" },
  { ordinal: 2, rootTag: "footer" },
] });
```

- [ ] **Step 6: Run extractor RED**

Run: `npm.cmd test -- lib/generation/template-section-extractor.test.ts`

Expected: FAIL because extractor exports do not exist.

- [ ] **Step 7: Implement deterministic extraction**

Build an index-preserving scanner over original bytes; do not lowercase the document or use regex to balance HTML. Track HTML/SVG/MathML namespaces and raw-text/RCDATA elements. Extract exact byte ranges for top-level bands plus the document head needed later by the compiler. Reject full-page elements inside a band and duplicate source IDs.

- [ ] **Step 8: Verify Task 1**

Run:

```powershell
npm.cmd test -- lib/generation/template-section-corpus.test.ts lib/generation/template-section-extractor.test.ts
npm.cmd run typecheck
git -c safe.directory=C:/Users/jesus/Desktop/inari-pages diff --check
```

Expected: tests and typecheck PASS; diff check has no output.

- [ ] **Step 9: Commit Task 1**

```powershell
git add lib/generation/template-section-corpus.ts lib/generation/template-section-corpus.test.ts lib/generation/template-section-extractor.ts lib/generation/template-section-extractor.test.ts
git commit -m "feat(generation): extract verified template sections"
```

---

### Task 2: Compile, Validate, Deduplicate, and Publish the Catalog

**Files:**
- Create: `lib/generation/derived-section-contracts.ts`
- Create: `lib/generation/derived-section-contracts.test.ts`
- Create: `lib/generation/derived-section-compiler.ts`
- Create: `lib/generation/derived-section-compiler.test.ts`
- Create: `scripts/sections-derived-migrate.ts`
- Create: `scripts/sections-compile-templates.ts`
- Create: `lib/generation/sections-compile-templates-cli.test.ts`
- Modify: `lib/db/schema.ts:582-620`
- Modify: `lib/sections/store.ts`
- Modify: `scripts/build-migrations.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `ExtractedTemplateBand[]`, `scopeSectionDocument`, `CreateSectionSchema`, `lintContract`, existing sanitizer/fingerprint/asset inventory, injected render validator, `upsertSection`.
- Produces:

```ts
export const DerivedSectionProvenanceSchema = z.object({
  schemaVersion: z.literal("derived-section-provenance/1.0"),
  sourceTemplateId: z.string().regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/),
  sourceTemplateHash: z.string().regex(/^[a-f0-9]{12}$/),
  sourceBandOrdinal: z.number().int().min(0).max(127),
  extractionVersion: z.literal("template-band-extractor/1.0"),
  sourceHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  structuralFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
}).strict();

export const DerivedSectionSemanticsSchema = z.object({
  role: z.enum(SECTION_TYPES),
  layoutArchetypes: z.array(DerivedLayoutArchetypeSchema).max(8),
  domains: z.array(DerivedDomainSchema).max(12),
  audiences: z.array(DerivedAudienceSchema).max(8),
  moods: z.array(DerivedMoodSchema).max(8),
  negativeSignals: z.array(SectionSemanticTagSchema).max(16),
}).strict();

export interface CompiledDerivedSection {
  id: string;
  html: string;
  type: SectionType;
  mode: SectionMode;
  provenance: DerivedSectionProvenance;
  semantics: DerivedSectionSemantics;
  designTokens: Record<string, string>;
  fonts: string[];
  needsJs: boolean;
  hasPlaceholders: boolean;
  contentHash: string;
}

export async function compileDerivedSection(
  band: ExtractedTemplateBand,
  context: { templateHead: string; metadata: TemplateVisualMetadata | null },
  deps: { validateRender(input: RenderValidationInput): Promise<RenderValidationResult> },
): Promise<CompileDerivedSectionResult>;

export function dedupeDerivedSections(rows: readonly CompiledDerivedSection[]): {
  accepted: readonly CompiledDerivedSection[];
  duplicates: readonly { rejectedId: string; representativeId: string; reason: "exact" | "structural" }[];
};
```

- [ ] **Step 1: Write strict contract RED tests**

Reject unknown keys, raw HTML, URLs, copy, prompts, unbounded arrays, unknown taxonomy values, unsafe integers, invalid hashes, and incomplete provenance. Prove the redacted catalog report contains only counts, IDs, hashes, rejection codes, and coverage buckets.

- [ ] **Step 2: Run contract RED**

Run: `npm.cmd test -- lib/generation/derived-section-contracts.test.ts`

Expected: missing module failure.

- [ ] **Step 3: Implement closed schemas and report contracts**

Define every taxonomy as a Zod enum in this module; do not accept free-form model labels. Include rejection codes for `dependency_unavailable`, `invalid_fragment`, `unsafe_script`, `contract_violation`, `sanitize_mismatch`, `asset_invalid`, `render_failed`, `mobile_overflow`, `empty_geometry`, `ambiguous_semantics`, `exact_duplicate`, and `structural_duplicate`.

- [ ] **Step 4: Write compiler RED tests**

Fixtures must prove CSS dependency extraction, font hoisting, selector/keyframe scoping, ID/href rewriting, safe local assets, rejection of global leakage, unsafe scripts/forms, missing CSS variables, nested full pages, structural changes after sanitization, desktop/mobile overflow, zero-size geometry, undecodable images, ambiguous role, exact duplicates, near-identical structures, and deterministic IDs `derived-<type>-<template>-<ordinal>-<12hash>`.

Inject render results; unit tests do not open a browser.

- [ ] **Step 5: Run compiler RED**

Run: `npm.cmd test -- lib/generation/derived-section-compiler.test.ts`

Expected: missing compiler exports.

- [ ] **Step 6: Implement compilation and deduplication**

Build a temporary standalone document from the source head plus one band, pass it to `scopeSectionDocument`, then validate the resulting fragment through existing contracts. Derive semantics from trusted template visual metadata, structural features, and a closed visible-token map. Return `ambiguous_semantics` when role/domain cannot be determined. Deduplicate first by full content hash and then by structural fingerprint; stable winner order is render score descending, then source template ID, ordinal, and ID.

- [ ] **Step 7: Add provenance persistence RED tests**

Extend store tests to prove manual rows keep `provenance: null` and `derivedSemantics: null`, derived rows require both fields, JSON is strict-parsed on read/write, and archival updates only matching derived rows from an obsolete manifest.

- [ ] **Step 8: Implement idempotent migration and store changes**

Add nullable JSONB columns `provenance` and `derivedSemantics`, plus index `sections_derived_source_idx` over `((provenance->>'sourceTemplateId'))` where provenance is not null. `sections-derived-migrate.ts` must use `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, and no destructive DDL. Add the migrator to `build-migrations.mjs` after existing section/table availability.

- [ ] **Step 9: Write CLI RED tests**

Inject `listTemplates`, `fetchText`, `compile`, `writeReportAtomic`, `upsert`, and `archiveObsolete`. Assert: `--dry-run` performs zero DB/storage writes; the report is written before any publish; any corpus/compiler/report failure performs zero publish writes; publish waits for all candidates; existing catalog remains live until barrier success; rerun is idempotent; only obsolete derived rows are archived; raw inputs never enter report/stdout.

- [ ] **Step 10: Implement compile/publish CLI**

Add package scripts:

```json
"sections:compile-templates": "tsx --env-file=.env.local --tsconfig tsconfig.eval.json --require ./scripts/test-node-server-only-shim.cjs scripts/sections-compile-templates.ts",
"sections:derived-migrate": "tsx --env-file=.env.local --tsconfig tsconfig.eval.json scripts/sections-derived-migrate.ts"
```

CLI flags are exactly `--dry-run`, `--publish`, and `--expected-count=451`; absence of dry-run/publish is an error. Write the redacted manifest/report atomically under ignored `scratch/visual-engine-derived-sections/`.

- [ ] **Step 11: Verify Task 2**

Run:

```powershell
npm.cmd test -- lib/generation/derived-section-contracts.test.ts lib/generation/derived-section-compiler.test.ts lib/generation/sections-compile-templates-cli.test.ts
npm.cmd run typecheck
git -c safe.directory=C:/Users/jesus/Desktop/inari-pages diff --check
```

Expected: all PASS. Do not run `--publish` or a migration against a real DB in this task.

- [ ] **Step 12: Commit Task 2**

Stage only the Task 2 files and commit:

```powershell
git commit -m "feat(generation): compile template-derived section catalog"
```

---

### Task 3: Strict Semantic Retrieval and Clone Prevention

**Files:**
- Modify: `lib/generation/section-composition-contracts.ts`
- Modify: `lib/generation/section-composition-contracts.test.ts`
- Modify: `lib/generation/section-inventory.ts`
- Modify: `lib/generation/section-inventory.test.ts`
- Modify: `lib/generation/section-variant-semantics.ts`
- Modify: `lib/generation/section-variant-semantics.test.ts`
- Modify: `lib/generation/compose-sections.ts`
- Modify: `lib/generation/compose-sections.test.ts`

**Interfaces:**
- Consumes: `SectionRecord.provenance`, `SectionRecord.derivedSemantics` from Task 2.
- Produces inventory v2 entries with `sourceTemplateId`, `sourceBandOrdinal`, `structuralFingerprint`, and trusted semantics; manifest v2 with aligned provenance arrays.

```ts
interface SectionCompositionInventoryEntryV2 extends SectionCompositionInventoryEntry {
  sourceKind: "manual" | "template_derived" | "generated";
  sourceTemplateId: string | null;
  sourceBandOrdinal: number | null;
  structuralFingerprint: `sha256:${string}`;
  derivedSemantics: DerivedSectionSemantics | null;
}
```

- [ ] **Step 1: Write inventory v2 RED tests**

Assert strict parsing of provenance, stable inventory hash changes when provenance/semantics change, manual-row compatibility, hard rejection of forbidden signals, and typed `section_semantic_coverage_failed` when a required role has candidates but none are compatible.

- [ ] **Step 2: Run inventory RED**

Run: `npm.cmd test -- lib/generation/section-inventory.test.ts lib/generation/section-variant-semantics.test.ts`

Expected: failures for absent provenance-aware behavior.

- [ ] **Step 3: Implement provenance-aware ranking**

Use derived semantics directly when present. Legacy/manual rows continue through the reviewed closed semantic profiler. Filter forbidden candidates before visual scoring. If a role has no positive or neutral compatible candidate, throw `section_semantic_coverage_failed`; do not return the least-negative row.

- [ ] **Step 4: Write donor-diversity RED tests**

Build plans where the highest-scoring sections all originate from one template. Assert the resolver backtracks deterministically to satisfy: three unique hashes, three source templates, max two bands per source, and no source's original contiguous three-band sequence. Also assert fewer than three page bands fails `section_originality_failed` rather than weakening the rule.

- [ ] **Step 5: Implement constrained deterministic selection**

For at most 32 rows, construct per-role ranked candidate lists and perform bounded depth-first selection with stable ordering. Stop after 4096 explored states; exhaustion returns `section_originality_failed`. Navbar/footer manual sections may count as unique fragments but do not reduce the three-template content-band requirement.

- [ ] **Step 6: Extend manifest and final originality gate**

Add aligned `selectedSourceTemplateIds`, `selectedSourceBandOrdinals`, and `selectedStructuralFingerprints`. After adaptation/2C, verify exact role order and manifest provenance, three unique hashes/templates, max-two donor use, and absence of an original contiguous sequence. Failure returns no HTML and `section_originality_failed`.

- [ ] **Step 7: Add adversarial clone tests**

Reject: a full template disguised as one fragment; three IDs sharing one hash; three hashes from one donor; bands 2/3/4 from one donor in original order; altered provenance not covered by inventory hash; and a forbidden dashboard section with artificially strong visual score.

- [ ] **Step 8: Verify Task 3**

Run:

```powershell
npm.cmd test -- lib/generation/section-composition-contracts.test.ts lib/generation/section-variant-semantics.test.ts lib/generation/section-inventory.test.ts lib/generation/compose-sections.test.ts lib/curate/ai-composition-delivery.test.ts
npm.cmd run typecheck
git -c safe.directory=C:/Users/jesus/Desktop/inari-pages diff --check
```

- [ ] **Step 9: Commit Task 3**

```powershell
git commit -m "feat(generation): enforce diverse section donors"
```

---

### Task 4: Generate Only Missing Sections and Integrate Delivery

**Files:**
- Create: `lib/generation/generated-section-contracts.ts`
- Create: `lib/generation/generated-section-contracts.test.ts`
- Create: `lib/generation/generate-missing-section.ts`
- Create: `lib/generation/generate-missing-section.test.ts`
- Create: `lib/generation/gemini-section-spec-provider.ts`
- Create: `lib/generation/gemini-section-spec-provider.test.ts`
- Modify: `lib/generation/section-composition-contracts.ts`
- Modify: `lib/generation/section-inventory.ts`
- Modify: `lib/generation/compose-sections.ts`
- Modify: `lib/generation/compose-sections.test.ts`
- Modify: `lib/curate/quick-section-composition.ts`
- Modify: `lib/curate/quick-section-composition.test.ts`
- Modify: `lib/curate/run-ai-creation.ts`
- Modify: `lib/curate/run-ai-creation.test.ts`

**Interfaces:**
- Consumes: the missing `SectionPlanRow`, intent, creative direction, bounded page copy for that role, and asset intent boundary.
- Produces one compiler-ready fragment with `sourceKind: "generated"` or a typed failure.

```ts
const GeneratedSectionSpecSchema = z.object({
  schemaVersion: z.literal("generated-section-spec/1.0"),
  role: SectionPlanRowSchema.shape.requestedRole,
  layout: z.enum(["split", "centered", "grid", "editorial", "gallery", "timeline", "marquee", "stacked_cards"]),
  blocks: z.array(z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("heading"), copyKey: z.string().max(80) }).strict(),
    z.object({ kind: z.literal("body"), copyKey: z.string().max(80) }).strict(),
    z.object({ kind: z.literal("cards"), copyKeys: z.array(z.string().max(80)).min(2).max(8) }).strict(),
    z.object({ kind: z.literal("media"), slotIndex: z.number().int().min(0).max(11) }).strict(),
    z.object({ kind: z.literal("actions"), copyKeys: z.array(z.string().max(80)).min(1).max(2) }).strict(),
  ])).min(2).max(10),
  geometry: z.object({ density: z.enum(["airy", "balanced", "dense"]), emphasis: z.enum(["copy", "media", "balanced"]) }).strict(),
}).strict();

export async function generateMissingSection(input: GenerateMissingSectionInput, deps: {
  provider: GeneratedSectionSpecProvider;
  compileGenerated(section: GeneratedSectionDraft): Promise<CompileDerivedSectionResult>;
}): Promise<GeneratedSectionResult>;
```

- [ ] **Step 1: Write strict spec RED tests**

Reject HTML/CSS/JS/URLs, arbitrary text values, unknown layouts/blocks, duplicate media slots, missing copy keys, more than ten blocks, and unknown fields. Prove valid specs reference only supplied copy keys and asset slots.

- [ ] **Step 2: Implement contracts and deterministic renderer**

Renderer maps the closed spec to repository-owned HTML/CSS classes and tokens. It never interpolates a tag, selector, style property, URL, or raw model string. Copy is resolved by exact key and escaped; media becomes `data-openlen-asset-slot` placeholders.

- [ ] **Step 3: Write provider RED tests**

Cover no key, HTTP error, invalid JSON, invalid schema, future version, timeout through body parsing, usage on paid invalid responses, no usage before HTTP success, safe model-ID resolution, one request, and zero retries. Assert request payload contains only allowlisted intent/direction/role/copy-key names/asset-slot descriptors—not template catalog, HTML, private metadata, or full copy values.

- [ ] **Step 4: Implement Gemini spec provider**

Follow the existing `generateContent` REST boundary and response-envelope parser. Use a dedicated prompt version, strict response schema, one AbortController covering fetch and body parse, and safe usage extraction. No automatic retries.

- [ ] **Step 5: Write orchestration RED tests**

Assert provider is called only after retrieval returns `section_semantic_coverage_failed` or `section_fragment_unavailable`; never for stale inventory, invalid fragments, originality failures, off/disabled mode, or a compatible donor. The generated draft must pass the same compiler validation and then re-enter selection as one `sourceKind: "generated"` candidate. Any failure returns no partial HTML.

- [ ] **Step 6: Implement missing-section orchestration**

Allow at most two generated roles per page and one call per missing role. Re-run the complete donor-diversity/originality gate after insertion. Generated sections count as distinct sources using `generated:<specHash>` but cannot reduce the requirement for at least two real template donors.

- [ ] **Step 7: Integrate Quick and AI creation**

Pass the provider only when `OPENLEN_AI_CREATION=enabled`. Preserve existing progress events, credits, one project ID, asset trace sink, 2C repair, final preview, and atomic persistence. Add `generatedSectionCount` and safe usage/cost only to redacted operational metadata.

- [ ] **Step 8: Verify Task 4**

Run:

```powershell
npm.cmd test -- lib/generation/generated-section-contracts.test.ts lib/generation/gemini-section-spec-provider.test.ts lib/generation/generate-missing-section.test.ts lib/generation/compose-sections.test.ts lib/curate/quick-section-composition.test.ts lib/curate/run-ai-creation.test.ts lib/curate/curate-route.integration.test.ts
npm.cmd run typecheck
npm.cmd run generation:visual-engine-assets:gate
git -c safe.directory=C:/Users/jesus/Desktop/inari-pages diff --check
```

- [ ] **Step 9: Commit Task 4**

```powershell
git commit -m "feat(generation): generate only missing page sections"
```

---

### Task 5: Six-Niche Acceptance, Operations, and Rollout

**Files:**
- Create: `lib/generation/template-derived-niche-cohort.ts`
- Create: `lib/generation/template-derived-niche-cohort.test.ts`
- Create: `lib/generation/template-derived-release-gate.test.ts`
- Create: `scripts/template-derived-sections-canary.ts`
- Create: `lib/generation/template-derived-sections-canary.test.ts`
- Create: `docs/generation/template-derived-sections-runbook.md`
- Modify: `package.json`
- Modify: `infra/scripts/deploy.ps1`
- Modify if genuine release failures require corrections: only files introduced or integrated in Tasks 1-4, with the failure and scope recorded in the Task 5 report.

**Interfaces:**
- Consumes: Tasks 1-4 catalog compiler, retrieval, fallback, and existing AI delivery pipeline.
- Produces: deterministic release gate, separately authorized canary, rollback contract, and deployment enforcement.

- [ ] **Step 1: Define the six-fixture cohort**

Create exact fixtures for:

1. Mundo Pincel / children's coloring and creativity;
2. atmospheric horror entertainment without generic game UI;
3. warm school/community site without course dashboard;
4. editorial cooking/recipes without ecommerce or wellness dashboard;
5. boutique hotel/hospitality without SaaS booking dashboard;
6. physical product sales without software mockups.

Each fixture declares required roles, positive semantic families, forbidden signals, required asset media, and expected donor diversity.

- [ ] **Step 2: Write deterministic acceptance RED tests**

For all six fixtures, assert: no forbidden semantics; required roles covered; at least three distinct hashes and three sources; no donor over two bands; no contiguous source reconstruction; no inherited donor copy; assets resolved or typed; final role markers exact; mobile overflow/typography/geometry gates pass. Mundo Pincel additionally requires `playful`, `illustrated`, `creator`, or equivalent derived semantics in hero plus two content bands and rejects dashboard/course/game UI.

- [ ] **Step 3: Add the release gate command**

Add `generation:template-derived-sections:gate` containing the new suites plus corpus/extractor/compiler/contracts, section inventory/composition, generated-section provider, AI creation, assets gate dependencies, and explicit-clone boundary. A contract test parses the command and proves every required file appears exactly once.

- [ ] **Step 4: Write canary RED tests**

Runner requires: explicit `--live`, `OPENLEN_AI_CREATION=enabled`, exact compiled catalog manifest hash, current authoritative template HEAD, positive integer MXN cap, all six deterministic preflights, DB availability, Gemini key, no retry, one sequential request per fixture, and a final all-results report. Any failed preflight makes zero provider calls and zero reservations. Output/report is redacted.

- [ ] **Step 5: Implement bounded canary and scorecard**

Use existing cost helpers and pilot ledger patterns. Stop before the next fixture when observed plus reserved worst-case cost would exceed the cap. Technical or visual failure remains in the six-case denominator. The canary does not publish projects or expose HTML/screenshots in the report.

- [ ] **Step 6: Write the runbook**

Document exact commands for migration, dry compile, report review, atomic publish, deterministic gates, separately authorized canary, activation, rollback to the prior catalog manifest, archiving derived rows, privacy audit, cost accounting, and incident reasons. State explicitly that source templates are unchanged and explicit cloning is separate.

- [ ] **Step 7: Enforce deploy ordering**

Place `npm.cmd run generation:template-derived-sections:gate`, assets gate, and typecheck before the first `OPENLEN_SKIP_BUILD` conditional in `infra/scripts/deploy.ps1`. Contract tests inspect control-flow ordering so `OPENLEN_SKIP_BUILD=1` cannot skip release gates.

- [ ] **Step 8: Run the complete non-live release sequence once**

```powershell
npm.cmd run generation:template-derived-sections:gate
npm.cmd run generation:ai-hybrid:gate
npm.cmd run generation:visual-engine-assets:gate
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
git -c safe.directory=C:/Users/jesus/Desktop/inari-pages diff --check
```

Do not restart a long-running full suite. Record environmental DB/native-module failures separately and fix only reproducible product failures.

- [ ] **Step 9: Review and publish the compiled catalog**

Run dry mode first against the authorized environment. Verify exact 451-row corpus, accepted/rejected/deduplicated counts, semantic coverage for all six niches, no sensitive report fields, and stable manifest twice. Only then run the idempotent migration and `--publish`; both operations require explicit user authorization because they mutate the current DB/storage.

- [ ] **Step 10: Run the real canary only after fresh authorization**

Request authorization stating exact six synthetic briefs, Gemini payload classes, current DB telemetry, maximum MXN, one request per fixture, and no retries. Without that authorization, stop with all non-live gates complete; do not infer it from implementation approval.

- [ ] **Step 11: Final visual review and deploy**

Review desktop/mobile evidence for all six pages; compare forbidden-signal and originality metadata; reject any generic least-bad fallback. After CLEAN independent review, commit Task 5, merge locally to `master`, push, run migration/catalog publication/deploy in approved order, and execute post-deploy smoke/rollback verification.

- [ ] **Step 12: Commit Task 5**

```powershell
git commit -m "test(generation): gate template-derived hybrid creation"
```

---

## Plan Self-Review

- **Spec coverage:** Task 1 covers the authoritative read-only corpus and extraction; Task 2 covers dependencies, validation, rendering, semantics, deduplication, provenance, reports, and atomic publication; Task 3 covers strict retrieval/diversity/clone prevention; Task 4 covers bounded missing-section generation and existing-engine integration; Task 5 covers six niches, operations, paid authorization boundary, deployment, and rollback.
- **No hidden phase:** migration, publication, canary, deployment, and post-deploy verification are inside Task 5. There is no Task 6.
- **No template clone path:** runtime interfaces consume `SectionRecord` and strict generated specs only. Template HTML is confined to Tasks 1-2 offline compilation.
- **No least-bad fallback:** Task 3 hard-fails semantic coverage; Task 4 handles only that typed absence.
- **Type consistency:** Task 1 outputs `ExtractedTemplateBand`; Task 2 consumes it and produces provenance-bearing `SectionRecord`s; Task 3 consumes those records and produces manifest v2; Task 4 adds `sourceKind: "generated"`; Task 5 consumes the same manifest and telemetry.
- **Placeholder scan:** no TBD/TODO/later/similar-step placeholders are present. Every test and implementation step names its behavior, files, command, and expected result.
