# Creación con IA mediante composición híbrida obligatoria — diseño

**Fecha:** 2026-08-11
**Estado:** aprobado por Jesús Bernal en sesión
**Producto:** OpenLen Visual Engine

## Problema

OpenLen tiene dos intenciones de usuario diferentes que hoy pueden terminar compartiendo el mismo resultado técnico:

1. **Usar un template:** el usuario elige deliberadamente una página curada y espera conservarla.
2. **Crear con IA:** el usuario describe un producto y espera una página nueva cuya estructura, contenido e identidad respondan al brief.

La ruta Quick todavía permite que un fallo del análisis seguro o de la composición termine en un template completo elegido por el selector legacy. El proyecto `05eed56e-8f6a-4742-8ff2-2eb1eeabe96a` reprodujo el defecto: un brief infantil de coloreo terminó como Lyceum, una plataforma de tutoría que conservaba escuelas, pricing, estándares educativos y ejemplos SDK en Python, JavaScript y cURL.

La causa de producto no es que el template sea feo. Es que un fallback pensado para garantizar una entrega bonita puede contradecir la intención del usuario y borrar la diferencia entre “crear” y “clonar”.

## Decisión de producto

La separación es absoluta:

- **Usar este template** puede clonar un template completo mediante la ruta explícita de templates.
- **Crear con IA** solo puede entregar una composición híbrida construida a partir de secciones independientes.
- La creación con IA no puede entregar `weighted`, `template_full`, `template_skeleton` ni un template completo como fallback.
- Si no puede construir y validar una composición, falla de forma cerrada: no muestra un documento incorrecto, no crea el proyecto y ofrece reintentar.

Esta regla es un invariante de producción, no una preferencia controlada únicamente por un feature flag. Un kill switch puede deshabilitar temporalmente la creación con IA, pero no puede reactivar el fallback a templates completos.

## Objetivos

1. Garantizar que ninguna creación con IA persista HTML proveniente de un template completo.
2. Conservar la calidad estructural de la biblioteca curada mediante el ensamblador de secciones 2B.
3. Mantener el Visual Engine como autoridad de identidad: dirección creativa, design tokens, tipografías, geometría, assets y revisión 2C.
4. Eliminar la influencia del catálogo de templates completos sobre la generación de copy.
5. Hacer observable cualquier fallo sin guardar prompts, HTML, respuestas crudas ni datos privados.
6. Evitar cobros al usuario cuando no se entrega una página.

## No objetivos

- Eliminar o degradar la galería de templates.
- Cambiar el comportamiento de `/api/projects/from-template` cuando el usuario elige explícitamente un template.
- Generar páginas completamente desde cero con HTML libre del modelo.
- Rehacer 2A, 2B, 2C, el motor de assets, el HTML Engine o el Agent Engine.
- Introducir un nuevo proveedor de IA en esta corrección.

## Arquitectura

### 1. Dos comandos, dos contratos

#### Clonación explícita

`POST /api/projects/from-template` conserva su contrato actual:

- entrada: `templateId` elegido por el usuario;
- fuente estructural: HTML completo del template;
- resultado: clon normalizado, sanitizado y sembrado con el perfil;
- se permite conservar identidad, orden de secciones y estructura del template.

#### Creación con IA

`POST /api/curate` adopta un contrato de entrega más estrecho:

```text
AiCreationResult =
  | { ok: true; route: "section_composition"; html; visualEngine }
  | { ok: false; stage; reasonCode; retryable }
```

No existe una variante exitosa con template ID completo. En producción, la ruta no importa ni invoca `pickWeighted`, `runSkeletonCandidate`, `fillAndNormalizeCuratedTemplate` ni `weightedFallback` como mecanismos de entrega.

Los helpers legacy pueden permanecer mientras los necesiten pruebas históricas, migraciones o herramientas internas, pero dejan de ser alcanzables desde la creación con IA.

### 2. Planner de copy desacoplado

El actual “cheap brain” combina dos responsabilidades: elegir templates completos y generar copy. La creación híbrida deja de enviarle el catálogo de templates.

Se introduce un límite conceptual `generatePageCopy(brief)` que:

- recibe únicamente el brief y el contrato permitido de copy;
- no recibe IDs, nombres, pitches, screenshots ni descripciones de templates;
- devuelve `ExtractedBusinessData` validado y usage redactado;
- falla de forma tipada ante ausencia de clave, timeout, HTTP, parseo o schema inválido.

`analyzeIntent(brief)` y `generatePageCopy(brief)` comienzan en paralelo. Ambos deben completarse correctamente antes de ensamblar secciones.

### 3. Pipeline de composición

```text
brief
  ├─ analyzeIntent
  └─ generatePageCopy
          ↓ barrera: ambos válidos
buildSectionCompositionInventory
          ↓
planSectionComposition
          ↓
resolveSectionPlan + fetchVerifiedSectionFragments
          ↓
assembleDocument
          ↓
fillAssembled
          ↓
normalizeBornCanonical
          ↓
adaptTemplateSkeleton sobre el documento ensamblado
  (dirección creativa + tokens + tipografía + geometría + assets)
          ↓
gate semántico y de procedencia
          ↓
revisión visual 2C
          ↓
preview final + persistencia atómica + débito
```

`adaptTemplateSkeleton` se reutiliza como compilador visual sobre el documento ensamblado. No implica permitir la entrega de un skeleton completo.

### 4. Gate de procedencia y coherencia

Antes del primer preview y de la persistencia, el resultado debe cumplir todo lo siguiente:

