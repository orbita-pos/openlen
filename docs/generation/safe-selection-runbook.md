# Safe template selection runbook

## Purpose and boundary

This runbook operates OpenLen's safe template-selection foundation. It separates product intent, template structure and visual identity before deciding whether a whole template is safe to reuse.

This phase is observational only. It does not make the safe selector user-visible and does not implement creative-direction tokens or execute `template_skeleton`. Those belong to Plan 2.

## Runtime modes

| `OPENLEN_SAFE_TEMPLATE_PICKER` | Behavior |
| --- | --- |
| unset or `off` | No intent-analysis call, no shadow log and current Quick behavior is unchanged. |
| `shadow` | Starts a separately funded intent analysis, computes a deterministic decision and emits one redacted structured server log. Current Quick selection, SSE output and user credits are unchanged. Shadow completion is not on the delivery critical path. |
| any other value, including `on` | Treated as `off`. User-visible safe selection is intentionally unsupported in this phase. |

Enable `shadow` only in an evaluation or staging environment where OpenLen funds the additional model call. A shadow log contains versions, usage, duration, scores, reason codes, the current template ID and agreement; it must not contain the brief, generated copy, HTML, API keys, raw provider output or provider error messages.

Rollback is immediate: unset `OPENLEN_SAFE_TEMPLATE_PICKER` or set it to `off`.

## Operator sequence

Run these commands in order from the repository root:

```bash
npm run templates:visual-metadata:migrate
npm run templates:visual-metadata:suggest -- --out scratch/template-visual-metadata-review.json
npm run templates:visual-metadata:import -- --input scratch/template-visual-metadata-reviewed.json
npm run generation:selector-eval -- --out scratch/generation-selector-eval.json
npx vitest run lib/generation lib/templates/visual-metadata.test.ts lib/templates/suggest-visual-metadata.test.ts lib/curate
npm run typecheck
```

The selector evaluation intentionally exits non-zero when a gate fails, but still writes every development and holdout row. Never remove failed model calls from a denominator and never lower a threshold to make a run pass.

## Human metadata review checklist

For every template, the reviewer confirms:

- Tags describe visible design and supported structure, not guesses from the template name.
- `visualSignals` list only what the screenshot visibly contains.
- `negativeTags` identify domains or audiences for which the design would be misleading.
- `themeability` reflects whether typography, geometry, imagery and decoration can all be replaced safely.
- Audience and age ranges are not inferred without visible evidence.
- A template is rejected instead of marked reviewed when its screenshot is stale, clipped, incomplete or missing.
- Full-page evidence is fitted to the review viewport; a thumbnail-scale capture is not accepted as full-page evidence.

## Automated gates

### Development policy corpus (20 cases)

- Intent success: at least `0.95`.
- Domain recall: at least `0.90`.
- Primary-audience accuracy: at least `0.90`.
- Forbidden-signal recall: at least `0.85`.
- Whole-template selections containing a forbidden signal: exactly `0`.

### Held-out generalization corpus (10 cases)

The holdout categories do not have category-specific contrast profiles in the prompt. Its exact forbidden-signal recall remains diagnostic because more than one contrast can be visually valid for an unseen category.

- Intent success: at least `0.90`.
- Domain recall: at least `0.90`.
- Primary-audience accuracy: at least `0.90`.
- Diagnostic-signal compliance: at least `0.90`; successful rows must return 2–4 signals from the canonical vocabulary.
- Whole-template selections containing a forbidden signal: exactly `0`.

The report must include SHA-256 fingerprints for the combined selector corpora and the ordered published-template metadata snapshot. A result without those fingerprints is not reproducible evidence.

## Shadow disagreement review

Before Plan 2 begins, manually inspect at least five cases where the shadow decision differs from current Quick selection. For each case record:

1. Case ID and current template ID.
2. Current template screenshot and reviewed visual metadata.
3. Shadow route, scores and hard-filter/threshold reasons.
4. Whether the shadow decision abstains from a category mismatch or selects a demonstrably better fit.
5. Reviewer name, timestamp and verdict.

Do not count a disagreement merely because a different ID was chosen. It must demonstrate safer abstention or improved category fit.

