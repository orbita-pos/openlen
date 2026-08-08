# OpenLen Visual Engine 2A Pilot Cohort Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the invalid adversarial selector dataset used by the paid Visual Engine 2A pilot with a frozen 15-case, 75-row skeleton cohort, a deterministic non-live qualification gate, complete intent-token cost evidence, and an all-or-nothing live preflight that cannot reserve adaptations until every row passes.

**Architecture:** Keep the production selector, thresholds, reviewed metadata, skeleton compiler, Quick delivery, and final 2A acceptance gates unchanged. Add a versioned cohort module and pure qualification/preflight modules, then expose them through a read-only qualification CLI and the existing live evaluation CLI. Bind every live run to the cohort source, catalog, template HTML, inventory, code commit, and frozen model/rate versions with canonical hashes.

**Tech Stack:** TypeScript, Zod, Vitest, Drizzle/Postgres read paths, Node crypto/fs, existing OpenLen selector/compiler/ledger modules, Gemini 2.5 Flash through the existing intent provider, and the existing atomic JSON writer.

## Global Constraints

- The approved design is `docs/superpowers/specs/2026-08-08-openlen-visual-engine-2a-pilot-cohort-design.md`.
- Do not edit `SELECTOR_CASES`, `SELECTOR_HOLDOUT_CASES`, taxonomy mappings, `DEFAULT_THRESHOLDS`, reviewed template metadata, compiler behavior, Quick delivery, quota limits, or 2A scorecard thresholds.
- Do not execute Gemini, a paid preflight, a pilot adaptation, a database migration, a write query, a reviewer server, a deploy, or a flag change while implementing this plan.
- The previous authorization was consumed by the stopped 150-call preflight. A corrected paid run requires a new explicit user authorization after implementation and non-live qualification.
- Use TDD for every behavior change: write the focused failing test, record the expected failure, implement the minimum change, rerun focused tests, then run the stated regression gate.
- Preserve the existing ignored evidence boundary `scratch/visual-engine-2a/**`; never stage `.env*`, evidence images, manifests, review sessions, scorecards, raw prompts/responses, local paths, reviewer identity, or the five pre-existing selector scratch JSON files.
- Use the repository Node shim for any direct `tsx` command that reaches server-only imports: `--require ./scripts/test-node-server-only-shim.cjs`.
- All errors written to reports or logs are typed allowlisted codes; never serialize raw provider, database, storage, or filesystem errors.

---

## Task 1: Add the frozen 15-case cohort contract and source data

**Files:**

- Create: `lib/generation/visual-engine-2a-cohort.ts`
- Create: `lib/generation/visual-engine-2a-cohort.test.ts`

### Cohort source of truth

Use dataset version `visual-engine-2a-cohort/1.0` and these exact base-case assignments. Each allowlist starts with one reviewed high-themeability template, so the selector is audited rather than forced and the cohort begins with 15 distinct structural sources.

