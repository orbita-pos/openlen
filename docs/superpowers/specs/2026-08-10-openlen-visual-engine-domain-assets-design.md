# OpenLen Visual Engine — Domain-Aware Asset Pipeline

**Date:** 2026-08-10

**Status:** Approved design

**Scope:** Plan 4 of the approved world-class generation program

## 1. Outcome

OpenLen must preserve the structural quality of its templates while ensuring that their imagery communicates the requested domain, audience, and emotional identity. A visually polished template must never keep or receive an asset from a semantically incompatible category merely because its layout or tone is similar.

This stage introduces a provider-neutral `AssetManifest` and a hybrid resolver that:

1. prefers exact, coherent assets from OpenLen's curated catalog;
2. creates a consistent generated pack only when the catalog is insufficient;
3. uses compatible abstract assets or designed placeholders only for optional slots;
4. fails closed when a required identity-bearing asset cannot be resolved.

The pipeline extends the existing Visual Engine. It does not rebuild the HTML engine, agent, template selector, section composer, creative compiler, or 2C visual evaluator.

## 2. Current verified foundation

The repository already contains:

- a curated image manifest and loader in `lib/imagery/manifest.ts`;
- deterministic catalog ranking and safe slot replacement in `lib/generation/skeleton-assets.ts`;
- bounded image slots in `SkeletonInventory`;
- asset instructions in `SkeletonAdaptationPlan`;
- structural fingerprint exemptions limited to authorized `src`, `srcset`, and `alt` changes;
- content-addressed local/S3-compatible project asset storage;
- an existing Gemini image-edit transport with an injected boundary;
- 2C multi-viewport visual evaluation and localized repair.

The missing capability is a complete domain-aware pack contract with provenance, deterministic compatibility gates, coherent fallback ordering, provider-neutral generation, and final-pipeline integration.

## 3. Assumptions

- Curated catalog entries can be extended with versioned metadata without invalidating existing consumers.
- Generated providers return image bytes, not trusted public URLs.
- The current project asset storage remains the persistence boundary for generated images.
- Existing template imagery without verifiable semantic metadata is treated as unknown, not compatible by default, for required identity-bearing slots.
- Paid provider execution is separately gated and is not authorized by approval of this design.

## 4. Non-goals

- Replacing the existing template, HTML, agent, composition, or visual-evaluation engines.
- Building a general-purpose digital asset manager.
- Training a custom image model.
- Generating every image for every page.
- Allowing the model to choose arbitrary remote URLs.
- Running another 15-case paid visual pilot as part of implementation.
- Learning/reranking and enterprise rollout operations; those belong to the final Plan 6 block.

## 5. Approaches considered

### 5.1 Curated-only

Low cost and deterministic, but it repeats the original failure whenever the catalog lacks a domain-specific pack.

### 5.2 Generate-all

Highly specific, but adds unnecessary cost, latency, moderation exposure, and visual inconsistency. It discards the value of OpenLen's curated library.

### 5.3 Hybrid manifest — selected

Curated exact matches remain the default. Generation is a bounded fallback, performed as a pack under a shared consistency contract. This preserves template and catalog quality while covering absent domains.

## 6. Pipeline position

The manifest is resolved after creative compilation and before sanitization, structural verification, technical rendering, and 2C:

```text
Intent + selected structure
  -> CreativeDirection + SkeletonAdaptationPlan
  -> compile colors, typography, geometry and hooks
  -> build AssetIntent[] from authorized slots
  -> resolve and validate AssetManifest
  -> apply src/srcset/alt only to authorized slots
  -> sanitize + structural fingerprint
  -> technical render
  -> 2C visual evaluation and optional localized repair
  -> persist/deliver only the accepted candidate
```

No intermediate HTML candidate is exposed or persisted.

## 7. Contracts

### 7.1 Asset intent

`AssetIntent` is deterministic input to the resolver. It is derived from the already-validated creative direction, adaptation plan, inventory, intent analysis, and template metadata.

Required fields:

- `slotIndex` and `role` (`hero | section | card`);
- `required` and `identityBearing`;
- `mediaType` (`photo | illustration | texture`);
- bounded subject taxonomy;
- domain and audience taxonomy;
- visual archetype and emotional tone;
- aspect ratio and focal-point preference;
- bounded alt text;
- required and forbidden visual signals.