1. `visualEngine.route === "section_composition"`.
2. `templateId === null` en metadata persistida.
3. El `compositionManifest` valida con schema estricto y tiene `resultCode === "composed"`.
4. Roles, section IDs, content hashes y compatibility rules tienen longitudes alineadas.
5. Los roles del HTML coinciden exactamente y en orden con el manifest.
6. El output hash coincide con el HTML entregado.
7. No quedan fugas de copy heredado después de `fillAssembled`.
8. Existe exactamente un marcador de dirección creativa válido.
9. Manifest y trace de assets aparecen como pareja válida o no aparecen.
10. El resultado final conserva los invariantes sanitarios, estructurales y visuales existentes.

La ruta de IA no tiene acceso a un template HTML completo, por lo que una marca como Lyceum no puede entrar por fallback. Las comprobaciones de copy heredado continúan protegiendo contra texto demo proveniente de fragmentos individuales.

### 5. Revisión 2C

2C solo recibe candidatos que ya pasaron composición y procedencia. Si el repair es aceptado, se persiste el HTML reparado y su metadata. Si el candidato o su reparación no alcanzan los requisitos definidos por el gate visual, la creación falla; no se sustituye por un template.

La revisión visual no es responsable de rescatar rutas legacy. Su función permanece acotada a calidad, legibilidad, geometría, overflow, coherencia temática y mejora visual del candidato híbrido.

## Errores y experiencia de usuario

Los fallos internos se reducen a etapas y razones tipadas, por ejemplo:

- `intent_analysis_failed`
- `copy_generation_failed`
- `section_inventory_unavailable`
- `section_plan_failed`
- `section_fragment_unavailable`
- `composition_failed`
- `inherited_copy_leak`
- `creative_direction_failed`
- `asset_resolution_failed`
- `semantic_gate_failed`
- `visual_quality_failed`
- `persistence_failed`

Comportamiento obligatorio para cualquier fallo anterior:

- cero preview de HTML parcial o legacy;
- cero fila de proyecto si la persistencia no comenzó;
- cero débito de créditos de creación;
- cero retry automático de llamadas pagadas;
- evento SSE de error estable y redactado;
- mensaje al usuario: “No pudimos construir una página coherente. Reintentar”.

La telemetría interna puede conservar: etapa, reason code, versiones de contratos, IDs de secciones, hashes, usage, costo calculado y duración. No puede conservar: brief, copy, HTML, prompts, respuesta cruda, URLs privadas, credenciales ni identidad del usuario.

## Atomicidad

El primer preview ocurre únicamente después de pasar todos los gates. La persistencia conserva el patrón actual de documento final único. El débito ocurre después de persistir correctamente.

Si falla DB después de producir el candidato, la ruta devuelve `persistence_failed`, no emite `done` y no debita. La creación de versión y thumbnail sigue siendo trabajo posterior no bloqueante, como en el flujo actual.

## Rollout y rollback

1. Implementación local con TDD y gates completos.
2. Smoke determinista sin red ni DB.
3. Deploy con la composición híbrida obligatoria activada para Quick IA.
4. Cohorte live limitada y explícitamente presupuestada antes de ejecutarse.
5. Observación de errores tipados y tasa de éxito.

El rollback seguro deshabilita temporalmente “Crear con IA” y conserva “Usar este template”. Nunca vuelve a habilitar el fallback legacy dentro de Quick.

## Estrategia de pruebas

### Contratos estructurales

- La ruta de creación con IA no puede construir un resultado exitoso `weighted`, `template_full` o `template_skeleton`.
- Ningún fallo de intent, copy, inventario, fragmento, fill, adaptación, assets, gate o repair invoca el cargador de templates completos.
- Ningún fallo emite preview, persiste proyecto o debita créditos.
- `/api/projects/from-template` sigue clonando un template elegido explícitamente.
- Un resultado exitoso siempre persiste `section_composition`, `templateId: null` y manifest válido.

### Regresiones de nicho

La cohorte mínima incluye:

| Caso | Identidad esperada | Confusión que debe impedirse |
|---|---|---|
| Coloreo infantil | creativa, mágica, ilustrada, redondeada | tutoría, escuela genérica, SDK/code snippets |
| Terror | cinematográfica, inquietante, oscura | videojuego genérico o SaaS oscuro |
| Comedia | enérgica, humana, irreverente | evento corporativo genérico |
| Videojuego | interactiva, inmersiva, orientada al juego | developer tool o documentación |
| Escuela | educativa, confiable, clara | curso SaaS para adultos |
| Cocina | sensorial, editorial, gastronómica | ecommerce o wellness genérico |
| Venta de producto | conversión, producto, confianza | landing SaaS sin producto tangible |

Cada fixture verifica intención, roles planeados, procedencia por secciones, dirección creativa, ausencia de señales prohibidas y metadata final. La regresión de coloreo incluye explícitamente ausencia de `Lyceum`, `Python`, `JavaScript`, `cURL`, estándares escolares y pricing de tutoría.

### Integración y release

- POST real con boundaries de auth, DB, proveedor, secciones, renderer y créditos inyectados.
- Matriz de fallos por etapa con atomicidad.
- Gate de assets y 2C existente.
- Typecheck, suite completa y rollback-check.
- Cohorte live de los siete casos solo después de configurar un límite de costo; una ejecución por caso, sin reintentos automáticos, artefactos y telemetría redactados.

## Criterios de aceptación

1. Es imposible alcanzar un template completo desde `Crear con IA` mediante pruebas y análisis estático del grafo de dependencias.
2. La regresión de Mundo Pincel no puede devolver Lyceum ni secciones SDK.
3. Todos los éxitos de Quick IA son `section_composition` con manifest válido.
4. Todos los fallos son cerrados, observables y no cobran créditos.
5. Clonar un template explícitamente conserva su comportamiento actual.
6. Los siete casos de la cohorte determinista pasan antes de cualquier canary live.
7. El gate completo, typecheck y rollback-check están verdes antes del deploy.
