# Template-Derived Section Catalog Design

## Status and Scope

Approved architecture for the final Visual Engine corpus correction. The owner
has confirmed that OpenLen has 451 templates available as potential donors.
This design is limited to five implementation tasks. It does not introduce a
new Visual Engine phase after those tasks.

## Problem

OpenLen's hybrid generation pipeline is structurally safe, composition-only,
asset-aware, and guarded by visual review. However, its published section
catalog is dominated by SaaS and observability layouts. Semantic ranking cannot
produce a children's coloring site, horror page, school, restaurant, hotel, or
other niche identity when compatible structures are absent from its candidates.

Selecting the "least incompatible" SaaS section is still incorrect. Gemini is
not responsible for that choice: OpenLen selects donor fragments before its
creative transformation and therefore constrains the result to the available
geometry.

The 451 templates contain the missing visual diversity, but whole templates
must never be cloned and arbitrary live slicing would import unsafe or incomplete
CSS, scripts, assets, and document-level dependencies.

## Considered Approaches

### Manually author more section libraries

This improves a few niches but creates permanent catalog work and still leaves
unknown future niches uncovered. It is useful only for filling measured gaps.

### Slice templates during each user generation

This exposes the largest corpus immediately, but adds request latency, stale
dependencies, broken styling, unsafe scripts, and a renewed whole-template clone
risk. It is rejected.

### Compile verified donor sections offline (selected)

Treat the 451 templates as read-only source material. Extract, encapsulate,
validate, classify, deduplicate, and publish safe fragments ahead of runtime.
The online generator retrieves only compiled fragments. When no compatible
fragment exists, it generates that one section through the approved safe
section boundary instead of selecting an unrelated donor.

## Architecture

### 1. Read-only template corpus loader

Load the same published template records and authoritative HTML bytes available
to production. Record a corpus manifest containing only stable identifiers,
content hashes, status, and extraction version. Draft, archived, stale, missing,
or hash-mismatched templates are rejected before extraction.

The source templates are never modified. Extraction does not call Gemini, write
projects, debit credits, or contact the asset provider.

### 2. Deterministic section extractor and compiler

Parse each complete document and identify top-level `nav`, `header`, `section`,
and `footer` bands. A candidate must represent exactly one coherent page band;
`html`, `head`, `body`, nested full pages, and multi-band disguises are rejected.

For every candidate, collect only the CSS rules, fonts, safe scripts, and asset
references required by that band. Reuse the existing section scoping, contract
linting, sanitizer, storage hashing, asset-slot inventory, and fragment grammar.
Global selectors, IDs, keyframes, and tokens are scoped to the new fragment.

Compilation must prove that the resulting fragment is self-contained and does
not depend on the rest of its source template. A failed candidate is reported
and omitted atomically; it never becomes a published section.

### 3. Validation, provenance, semantics, and deduplication

Every compiled fragment receives internal provenance:

- source template ID and source content hash;
- source band ordinal and extraction version;
- compiled content hash and structural fingerprint;
- section role, layout archetype, domain signals, audience, mood, and negative
  compatibility signals;
- required asset slots and runtime requirements.

Provenance is operational metadata, not model-controlled input and not
user-facing copy.

Run deterministic safety and rendering checks at desktop and mobile widths:
valid fragment grammar, sanitization, scoped styles, decodable assets, no mobile
overflow, non-empty visible geometry, bounded dimensions, and stable rendering.

Deduplicate exact content hashes and near-identical structural fingerprints.
Keep the verified representative with the strongest render result. Classification
uses a closed taxonomy derived from trusted template metadata, visible text, and
structural features. Ambiguous fragments remain unpublished rather than being
guessed into a niche. Paid semantic enrichment is outside this design unless
separately authorized.

### 4. Runtime retrieval and per-section generation fallback

The page blueprint requests semantic roles such as hero, gallery, activities,
stories, products, testimonials, CTA, and footer. Retrieval applies hard negative
compatibility before scoring positive matches. A forbidden SaaS, dashboard,
course UI, terminal, game UI, or commerce structure can never win because it is
the "least bad" option.

Composition requires:

- at least three distinct fragment content hashes;
- donors from at least three source templates for normal pages;
- no source template contributing more than two content bands;
- no fragment with forbidden semantic signals;
- no reconstruction of a source template's original ordered band sequence.

If a required role has no compatible donor, OpenLen generates only that missing
section through a strict, schema-bound safe component vocabulary. The generated
section must pass the same compilation, fingerprint, sanitizer, render, mobile,
asset, and semantic gates before use. It is never silently replaced with an
unrelated catalog entry.

The existing copy engine, design-token compiler, asset engine, composition
finalizer, 2C repair, and final delivery gate then unify all accepted sections
into one visual identity.

### 5. Publication, refresh, and observability

The catalog compiler produces a redacted report before publishing: template
coverage, extracted/accepted/rejected counts, rejection reason counts, semantic
coverage by role/domain, deduplication counts, and manifest hashes. It contains
no raw HTML, copy, prompts, private metadata, credentials, or reviewer identity.

Publishing is atomic and idempotent. Existing catalog rows remain available
until the new manifest passes all gates. A refresh reprocesses only changed
template hashes and archives obsolete derived fragments without affecting
unrelated manually curated sections.

Runtime telemetry records only selected fragment IDs, provenance hashes,
reason codes, durations, and bounded model usage/cost where a missing section
was generated.

## Five Fixed Implementation Tasks

1. **Corpus and extraction:** load the 451 published templates and deterministically
   extract candidate bands with provenance.
2. **Compilation and catalog:** scope dependencies, validate, render, classify,
   deduplicate, report, and publish accepted fragments.
3. **Strict retrieval:** query the unified catalog, enforce semantic hard gates,
   donor diversity, and clone prevention.
4. **Generation integration:** generate only missing sections, then reuse the
   existing copy/design/assets/composition/2C delivery pipeline.
5. **Acceptance and rollout:** run local gates plus the six approved niche
   regressions (coloring, horror, school, cooking, hotel, and sales), perform a
   bounded authorized real canary, and deploy with rollback documentation.

No additional phase is planned after Task 5. A newly discovered release blocker
may be fixed inside the task that exposes it; optional hardening or catalog
expansion does not widen this delivery.

## Acceptance Criteria

- The authoritative 451-template manifest is read without mutating templates.
- Every published derived section has exact provenance and a verified content
  hash, and passes desktop/mobile rendering.
- Runtime never slices whole templates and never exposes the template store to
  model output.
- A forbidden semantic candidate cannot win through scoring or seeded ties.
- A missing compatible role invokes bounded per-section generation or returns a
  typed failure; it never selects an unrelated SaaS block.
- Delivered pages use at least three distinct fragments from at least three
  source templates and cannot recreate a source template.
- The six niche fixtures contain no forbidden structures and pass the existing
  asset, visual-quality, fingerprint, persistence, credit, privacy, and delivery
  gates.
- Mundo Pincel reads immediately as a children's coloring and creativity world,
  not a dashboard, school course UI, SaaS product, or dark game.
- Existing explicit template cloning remains a separate user-selected workflow
  and is not reachable from AI hybrid creation.

## Non-Goals

- Rebuilding the copy, design-token, asset, composition, or 2C engines.
- Editing the 451 source templates.
- Publishing every extracted band regardless of quality.
- Calling Gemini once per template during catalog compilation.
- Dynamically slicing arbitrary templates in a user request.
- Manually building a complete second catalog before using the existing corpus.
