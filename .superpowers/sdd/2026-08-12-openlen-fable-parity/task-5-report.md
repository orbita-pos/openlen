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

## Fix Round 1 — 2026-08-13

La evidencia anterior no era suficiente: `b01de910` podía quedar GREEN con
doubles de composición aunque el `POST` productivo por defecto no tuviera una
raíz adaptativa completa. Esta ronda reemplaza esa costura test-only por el
flujo productivo y verifica el route sin mockear `runAiCreation`.

### Corrección productiva

- `runAiCreation` crea el runtime antes de la primera llamada pagada y usa sus
  adaptadores DeepSeek/Fireworks para intent y copy, en orden y con schemas
  estrictos. Un error habilitado termina fail-closed; no existe fallback
  determinista silencioso.
- `runFableAdaptivePipeline` es la única raíz por defecto: inventario
  publicado, plan adaptativo, dirección determinista, contact sheet, scout
  Qwen, diseño DeepSeek, composición Task 4, assets Gemini image-only,
  finalización, metadata y handoff privado para el gate final.
- Task 4 usa un `AdaptiveCompiledSection` honesto para programas expresivos;
  valida compilación, sanitización, semántica, assets, desktop/mobile,
  ensamblado y seal sin fabricar procedencia de template. `applyDelta` rechaza
  IDs desconocidos, recompila sólo programas afectados, repite esos gates y
  actualiza el handoff sin segunda generación GLM ni segundo repair.
- El route conserva únicamente exports válidos de Next; la factory testeable
  vive en `curate-post-handler.ts`. Sólo se inyectan bordes externos de
  modelo/render/storage. Telemetría redacted de fallos pagados se vacía antes
  de responder; entrega se registra después de proyecto y débito, antes del
  único preview/done. Ningún programa, prompt, copy, HTML, screenshot, URL
  privada o identidad entra al evento Fable.
- El import graph transitive/type-only bloquea `analyze-intent`,
  `generate-page-copy` y los proveedores Gemini text/vision, manteniendo
  alcanzable únicamente el provider Gemini de assets. Whole-template sigue
  fuera del grafo ejecutable.

### Expansión mínima exacta

Nuevos adaptadores/raíz/prueba de route:

- `lib/curate/fable-input-adapters.ts`
- `lib/curate/fable-input-adapters.test.ts`
- `lib/curate/fable-adaptive-pipeline.ts`
- `lib/curate/fable-adaptive-pipeline.test.ts`
- `lib/curate/curate-post-handler.ts`
- `lib/curate/curate-route.fable.integration.test.ts`

Costura Task 3/4 y pruebas requeridas:

- `lib/generation/adaptive-section-composition.ts`
- `lib/generation/adaptive-section-composition.test.ts`
- `lib/generation/section-composition-contracts.ts`
- `lib/generation/section-composition-contracts.test.ts`
- `lib/curate/ai-hybrid-regression.test.ts`
- `lib/generation/ai-hybrid-niche-cohort.test.ts`

### RED/GREEN y verificación final

RED genuinos preservados/agregados: módulo de raíz ausente; fallback de copy
en fallos; import transitive a Gemini text; `applyDelta` inexistente; rechazo
de procedencia original all-generated; y `POST` real incapaz de recorrer
Qwen/commit con atomicidad. La integración real cubre accept, repair una vez,
reject pagado, fallo pagado del provider y configuración faltante fail-closed,
sin red, DB, navegador ni modelo reales.

```text
npm.cmd test -- lib/ai/qwen-visual-critic.test.ts lib/generation/glm-visual-repair.test.ts lib/generation/fable-generation-telemetry.test.ts lib/curate/run-ai-creation.test.ts lib/curate/quick-section-composition.test.ts lib/curate/quick-visual-repair.test.ts lib/generation/asset-pipeline.test.ts lib/curate/curate-route.integration.test.ts lib/curate/ai-hybrid-import-boundary.test.ts
# 9 archivos, 110 tests: PASS

npm.cmd test -- lib/curate/fable-input-adapters.test.ts lib/curate/fable-runtime-composition.test.ts lib/curate/fable-adaptive-pipeline.test.ts lib/curate/curate-route.fable.integration.test.ts lib/generation/adaptive-section-composition.test.ts lib/generation/section-composition-contracts.test.ts
# 6 archivos, 27 tests: PASS

npm.cmd run generation:ai-hybrid:gate
# 20 archivos, 263 tests: PASS

npm.cmd run generation:visual-engine-assets:gate
# 21 archivos, 347 tests: PASS

npm.cmd run typecheck
# PASS

git diff --check
# PASS
```