The provider cannot add slots, change slot roles, alter structural HTML, or weaken forbidden signals.

### 7.2 Asset manifest

```json
{
  "schemaVersion": "asset-manifest/1.0",
  "manifestId": "sha256:<canonical-manifest-hash>",
  "consistencyGroup": {
    "id": "kids-coloring-pastel-01",
    "mediaType": "illustration",
    "artDirection": "soft_storybook_crayon",
    "paletteHints": ["pastel_pink", "lavender", "warm_yellow"],
    "styleLock": "rounded_shapes_hand_drawn_texture"
  },
  "slots": [
    {
      "slotIndex": 0,
      "role": "hero",
      "required": true,
      "identityBearing": true,
      "intent": {
        "subjects": ["children_coloring", "crayons", "friendly_animals"],
        "aspectRatio": "16:9",
        "focalPoint": "center",
        "alt": "Niños coloreando animales con crayones"
      },
      "resolution": {
        "source": "curated",
        "assetId": "coloring-crayons",
        "url": "/openlen-images/...",
        "mimeType": "image/webp",
        "checksum": "sha256:<asset-bytes-hash>",
        "domainMatch": true,
        "audienceMatch": true,
        "styleMatch": true,
        "provenance": {
          "catalogVersion": "openlen-images/1",
          "license": "catalog_verified"
        }
      }
    }
  ],
  "fallbackPolicy": "fail_closed_on_required_identity_asset"
}
```

The production Zod schema is strict, bounded, versioned, duplicate-safe, URL-policy-aware, and rejects unknown keys.

### 7.3 Provider boundary

```ts
interface AssetPackProvider {
  capabilities(): {
    generate: boolean;
    editFromReference: boolean;
    maxAssets: number;
  };

  createPack(request: AssetPackRequest): Promise<AssetPackResult>;
}
```

The request contains only allowlisted, bounded creative fields. The result contains typed success/failure records and image bytes. Gemini is an adapter, not part of the shared contract. Fireworks or another provider can later implement the same interface without changing the resolver, composer, or evaluator.

## 8. Resolution policy

Resolution is pack-aware and follows this order:

1. curated assets with exact domain, audience, media-type, and style compatibility;
2. a generated pack sharing one `consistencyGroup`;
3. compatible abstract/illustrated catalog assets;
4. a designed placeholder for optional non-identity slots only.

### 8.1 Hard compatibility gates

Candidates are rejected before scoring when any of these fail:

- domain compatibility;
- audience compatibility, including sensitive audiences;
- requested media type;
- required visual signals;
- forbidden visual signals;
- provenance/license policy;
- supported MIME, size, dimensions, and decode validation;
- slot role and aspect-ratio policy.

Tone or color similarity never overrides these gates.

### 8.2 Ranking after compatibility

Eligible candidates are ranked deterministically by:

- subject match;
- role suitability;
- visual archetype and art-direction match;
- emotional tone;
- palette/tone compatibility;
- crop/aspect compatibility;
- pack coherence;
- stable asset-ID tie break.

### 8.3 Existing template assets

- A `keep` instruction is allowed for an identity-bearing slot only when the original asset has compatible, verifiable metadata.
- Catalog-recognized template assets reuse their catalog provenance.
- Unknown original assets may remain only in optional, non-identity slots when they do not violate a forbidden signal.
- Required unknown imagery is replaced or causes fail-closed fallback.

### 8.4 Pack coherence

Hero and primary section/card assets share a single media type, art direction, palette treatment, and style lock unless the direction explicitly declares a controlled mixed-media treatment. Independent per-slot random generation is forbidden.

## 9. Generation and storage

- Generation is invoked only after curated resolution proves insufficient.
- One bounded pack request is preferred over independent requests.
- The provider receives no raw HTML, secrets, private project data, or unrestricted user payload.
- Generated outputs must be PNG, JPEG, or WebP and pass byte signature, MIME, decode, dimension, and size checks.
- Provider-returned URLs and SVG are rejected.
- Valid bytes are stored through the existing project `AssetStorage` using content-derived names.
- The project/HTML references assets only after all gates pass. Content-addressed orphan bytes are safe and may be removed later by TTL cleanup.
- Debit occurs only for valid provider output according to the existing credit policy.
- Provider failure, timeout, block, invalid output, storage failure, and budget exhaustion are distinct typed outcomes.