| Case ID | Archetype | Lang/length | Brief intent | Site type | Required sections | Primary audience | Domains | Allowed IDs |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `creative-club-es` | children_creative | es/short | Club infantil presencial de arte con sesiones, galería y registro familiar; identity: cut-paper, crayon, joyful primary colors | `business` | hero, about, services, gallery, contact | children | education, creative_play | `rompiente` |
| `printable-library-en` | children_creative | en/medium | Parent-facing printable activity collection with themed packs, program explanation, FAQ, and download CTA; identity: pastel sticker-book | `educational_resource` | hero, about, programs, call_to_action, faq, footer | parents | education, creative_play | `lantern` |
| `teacher-art-hub-en` | children_creative | en/detailed | Creator hub for an art educator with profile, resource links, featured projects, events, and social links; identity: classroom collage without course-progress UI | `creator_hub` | header, profile_summary, link_list, featured_content, social_links, footer | educators | education, creative_play | `enlace` |
| `taqueria-pop-es` | restaurant_hospitality | es/short | Taquería neighborhood site with menu, gallery, reservations, and contact; identity: vivid papel-picado pop | `restaurant` | hero, about, menu, gallery, reservations, contact, footer | consumers | food_beverage, hospitality | `mesa` |
| `bakery-morning-en` | restaurant_hospitality | en/medium | Bakery/café presence with story, menu, gallery, reviews, location, and order CTA; identity: bright risograph morning market | `business` | hero, about, menu, gallery, testimonials, contact, call_to_action, footer | consumers | food_beverage, hospitality | `cafe-tramonto` |
| `botanical-winebar-es` | restaurant_hospitality | es/detailed | Daytime botanical wine bar with menu, events, reservation, origin story, and contact; identity: airy garden editorial, explicitly not dark nightlife | `restaurant_website` | hero, about, menu, events, reservations, contact, footer | consumers | food_beverage, hospitality | `tanino` |
| `breathwork-studio-en` | wellness | en/short | Breathwork studio with services, pricing, team, and booking; identity: energetic cobalt/coral geometry | `small_business` | hero, about, services, team, pricing, contact | adults | wellness | `aire-estudio` |
| `sleep-community-es` | wellness | es/medium | Comunidad de descanso con prácticas, calendario, membresía, testimonios y contacto; identity: dreamy midnight sky and soft constellations | `community_hub` | hero, about, services, schedule, pricing, testimonials, contact | adults | wellness, health | `loto` |
| `prenatal-movement-en` | wellness | en/detailed | Inclusive prenatal/postnatal movement studio with instructors, schedule, memberships, FAQ, testimonials, and contact; identity: cheerful editorial color blocks | `business` | hero, about, services, team, pricing, testimonials, contact, faq, schedule | adults | wellness, fitness | `poise` |
| `retro-cli-es` | technical_saas | es/short | Documentación de una CLI para equipos de desarrollo; identity: retro technical manual with orange ink, not a terminal clone | `documentation_site` | hero, features, how_it_works, testimonials, pricing, faq, footer | developers | developer_tools, software_development | `codex` |
| `component-cloud-en` | technical_saas | en/medium | SaaS component delivery platform with workflow, features, pricing, social proof, FAQ, and CTA; identity: expressive modular shapes and electric lime | `saas_product_page` | hero, features, how_it_works, pricing, testimonials, faq, call_to_action, footer | developers | developer_tools, saas | `pavilion` |
| `open-source-observability-es` | technical_saas | es/detailed | Open-source observability product landing page with capabilities, workflow, proof, and contribution CTA; identity: constructivist print system in red/cream/black | `product_landing_page` | hero, features, how_it_works, testimonials, call_to_action, footer | developers | developer_tools, open_source | `brasa` |
| `color-photographer-es` | editorial_portfolio | es/short | Portafolio de fotógrafa cultural con proyectos, bio, testimonios y contacto; identity: saturated duotone and playful captions | `portfolio` | hero, gallery, about, testimonials, contact | creative_clients | portfolio, photography | `margot-rey` |
| `literary-newsletter-en` | editorial_portfolio | en/medium | Literary newsletter/blog with issue list, membership CTA, author header, and footer; identity: maximal collage and marginalia | `blog` | header, call_to_action, content_list, footer | readers | editorial, publishing | `inkwell` |
| `friendly-design-portfolio-es` | editorial_portfolio | es/detailed | Portfolio de estudio de diseño con presentación, enfoque, clientes y contacto; identity: handmade shapes, warm color, approachable voice | `portfolio` | hero, about, clients, contact | creative_clients | portfolio, illustration | `marquee` |

