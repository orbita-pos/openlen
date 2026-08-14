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

## Fix Round 1/5 — review blockers (2026-08-13)

Esta sección sustituye las afirmaciones anteriores sobre el gate visual y la
compensación de persistencia. El POST ya no usa insert/debit/delete: proyecto y
cobro se confirman mediante una sola sentencia PostgreSQL.

### RED observado

- El bloque inicial de cinco suites tuvo 13 fallos genuinos de 67 pruebas: un
  score 1/10 y issues major/critical podían aceptar; una captura no vacía podía
  ocultar geometría inválida; `fullPage` era falso; scout/page-plan perdían la
  traza de intentos pagados; y assets se resolvían después de compilar.
- La unidad atómica empezó RED por módulo ausente. Después, la prueba de saldo
  insuficiente quedó 1 RED de 8 porque el CTE todavía permitía clamping desde un
  saldo menor al cargo.
- La prueba de orden Task 4 quedó 1 RED de 12 al exigir entrega inmediata de la
  traza GLM antes de Gemini y antes de cualquier compilación.

### GREEN productivo

- El gate final exige decisión `accept`, los seis scores >= 7,
  `wrongNiche=false`, `genericAiStyle=false`, cero issues major/critical y cero
  fallos deterministas. Los JPEG desktop/mobile son de página completa. Overflow
  y geometría provienen de dos lecturas del renderer; nunca del tamaño del
  screenshot. Un fallo determinista corta antes de Qwen.
- Task 4 prepara una sola vez todos los programas GLM, registra cada intento al
  retorno, recolecta los slots usados y sólo entonces invoca el resolver Gemini.
  El binder aplica las refs validadas a los bytes que posteriormente pasan por
  compile, semantic/assets, render desktop/mobile, sanitize, assemble y seal.
  `applyDelta` reutiliza el binder y recompila sólo IDs válidos afectados, sin
  otra generación inicial ni segundo repair.
- Intent, copy, scout, page-plan, programas, imagen, crítico y repair comparten
  el único `PageBudget`/cliente creado por el runtime antes de la primera llamada
  pagada. Los fallos pagados se registran antes del flush; delivery-gate usa su
  stage propio. El grafo conserva una única ruta Gemini positiva, image-only, y
  bloquea proveedores Gemini text/vision y whole-template.
- `commitCurateProjectAndDebit` valida entrada y serialización antes de tocar DB
  y ejecuta un único writable CTE: `UPDATE ... WHERE credits >= charge RETURNING`
  alimenta `INSERT ... SELECT ... RETURNING`. Usuario ausente, saldo insuficiente
  o fallo de INSERT producen error tipado y cero mutación parcial; saldo exacto
  termina intencionalmente en cero. El route calcula créditos y valida el
  documento antes de invocarlo. Telemetría delivered y el único preview/done se
  emiten sólo después del commit atómico; toda excepción de cálculo, validación
  o commit emite primero telemetría failed y deja cero proyecto/cobro/preview.
- La integración POST usa la raíz por defecto real y sólo sustituye transportes,
  renderer, storage, catálogo y commit externos. Prueba un slot de imagen hybrid,
  una llamada Gemini (máximo tres), fixtures JPEG decodificables 64x64, tres
  programas GLM antes de imagen, ambos screenshots entregados a Qwen, accept y
  un único repair, rechazo/fallo pagado y configuración faltante fail-closed.

### Alcance exacto

Producción modificada:

- `lib/ai/qwen-visual-critic.ts`
- `lib/ai/visual-quality-renderer.ts`
- `lib/curate/atomic-curate-commit.ts` (nuevo)
- `lib/curate/curate-post-handler.ts`
- `lib/curate/fable-adaptive-pipeline.ts`
- `lib/curate/fable-final-visual-gate.ts`
- `lib/curate/fable-runtime-composition.ts`
- `lib/curate/run-ai-creation.ts`
- `lib/generation/adaptive-section-composition.ts`
- `lib/generation/fable-generation-telemetry.ts`

Pruebas modificadas/nuevas:

- `lib/ai/qwen-visual-critic.test.ts`
- `lib/ai/visual-quality-renderer.test.ts`
- `lib/curate/ai-hybrid-import-boundary.test.ts`
- `lib/curate/ai-hybrid-regression.test.ts`
- `lib/curate/atomic-curate-commit.test.ts` (nuevo)
- `lib/curate/curate-route.fable.integration.test.ts`
- `lib/curate/curate-route.integration.test.ts`
- `lib/curate/fable-adaptive-pipeline.test.ts`
- `lib/curate/quick-visual-repair.test.ts`
- `lib/curate/run-ai-creation.test.ts`
- `lib/generation/adaptive-section-composition.test.ts`
- `lib/generation/ai-hybrid-niche-cohort.test.ts`

Documentación: este reporte y `progress.md`. No se modificó ningún archivo
ajeno ni se ejecutó red, DB, navegador/modelo real, publicación o deploy.

### Verificación final

```text
9 suites Task 5 obligatorias: 120/120 PASS
8 suites enfocadas runtime/adapters/Task4/atomic/renderer/POST: 53/53 PASS
generation:ai-hybrid:gate: 20 archivos, 266/266 PASS
generation:visual-engine-assets:gate: 21 archivos, 350/350 PASS
typecheck: PASS
git diff --check: PASS
```

Auditoría de privacidad: el evento Fable sólo admite stage, reasonCode,
modelId, usage, duration, attempts y costo agregado. No se añadieron programas,
prompts, copy, HTML, screenshots, cuerpos raw, URLs privadas ni identidad a
telemetría o a este reporte.

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
