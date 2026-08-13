# Task 5 — Fable parity delivery

## Estado

GREEN. Se aplicó el ruling del controller: expansión mínima limitada a una
raíz de composición productiva (`fable-runtime-composition`) sin nueva fase ni
duplicación de proveedores. El POST usa esa raíz cuando no se inyecta un gate
en pruebas; no queda un `POST` fail-closed por depender de un double test-only.

## Entrega

- Qwen recibe sólo el brief sintético allowlisted y dos JPEG ya decodificados
  (desktop/mobile). Overflow, tipografía/geometría deterministas, wrong-niche,
  estilo genérico o score de nicho menor a 7 impiden aceptación.
- GLM opera como máquina terminal de una reparación; sus deltas son ASTs por
  `programId`. El handoff privado puede conservar una closure efímera de Task
  4 para recompilar únicamente programas afectados, ensamblar y rerenderizar
  antes de la única crítica final. Esa closure no forma parte de metadata,
  telemetría ni persistencia.
- La raíz crea un solo `PageBudget` y un único cliente Fireworks por página;
  expone las costuras GLM de Task 4 y Gemini image-only con el mismo budget.
  Gemini sigue pinned a `gemini-2.5-flash-image`, máximo tres imágenes, con
  validación, storage, manifest y trace del pipeline existente.
- La telemetría tiene sólo campos redacted de coste/uso. El sink se espera
  antes de entregar fallos del gate; Qwen y GLM registran cada intento pagado.
- El route deja preview en buffer hasta que persistencia y débito concluyen;
  si falla débito compensa el draft conocido y entrega un SSE estable sin
  datos privados. Se conserva un único preview, un único `done` y no hay
  clonación completa ni fallback de template.

## Evidencia de TDD y verificación

RED: `fable-runtime-composition.test.ts` falló inicialmente con
`qwen_failed`; GREEN tras fijar el contrato de imagen y la raíz. La prueba de
`run-ai-creation` confirma que la ruta de producción construye el runtime por
defecto y entrega una aceptación inyectando únicamente bordes externos.

```text
npm.cmd test -- lib/ai/qwen-visual-critic.test.ts lib/generation/glm-visual-repair.test.ts lib/generation/fable-generation-telemetry.test.ts lib/curate/run-ai-creation.test.ts lib/curate/quick-section-composition.test.ts lib/curate/quick-visual-repair.test.ts lib/generation/asset-pipeline.test.ts lib/curate/curate-route.integration.test.ts lib/curate/ai-hybrid-import-boundary.test.ts
# 9 archivos, 109 tests: PASS

npm.cmd test -- ... lib/curate/fable-runtime-composition.test.ts
# 10 archivos, 110 tests: PASS (incluye la raíz productiva)

npm.cmd run typecheck
# PASS

npm.cmd run generation:ai-hybrid:gate
# 20 archivos, 262 tests: PASS

npm.cmd run generation:visual-engine-assets:gate
# 21 archivos, 347 tests: PASS

git diff --check
# PASS
```