For every case, set `expectedIntent.schemaVersion = "intent-analysis/1.0"`, use the language shown, copy `requiredVisualSignals` and `forbiddenVisualSignals` into `expectedIntent`, use empty `explicitConstraints` unless the brief states one, use empty `ambiguities`, and set `confidence: 0.95`. Use these canonical forbidden profiles: children = `saas_dashboard`, `course_progress_ui`, `corporate_photography`; restaurant = `developer_terminal`, `course_progress_ui`; wellness = `gaming_esports`, `corporate_dashboard`; technical SaaS = `children_toy_ui`, `wellness_organic`; editorial portfolio = `saas_dashboard`, `course_progress_ui`. Set `ageRange` only where explicit: `6_12`, `5_10`, and `18_plus` for the three child cases respectively; use `null` elsewhere.

Use `identityConflict` to name the retained section pattern, the actual baseline identity from reviewed metadata, and the requested identity in the table. `structuralRationale` must identify the exact retained roles and explain why no role change is required. Do not claim that the complex coloring/minigames/stories platform belongs to 2A.

- [ ] **Step 1: Write the RED contract tests**

Add tests that parse every row with a strict Zod schema and assert: 15 unique IDs; exact version; 3 cases per archetype; 8 Spanish/7 English; one short/medium/detailed brief per archetype; nonempty unique allowlists; exactly the table mappings; expected intent and top-level signals agree; and deep mutation attempts fail or cannot alter exported data.

- [ ] **Step 2: Run the focused test and record RED**

Run: `npm test -- lib/generation/visual-engine-2a-cohort.test.ts`

Expected: FAIL because the cohort module does not exist.

- [ ] **Step 3: Implement the strict contract and frozen data**

Export:

```ts
export const VISUAL_ENGINE_2A_DATASET_VERSION = "visual-engine-2a-cohort/1.0" as const;
export const VisualEngine2APilotCaseSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  datasetVersion: z.literal(VISUAL_ENGINE_2A_DATASET_VERSION),
  archetype: z.enum([
    "children_creative", "restaurant_hospitality", "wellness",
    "technical_saas", "editorial_portfolio",
  ]),
  language: z.enum(["es", "en"]),
  briefLength: z.enum(["short", "medium", "detailed"]),
  brief: z.string().min(1).max(2_000),
  expectedIntent: IntentAnalysisSchema,
  allowedSkeletonTemplateIds: z.array(z.string().min(1)).min(1),
  identityConflict: z.object({
    structuralPattern: z.string().min(1).max(500),
    baselineIdentity: z.string().min(1).max(500),
    requestedIdentity: z.string().min(1).max(500),
  }).strict(),
  requiredVisualSignals: z.array(TaxonomySlugSchema).min(1),
  forbiddenVisualSignals: z.array(TaxonomySlugSchema).min(1),
  structuralRationale: z.string().min(1).max(1_000),
}).strict();
export type VisualEngine2APilotCase = z.infer<typeof VisualEngine2APilotCaseSchema>;
export const VISUAL_ENGINE_2A_PILOT_CASES: readonly VisualEngine2APilotCase[] = deepFreeze(
  VisualEngine2APilotCaseSchema.array().length(15).parse(COHORT_ROWS),
);
```

`COHORT_ROWS` is a module-private literal containing exactly the 15 fully populated rows from the table and the intent rules above; it is not loaded or generated at runtime.

- [ ] **Step 4: Run focused GREEN and regression**

Run:

```powershell
npm test -- lib/generation/visual-engine-2a-cohort.test.ts lib/generation/selector-cases.test.ts lib/generation/selector-holdout-cases.test.ts
npm run typecheck
```

Expected: all pass; selector datasets remain byte-for-byte unchanged in `git diff`.

- [ ] **Step 5: Commit**

```powershell
git add lib/generation/visual-engine-2a-cohort.ts lib/generation/visual-engine-2a-cohort.test.ts
git commit -m "test(generation): define Visual Engine 2A cohort"
```

---

## Task 2: Build the pure cohort validator and canonical qualification manifest

**Files:**

- Create: `lib/generation/visual-engine-2a-qualification.ts`
- Create: `lib/generation/visual-engine-2a-qualification.test.ts`
- Modify: `lib/generation/visual-engine-2a-eval.ts`
- Modify: `lib/generation/visual-engine-2a-eval.test.ts`

