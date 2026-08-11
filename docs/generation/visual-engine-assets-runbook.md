# Visual Engine domain-aware assets runbook

This runbook covers the domain-aware asset resolver that sits between creative compilation and the existing sanitization, structural fingerprint, technical render, and visual-repair gates. It does not change the template selector, HTML engine, agent, section composer, or 2C evaluator.

## Release gate

Run the deterministic, non-live gate before any rollout decision:

```powershell
npm.cmd run generation:visual-engine-assets:gate
npm.cmd run typecheck
npm.cmd run generation:visual-engine-2a:rollback-check
git diff --check
```

The asset gate uses local fixtures and injected transports. It must not need a Gemini key, database connection, deployment, or feature activation. The rollback check must report `verified=true`.

## Mode and precedence

`OPENLEN_VISUAL_ENGINE_ASSETS` is read when a Quick request starts. Accepted values are exact and case-sensitive:

| Value | Delivery behavior | Curated domain resolver | Image provider |
| --- | --- | --- | --- |
| unset, invalid, or `off` | Preserve the existing `resolveSkeletonAssets` path. | No | No |
| `shadow` | Preserve the existing delivered HTML and asset metadata. Resolve a candidate only for redacted trace telemetry; a shadow failure cannot change delivery. | Yes | No |
| `curated` | Apply a compatible, validated curated manifest. A required unresolved asset fails closed to the existing Visual Engine fallback. | Yes | No |
| `hybrid` | Try the same curated hard gates first, then generate only unresolved slots. Apply only after the complete manifest validates and stores successfully. | Yes | Yes, when capability and budget gates pass |

Asset mode is independent of `OPENLEN_VISUAL_ENGINE` and `OPENLEN_VISUAL_ENGINE_REPAIR`. Those existing controls still decide whether the skeleton/composition/repair paths run; the asset mode only controls asset resolution inside an eligible Visual Engine path. It does not override route or repair mode. To roll back this subsystem, set only `OPENLEN_VISUAL_ENGINE_ASSETS=off` and leave the other Visual Engine variables unchanged.

Within the resolver, compatibility gates precede ranking, and curated resolution precedes provider generation. Tone, palette, or score cannot override domain, audience, media, forbidden-signal, provenance, URL, or byte-validation gates.

## Provider model and budget

The Gemini adapter selects its image model in this order:

1. an explicitly injected adapter option (tests or a caller-owned integration);
2. `OPENLEN_ASSET_IMAGE_MODEL`;
3. the existing `OPENLEN_IMAGE_EDIT_MODEL` fallback;
4. the adapter default `gemini-2.5-flash-image`.

Model identifiers are trimmed and must match the adapter's bounded identifier policy; an invalid candidate is skipped in favor of the next entry. `GEMINI_API_KEY` is also required for provider capability, but must never be logged or persisted.

All three asset budget variables are required together for generation:

| Variable | Meaning |
| --- | --- |
| `OPENLEN_VISUAL_ENGINE_ASSET_RATE_CARD_VERSION` | Positive-integer rate-card version recorded with the operational configuration. |
| `OPENLEN_VISUAL_ENGINE_ASSET_MAX_MICROMXN` | Positive-integer maximum estimated cost, in micro-MXN, for one pack request. |
| `OPENLEN_VISUAL_ENGINE_ASSET_ESTIMATED_IMAGE_MICROMXN` | Positive-integer conservative estimated cost, in micro-MXN, for each requested image. |

Missing configuration disables provider capability. A present but malformed value is invalid configuration. The adapter requires the request budget to equal the operational budget and rejects the pack when `asset count * estimated image cost` is greater than the maximum. Curated resolution can remain active without an API key or generation budget by using `curated` (or `shadow`) mode.

## URLs, storage, and byte policy

Curated and abstract catalog assets are allowed only from `https://images.openlen.com/<path>`. URLs must have HTTPS, the exact host, no credentials, query, fragment, or decoded traversal. Only ranked winners are fetched, with redirects rejected. Reviewed checksum metadata, when present, must equal the bytes' SHA-256.