| Case | Current template | Shadow decision | Evidence verdict | Reviewer | Status |
| --- | --- | --- | --- | --- | --- |
| `kids-coloring-es` | [Lyceum](https://templates.openlen.com/screenshots/lyceum-50d2806bc278-v2.jpg) | `section_composition`; Quick candidate structure `0.000`, identity `0.200` | Education/technology template had unsupported site type and audience mismatch for children's coloring. | Jesus Bernal, 2026-08-05 | Accepted |
| `kids-stories-en` | [Atelier](https://templates.openlen.com/screenshots/atelier-38f7c7b850cb-v2.jpg) | `section_composition`; Quick candidate structure `0.140`, identity `0.100` | Adult design-course identity had unsupported site type and audience mismatch for children's stories. | Jesus Bernal, 2026-08-05 | Accepted |
| `logistics-holdout-es` | [Mantle](https://templates.openlen.com/screenshots/mantle-f955f7d961a3-v2.jpg) | `section_composition`; Quick candidate structure `0.000`, identity `0.000` | Commerce/SaaS template lacked logistics identity and failed site-type and audience compatibility. | Jesus Bernal, 2026-08-05 | Accepted |
| `city-portal-holdout-en` | [Cartograph](https://templates.openlen.com/screenshots/cartograph-a8b457eac4e1-v2.jpg) | `section_composition`; Quick candidate structure `0.000`, identity `0.071` | SaaS documentation/help-center identity was unsafe for a citizen-services portal. | Jesus Bernal, 2026-08-05 | Accepted |
| `research-lab-holdout-en` | [Foundry](https://templates.openlen.com/screenshots/foundry-7eeace7e8f2c-v2.jpg) | `section_composition`; Quick candidate structure `0.000`, identity `0.167` | Engineering magazine/subscription identity did not support a university climate-research lab. | Jesus Bernal, 2026-08-05 | Accepted |

Rejected audit candidates are retained conceptually rather than counted toward the gate: `coffee-es`/Grano, `restaurant-en`/Marcato, `hardware-es`/Lintel, `dev-observability-en`/Mirror, `dentist-es`/Northbrook Dental, `nonprofit-en`/Lantern and `wellness-es`/Poise were category-valid or visually closer than the shadow alternative. `fintech-en`/Ribbon remained too close to call without a deeper visual study. A disagreement alone is not evidence of improvement.

## Gate record — 2026-08-05

Automated evaluation command:

```bash
npm run generation:selector-eval -- --out scratch/generation-selector-eval.json
```

Result:

| Evidence | Value |
| --- | --- |
| Model | `gemini-2.5-flash` |
| Prompt | `intent-prompt/1.5` |
| Decision policy | `template-policy/1.0` |
| Taxonomy compatibility | `taxonomy-compatibility/1.1` |
| Published templates | `450` |
| Human-reviewed metadata | `440` (`97.78%`) |
| Development intent success | `0.950` (19/20) |
| Development domain recall | `0.950` |
| Development audience accuracy | `0.950` |
| Development forbidden-signal recall | `0.950` |
| Development forbidden whole-template selections | `0` |
| Holdout intent success | `1.000` (10/10) |
| Holdout domain recall | `0.900` |
| Holdout audience accuracy | `0.900` |
| Holdout diagnostic-signal compliance | `1.000` |
| Holdout forbidden whole-template selections | `0` |
| Selector corpus SHA-256 | `657f9fa703c32f0e092fec8adf939ff4c2e3990de9bbb1ec35acd6dcd290eedf` |
| Template metadata SHA-256 | `8f232babb08b145d5c878347155867348ba449e0685c0ea8becf1221c4bfe236` |
| Scorecard file SHA-256 | `e656a8bd4e87967fec79a4287e0e5b8185e273acbe9eef929e7ac7fb5f3bc5d2` |

Automated status: **PASS**. Metadata coverage exceeds 95%, both selector gates pass, and shadow mode has no user-visible result or credit change.

The sole failed development analysis was a provider response that did not satisfy the runtime schema. It remains in the denominator; no row was removed and no threshold was reduced.

The legal-firm holdout label changed from `local_services` to `business_services` because its brief targets startup founders and contains no geographic-service claim. This is a ground-truth correction made after reviewing the observed mismatch, not a threshold adjustment; the aggregate holdout domain recall would still have cleared the `0.90` gate with the former label.

The contractor/Solar disagreement was excluded from the gate because it helped motivate a discarded prompt change and would therefore contaminate held-out evidence.

Manual disagreement status: **PASS (5/5 human-approved)**. Jesus Bernal approved all five qualifying rows on 2026-08-05. Rejected, ambiguous and contaminated disagreements remain excluded.

## Complete local verification

```bash
npx vitest run lib/generation lib/templates/visual-metadata.test.ts lib/templates/suggest-visual-metadata.test.ts lib/curate
npm run typecheck
git diff --check
```

All commands must pass on the exact commit proposed for integration. Keep `scratch/*.json` local unless a separate evidence-retention policy explicitly requires committing an artifact.

## Plan 2 entry contract

Plan 2 may rely only on these committed foundation outputs:

```ts
IntentAnalysis
TemplateVisualMetadata
ScoredTemplate
GenerationDecision
analyzeIntent()
rankTemplates()
decideGenerationRoute()
```

Plan 2 may add `CreativeDirection`, design-token registries and the first user-visible `template_skeleton` execution path. It must not replace Quick selection until the automated gates and five-case disagreement review are both complete.