- [ ] **Step 1: Write RED tests for source validation and sensitive-content rejection**

Test exact cardinality/distribution plus rejection of duplicate IDs, wrong version, altered language counts, empty/duplicate allowlists, `<script>`/HTML, email addresses, URLs with credentials, API-key patterns, private-key markers, and absolute Windows/POSIX paths in every prose field.

- [ ] **Step 2: Write RED tests for deterministic qualification**

Build pure fixtures containing metadata, HTML, inventory, and status. Assert qualification fails for unpublished/unreviewed/non-high-themeability templates, hard filters, route other than `template_skeleton`, choice outside allowlist, structural fit below `0.75`, identity fit at/above `0.80`, adaptation cost above `0.60`, invalid inventory, fewer than 10 selected templates, or more than 2 base cases per selected template. Assert no threshold argument exists in the public API.

- [ ] **Step 3: Write RED tests for canonical hashing and staleness**

The manifest must contain only versions/counts/IDs and SHA-256 hashes. Changing one byte of cohort source, metadata, HTML, inventory, template status, catalog membership, prompt/policy/taxonomy version, or commit must invalidate it. Object key order must not change the hash.

- [ ] **Step 4: Run RED**

Run: `npm test -- lib/generation/visual-engine-2a-qualification.test.ts lib/generation/visual-engine-2a-eval.test.ts`

Expected: FAIL on missing qualification exports and the old selector-case pool contract.

- [ ] **Step 5: Implement pure types and functions**

Export these contracts:

```ts
export interface VisualEngine2AQualifiedTemplate {
  id: string;
  metadataSha256: string;
  htmlSha256: string;
  inventorySha256: string;
}

export interface QualifiedCatalogTemplate {
  id: string;
  status: "published" | "draft" | "archived";
  visualMetadata: TemplateVisualMetadata | null;
  html: string;
  inventory: SkeletonInventory;
}

export type QualificationResult =
  | { ok: true; manifest: VisualEngine2AQualificationManifest }
  | { ok: false; code: QualificationFailureCode };

export interface VisualEngine2AQualificationManifest {
  schemaVersion: "visual-engine-2a-qualification/1.0";
  datasetVersion: typeof VISUAL_ENGINE_2A_DATASET_VERSION;
  datasetSha256: string;
  catalogSha256: string;
  commitSha: string;
  promptVersion: typeof INTENT_PROMPT_VERSION;
  policyVersion: typeof DECISION_POLICY_VERSION;
  taxonomyVersion: typeof TAXONOMY_COMPATIBILITY_VERSION;
  cases: readonly { caseId: string; selectedTemplateId: string; allowedTemplateIdsSha256: string }[];
  templates: readonly VisualEngine2AQualifiedTemplate[];
  baseCaseCount: 15;
  expandedRowCount: 75;
  manifestSha256: string;
}

export function qualifyVisualEngine2ACohort(args: {
  cases: readonly VisualEngine2APilotCase[];
  templates: readonly QualifiedCatalogTemplate[];
  commitSha: string;
}): QualificationResult;

export function verifyVisualEngine2AQualification(args: {
  manifest: unknown;
  current: Omit<VisualEngine2AQualificationManifest, "manifestSha256">;
}): { ok: true } | { ok: false; code: QualificationFailureCode };
```

Reuse `rankTemplates`, `decideGenerationRoute`, `buildSkeletonInventory`, and `canonicalJsonSha256`. Never duplicate scoring formulas or accept threshold overrides. Refactor `buildVisualEngine2APool` to accept `VisualEngine2APilotCase[]` and carry `datasetVersion`, `archetype`, and `allowedSkeletonTemplateIds` into every expanded row.

- [ ] **Step 6: Run GREEN and regression**

Run:

```powershell
npm test -- lib/generation/visual-engine-2a-qualification.test.ts lib/generation/visual-engine-2a-eval.test.ts lib/generation/score-template.test.ts lib/generation/decide-route.test.ts
npm run typecheck
git diff --check
```