The initial Gemini adapter may reuse the existing image-edit transport and curated reference assets. The shared contract must not assume that every provider supports text-to-image generation.

## 10. Failure and fallback semantics

- Required identity asset unresolved: `required_asset_unavailable`; discard adapted candidate atomically.
- Requested slot not replaceable: `asset_slot_unavailable`; discard candidate.
- Provider unavailable/timeout: use a compatible curated fallback if available; otherwise fail closed for required slots.
- Invalid generated bytes or metadata: reject without exposing body or partial HTML.
- Optional unresolved slot: use a compatible designed placeholder or retain a verified compatible original.
- Storage failure: no HTML/project reference is committed.
- Structural, sanitization, render, or 2C failure after asset application: the normal Visual Engine fallback path remains authoritative.

An unrelated photograph or illustration is never an acceptable fallback.

## 11. Security, privacy, and provenance

- Asset application remains limited to authorized `src`, `srcset`, and `alt` attributes.
- Remote fetches obey the existing SSRF boundary; generated provider output is accepted as bytes only.
- Alt text, identifiers, taxonomies, prompts, and URLs are bounded and validated.
- Persisted project-private provenance may contain a sanitized generation prompt when required for reproducibility.
- Operational telemetry stores only IDs, hashes, provider/model, duration, usage, cost, resolution source, and typed reason codes.
- Telemetry does not store image bytes, response bodies, raw HTML, private copy, or complete prompts.
- `promptSha256` links telemetry to project-private provenance without exposing the prompt.

## 12. Observability

Each resolution trace records:

- manifest/version IDs;
- slot and consistency-group counts;
- curated/generated/abstract/placeholder counts;
- rejection counts by hard-gate reason;
- required unresolved count;
- provider/model and capability path;
- usage, cost, and latency when reported;
- storage result and asset checksum;
- final Visual Engine reason code.

Traces remain redacted and must not change Quick delivery behavior when the feature is disabled.

## 13. Verification gates

### 13.1 Deterministic local gates

- zero forbidden-category assets in adversarial fixtures;
- every required slot resolves compatibly or fails closed;
- every resolved asset has checksum and provenance;
- one coherent consistency group for primary assets;
- stable results and tie breaks for identical inputs;
- structural fingerprint unchanged after authorized replacement;
- model/provider/storage failures expose no partial HTML;
- no debit on invalid or absent generated output;
- current suite, typecheck, diff check, and rollback remain green.

### 13.2 Required fixture domains

- children's coloring platform requiring playful illustration;
- boutique hotel requiring editorial hospitality photography;
- developer observability product requiring product/technical imagery;
- restaurant requiring food/editorial imagery;
- creative portfolio requiring project-led imagery.

Each fixture includes compatible, merely tone-similar, and explicitly forbidden candidates.

### 13.3 Optional paid confirmation

After all local gates pass, a separately authorized canary may exercise at most three synthetic cases. It is not part of implementation authorization and is not required when the generation adapter is disabled.

## 14. Rollout and feature control

The asset pipeline follows the existing Visual Engine route controls:

- disabled: current behavior remains unchanged;
- shadow: resolve and record a redacted manifest without changing delivery;
- enabled canary: apply only to an explicit cohort and budget;
- rollback: turn off the asset resolver without changing the template, HTML, agent, composer, or 2C engines.

Provider generation has a separate capability/budget gate so curated resolution can remain active when paid generation is disabled.

## 15. Acceptance criteria

This stage is complete when:

1. strict provider-neutral contracts are committed;
2. curated, generated, abstract, and optional-placeholder policies are deterministic and tested;
3. required identity slots fail closed instead of receiving a wrong-category asset;
4. generated bytes have verified provenance and storage;
5. the manifest is integrated atomically into skeleton adaptation and 2C repair;
6. redacted trace fields and feature gates are present;
7. all deterministic gates and existing regression gates pass;
8. operational documentation explains configuration, budgets, failures, and rollback.

After this stage, the only remaining program block is Plan 6: learning, SLOs, canary/rollout hardening, and production activation.