Generated assets are accepted as bytes, never as provider URLs. PNG, JPEG, and WebP are the only generated MIME types. The declared MIME must match the signature. Each selected curated or generated image must be non-empty, no larger than 6 MiB, between 64 and 4096 pixels on each axis, and no more than 16,777,216 pixels total. SVG is not accepted from the provider. A manifest contains at most three generated resolutions.

Generated manifest URLs use the canonical same-origin route:

```text
/api/projects/<safe-project-id>/assets/<full-sha256>.<png|jpg|jpeg|webp>
```

`LocalFsAssetStorage` returns that relative route when `OPENLEN_APP_BASE_URL` is unset. When `OPENLEN_APP_BASE_URL` is set, existing storage metadata prefixes the route with that configured origin; the generated-manifest contract accepts the absolute form only when its origin exactly matches `OPENLEN_APP_BASE_URL` and its pathname remains the canonical route above. Arbitrary external storage or provider URLs are not accepted in a generated manifest. Content filenames use the complete SHA-256 digest; legacy sixteen-character project filenames remain readable but are not emitted for new generated assets.

## Trace and privacy contract

Operational telemetry may contain only the strict `asset-resolution-trace/1.0` fields:

- manifest ID/hash, one consistency-group count, and curated/generated/abstract/placeholder counts;
- required-unresolved count and bounded rejection counts by typed reason;
- provider and model identifiers;
- up to three prompt SHA-256 hashes;
- aggregate input/output/cached/thinking token counts when reported;
- estimated cost in micro-MXN, duration, and final typed result code.

Do not put complete prompts, manifest slots or private provenance, image bytes/base64, image or provider response bodies, provider URLs, raw HTML, user briefs, private copy, screenshots, secrets, API keys, emails, or absolute local paths in telemetry. A sanitized generation prompt may exist only in project-private manifest provenance for reproducibility; telemetry links to it by `promptSha256`.

## Typed failures and atomic fallback

Treat these outcomes separately:

| Class | Examples | Operator meaning |
| --- | --- | --- |
| Provider | unavailable, timeout, blocked, provider error, budget exhausted | No provider result is trusted. A compatible curated result may still be used; otherwise required slots fail closed. |
| Validation | invalid provider response, invalid image/signature/MIME/dimensions/checksum, invalid manifest | Reject the output without exposing its body or partial HTML. |
| Storage | write/metadata mismatch or `storage_failure` | Commit no generated manifest or HTML reference. Content-addressed orphan bytes may be cleaned up separately. |
| Required slot | `required_asset_unavailable` or `asset_slot_unavailable` | Never substitute a merely tone-similar or wrong-category asset; return to the normal Visual Engine fallback. |
| Structural/render | asset application, sanitization, fingerprint, role coverage, or technical-render failure | Discard the candidate and keep the existing fallback path authoritative. |

Application is atomic: only authorized `src`, `srcset`, and `alt` changes are allowed, and accepted manifest/trace metadata travels with the accepted HTML. Provider, validation, storage, required-slot, structural, sanitization, or render failures expose no partially modified document.

The provider pack contains at most three images. Calls are sequential to carry one shared style reference, there is no retry or replacement, and the first failed slot aborts the pack. Do not add an operator retry loop around the adapter; a new attempt requires a new, explicit operation and budget decision.

## Rollback and incident response

1. Set `OPENLEN_VISUAL_ENGINE_ASSETS=off`.
2. Do not change `OPENLEN_VISUAL_ENGINE` or `OPENLEN_VISUAL_ENGINE_REPAIR`; their rollout state is independent.
3. Confirm new Quick requests use the existing resolver, make no asset-provider calls, and persist no new asset manifest/trace.
4. Run `npm.cmd run generation:visual-engine-2a:rollback-check` and require `verified=true`.
5. Inspect only redacted typed traces. Do not copy provider bodies, prompts, user HTML/copy, or image bytes into incident records.

Invalid or unknown asset-mode values already fail closed to `off`, but operators should set the explicit `off` value during an incident.

## Separately authorized paid canary

A paid canary is optional and is not part of the deterministic release gate. Run it only after all local gates pass and the owner gives separate authorization for the exact provider data and spend. It may contain at most three synthetic cases, must use no private project data, must honor the configured pack budget, and must record only the redacted trace fields above. Do not run, retry, expand, deploy, or activate the feature from this runbook without that separate authorization.