- [ ] **Step 7: Commit**

```powershell
git add lib/generation/visual-engine-2a-qualification.ts lib/generation/visual-engine-2a-qualification.test.ts lib/generation/visual-engine-2a-eval.ts lib/generation/visual-engine-2a-eval.test.ts
git commit -m "feat(generation): qualify Visual Engine 2A cohort"
```

---

## Task 3: Add the non-live, read-only qualification CLI

**Files:**

- Create: `scripts/visual-engine-2a-qualify.ts`
- Create: `scripts/visual-engine-2a-qualify.test.ts`
- Modify: `package.json`
- Modify: `.gitignore`

- [ ] **Step 1: Write the RED CLI-boundary tests**

Inject catalog loading, HTML loading, commit lookup, and artifact writing. Assert the CLI does not accept/provider-load `GEMINI_API_KEY`, exposes no mutation/reservation dependency, reads only published templates, constructs inventory from fetched HTML, redacts raw errors, and writes exactly `scratch/visual-engine-2a/qualification.json` atomically.

- [ ] **Step 2: Run RED**

Run: `npm test -- scripts/visual-engine-2a-qualify.test.ts`

Expected: FAIL because the CLI does not exist.

- [ ] **Step 3: Implement the CLI and package command**

Add:

```json
"generation:visual-engine-2a:qualify": "tsx --env-file=.env.local --tsconfig tsconfig.eval.json --require ./scripts/test-node-server-only-shim.cjs scripts/visual-engine-2a-qualify.ts"
```

The implementation loads `listTemplates({status: "published"})`, fetches only the HTML of allowlisted IDs, builds inventories, obtains `git rev-parse HEAD` without a shell, calls the pure qualifier, and uses `writeJsonAtomic`. It logs one aggregate JSON line and exits nonzero on a typed failure. Keep `/scratch/visual-engine-2a/` as the exact ignore rule; do not broaden it to all scratch.

- [ ] **Step 4: Run GREEN and prove the command is non-live**

Run:

```powershell
npm test -- scripts/visual-engine-2a-qualify.test.ts lib/generation/visual-engine-2a-qualification.test.ts
npm run typecheck
git diff --check
```

Do not run the real qualification command yet; its catalog/HTML fetch belongs to the later controlled non-live verification checkpoint after review.

- [ ] **Step 5: Commit**

```powershell
git add scripts/visual-engine-2a-qualify.ts scripts/visual-engine-2a-qualify.test.ts package.json .gitignore
git commit -m "feat(generation): add read-only 2A qualification gate"
```

---

## Task 4: Preserve complete Gemini usage for intent analysis

**Files:**

- Modify: `lib/generation/analyze-intent.ts`
- Modify: `lib/generation/analyze-intent.test.ts`
- Modify: `lib/generation/safe-selection.ts`
- Modify: `lib/generation/safe-selection.test.ts`

- [ ] **Step 1: Write RED provider-envelope tests**

Cover valid `promptTokenCount`, `candidatesTokenCount`, `cachedContentTokenCount`, and `thoughtsTokenCount`; explicit zero; omitted `usageMetadata`; partially missing metadata; invalid negative/fractional/string values; and paid responses that later fail JSON/schema validation. Usage must survive any response received from Gemini, including parse/schema failure, but remain absent for missing key, aborted-before-call, fetch rejection, HTTP error without a valid usage envelope, and invalid envelope.

- [ ] **Step 2: Run RED**

Run: `npm test -- lib/generation/analyze-intent.test.ts lib/generation/safe-selection.test.ts`

- [ ] **Step 3: Implement one shared usage contract**

Reuse `ModelTokenUsage` from `lib/generation/model-cost.ts`:

```ts
export type IntentModelUsage = ModelTokenUsage;

type AnalyzeIntentResult =
  | {
      ok: true;
      intent: IntentAnalysis;
      modelId: string;
      promptVersion: typeof INTENT_PROMPT_VERSION;
      usage?: IntentModelUsage;
      durationMs: number;
    }
  | {
      ok: false;
      error: AnalyzeIntentError;
      modelId: string;
      promptVersion: typeof INTENT_PROMPT_VERSION;
      usage?: IntentModelUsage;
      durationMs: number;
    };
```

Map prompt→`inputTokens`, candidates→`outputTokens`, cached content→`cachedTokens`, thoughts→`thinkingTokens`. Do not synthesize missing `usageMetadata` as zeros. Propagate safe usage through both success and failure variants of `SafeSelectionResult` without including provider payloads or raw errors.

- [ ] **Step 4: Run GREEN and all usage/cost regressions**

Run:

```powershell
npm test -- lib/generation/analyze-intent.test.ts lib/generation/safe-selection.test.ts lib/generation/generate-creative-direction.test.ts lib/generation/model-cost.test.ts
npm run typecheck
git diff --check
```

- [ ] **Step 5: Commit**

```powershell
git add lib/generation/analyze-intent.ts lib/generation/analyze-intent.test.ts lib/generation/safe-selection.ts lib/generation/safe-selection.test.ts
git commit -m "fix(generation): preserve intent model usage"
```

---

## Task 5: Make the corrected live preflight all-or-nothing and cost-accounted

**Files:**

- Create: `lib/generation/visual-engine-2a-preflight.ts`
- Create: `lib/generation/visual-engine-2a-preflight.test.ts`
- Modify: `lib/generation/visual-engine-2a-eval.ts`
- Modify: `lib/generation/visual-engine-2a-eval.test.ts`
- Modify: `lib/generation/model-cost.ts`
- Modify: `lib/generation/model-cost.test.ts`

- [ ] **Step 1: Write RED tests for the 75-row barrier**

Use deferred promises to prove `reserve` is never called while any selection is pending. Cover 75/75 skeleton success; one provider failure; one full route; one composition route; one template outside the case allowlist; stale manifest; version mismatch; fewer than 10 distinct selected templates; one template used by 3 base cases; qualification/source/catalog/hash mismatch; quota not exactly `75/0`; and pre-existing 2A runs. Every failure must finish with `reservationCount: 0`.

- [ ] **Step 2: Write RED tests for aggregate usage and price evidence**

Aggregate all 75 intent calls into input/output/cached/thinking totals. Require `usageComplete: false` and `productionEquivalentCostMicromxn: null` if any paid response lacks usage. With complete usage, calculate cost through the frozen `PilotRateCard`/`calculateModelCostMicros` path, not local arithmetic. Assert the report DTO contains no briefs, intents, HTML, copy, raw response/error, API key, absolute path, or reviewer identity.

- [ ] **Step 3: Run RED**

Run: `npm test -- lib/generation/visual-engine-2a-preflight.test.ts lib/generation/visual-engine-2a-eval.test.ts lib/generation/model-cost.test.ts`

- [ ] **Step 4: Implement the barrier and report contracts**

Export:

```ts
export interface VisualEngine2APreflightReport {
  schemaVersion: "visual-engine-2a-preflight/1.0";
  datasetVersion: typeof VISUAL_ENGINE_2A_DATASET_VERSION;
  datasetSha256: string;
  qualificationManifestSha256: string;
  commitSha: string;
  modelId: string;
  promptVersion: string;
  policyVersion: string;
  taxonomyVersion: string;
  rateCardVersion: string;
  counts: PilotPreflightCounts;
  tokens: ModelTokenUsage | null;
  usageComplete: boolean;
  productionEquivalentCostMicromxn: number | null;
  totalDurationMs: number;
  reservationCount: 0;
  reportSha256: string;
}

export interface VisualEngine2APreflightDependencies {
  cases: readonly VisualEngine2APilotCase[];
  qualification: VisualEngine2AQualificationManifest;
  currentQualification: Omit<VisualEngine2AQualificationManifest, "manifestSha256">;
  quota: { limit: number; used: number; existingRuns: number };
  modelId: string;
  rateCard: PilotRateCard;
  mxnPerUsd: number;
  select(row: VisualEngine2APoolRow): Promise<SafeSelectionResult>;
  now?: () => number;
}

export async function runVisualEngine2APreflight(args: VisualEngine2APreflightDependencies): Promise<
  | { ok: true; eligible: readonly QualifiedPilotRow[]; report: VisualEngine2APreflightReport }
  | { ok: false; code: PreflightFailureCode; report: VisualEngine2APreflightReport }
>;
```

Complete and validate all selection results before returning eligible rows. Keep `reserve` outside this module so it is impossible for preflight to mutate quota. Add an intent-only cost input to the shared model-cost helper rather than duplicating currency math.

- [ ] **Step 5: Run GREEN and regression**

Run:

```powershell
npm test -- lib/generation/visual-engine-2a-preflight.test.ts lib/generation/visual-engine-2a-eval.test.ts lib/generation/model-cost.test.ts lib/generation/visual-engine-pilot-store.test.ts
npm run typecheck
git diff --check
```

- [ ] **Step 6: Commit**

```powershell
git add lib/generation/visual-engine-2a-preflight.ts lib/generation/visual-engine-2a-preflight.test.ts lib/generation/visual-engine-2a-eval.ts lib/generation/visual-engine-2a-eval.test.ts lib/generation/model-cost.ts lib/generation/model-cost.test.ts
git commit -m "feat(generation): gate Visual Engine 2A live preflight"
```

---

## Task 6: Integrate the cohort and qualification artifact into the 2A runner

**Files:**

- Modify: `scripts/visual-engine-2a-eval.ts`
- Create: `scripts/visual-engine-2a-eval.integration.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write RED end-to-end boundary tests around `main()`**

Refactor the script to export an injected `runVisualEngine2AEvalCli(deps)` and keep the top-level call minimal. Test: qualification artifact verified before provider; stale artifact causes zero provider/reserve calls; 74/75 skeletons cause zero reserves; outside-allowlist causes zero reserves; quota mismatch is checked before provider; 75/75 valid results write the aggregate preflight report atomically before exactly 75 adaptation reservations; adaptation never receives a row not present in the frozen cohort.

- [ ] **Step 2: Run RED**

Run: `npm test -- scripts/visual-engine-2a-eval.integration.test.ts`

- [ ] **Step 3: Replace selector cases with the frozen cohort**

Remove the script import/use of `SELECTOR_CASES` and `SELECTOR_HOLDOUT_CASES`. Load and verify `scratch/visual-engine-2a/qualification.json`, recompute current cohort/catalog/template hashes, run the corrected live preflight, write `scratch/visual-engine-2a/preflight.json`, and only then call the existing `generateVisualEngine2AEvidence`. Retain current reserve/baseline/adapt/critic/render/writeEvidence/complete implementations unchanged.

The CLI must refuse unless `OPENLEN_VISUAL_ENGINE === "shadow"`, the rate card is complete, quota is `2a=75, used=0`, zero 2A runs exist, and both qualification/preflight hashes bind to `HEAD`. Do not add retries or replacement rows.

- [ ] **Step 4: Run GREEN and the full 2A focused suite**

Run:

```powershell
npm test -- scripts/visual-engine-2a-eval.integration.test.ts lib/generation/visual-engine-2a-cohort.test.ts lib/generation/visual-engine-2a-qualification.test.ts lib/generation/visual-engine-2a-preflight.test.ts lib/generation/visual-engine-2a-eval.test.ts lib/generation/adapt-skeleton.test.ts lib/generation/visual-engine-pilot-store.test.ts
npm run typecheck
git diff --check
```

- [ ] **Step 5: Commit**

```powershell
git add scripts/visual-engine-2a-eval.ts scripts/visual-engine-2a-eval.integration.test.ts package.json
git commit -m "feat(generation): run 2A from qualified cohort"
```

---

## Task 7: Update operations documentation and privacy assertions

**Files:**

- Modify: `docs/generation/visual-engine-2a-runbook.md`
- Create: `docs/generation/visual-engine-2a-pilot-cohort.md`
- Modify: `lib/generation/visual-engine-2a-qualification.test.ts`
- Modify: `scripts/visual-engine-2a-eval.integration.test.ts`

- [ ] **Step 1: Add RED documentation/command contract tests**

Assert the runbook orders operations as qualification → human manifest review → fresh rate/FIX freeze → new explicit paid authorization → live eval → blind review → rollback → scorecard. Assert it says the prior authorization is spent, selector cases are not the 2A cohort, the complex coloring platform belongs to 2B, and `OPENLEN_VISUAL_ENGINE` remains off by default.

- [ ] **Step 2: Document exact artifacts and incident behavior**

Document:

- `scratch/visual-engine-2a/qualification.json` and `preflight.json` schemas and redaction;
- read-only qualification command;
- future paid command, with an explicit warning not to run without new approval;
- required 75/75 live barrier and `reservationCount=0` during preflight;
- hash/commit/catalog staleness behavior;
- usage-incomplete behavior;
- no replacement rows and abandoned-run policy;
- existing 72–75 evidence/review behavior and final unchanged gates;
- exact rollback test command with the server-only shim when invoking `tsx` directly.

- [ ] **Step 3: Run documentation, privacy, and regression checks**

Run:

```powershell
npm test -- lib/generation/visual-engine-2a-qualification.test.ts scripts/visual-engine-2a-eval.integration.test.ts lib/generation/selector-cases.test.ts lib/generation/selector-holdout-cases.test.ts
npm run typecheck
git diff --check
```

Inspect `git diff --cached --name-only` before commit and fail if it contains `.env`, `scratch/visual-engine-2a`, image extensions, reviewer/session files, or the five pre-existing scratch JSON files.

- [ ] **Step 4: Commit**

```powershell
git add docs/generation/visual-engine-2a-runbook.md docs/generation/visual-engine-2a-pilot-cohort.md lib/generation/visual-engine-2a-qualification.test.ts scripts/visual-engine-2a-eval.integration.test.ts
git commit -m "docs(generation): operationalize qualified 2A cohort"
```

---

## Task 8: Perform final non-live verification and request review

**Files:**

- Modify only if verification finds a tested defect in the files already listed above.

- [ ] **Step 1: Run the complete local test gate**

```powershell
npm test
npm run typecheck
npm run generation:visual-engine-2a:rollback-check
git diff --check
```

Expected: all tests/typecheck/rollback pass. The rollback command may create only ignored fixture evidence and must make no model or DB call.

- [ ] **Step 2: Run static privacy and scope audit**

Verify the branch diff contains no selector-case edits, threshold/taxonomy/metadata changes, `.env*`, generated binding, evidence, screenshots, raw response data, absolute local path, secret, email, or reviewer identity. Verify the five prior scratch JSON SHA-256 values have not changed.

- [ ] **Step 3: Request an independent code review**

Use `superpowers:requesting-code-review` against the full branch diff. Resolve every Critical/Important finding with a focused RED test and rerun the complete gate. Do not begin a second broad review cycle after the focused rereview is clean.

- [ ] **Step 4: Execute the read-only qualification checkpoint only after code review**

This command is non-live and uses no Gemini/provider calls or DB writes:

```powershell
npm run generation:visual-engine-2a:qualify
```

Review the aggregate output and ignored qualification artifact. A failure means the cohort or current catalog does not honestly satisfy 2A; do not change thresholds/metadata to force it and do not proceed to paid work.

- [ ] **Step 5: Report the authorization boundary**

If qualification is green, report the exact selected template distribution, hashes, commit, and quota readback. Stop and request a new explicit authorization before running `npm run generation:visual-engine-2a:eval`. Do not infer authorization from any earlier approval.
