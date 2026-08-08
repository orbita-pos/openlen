# OpenLen Visual Engine 2A — cohorte válida para el piloto de skeletons

> **Estado:** aprobado conceptualmente por Jesús el 2026-08-08
>
> **Alcance:** corregir exclusivamente el dataset y el preflight del piloto 2A; no cambiar scoring, thresholds, metadata publicada, compilador, entrega Quick ni gates de aceptación
>
> **Base:** `docs/superpowers/specs/2026-08-05-openlen-visual-engine-2a-design.md` y `docs/generation/visual-engine-2a-runbook.md`

## 1. Resultado que obliga a corregir el piloto

El 2026-08-08 se ejecutó, con autorización explícita, el preflight live de 2A sobre las 30 filas de `SELECTOR_CASES + SELECTOR_HOLDOUT_CASES`, multiplicadas por los cinco escenarios visuales existentes. El agregado observado fue:

```json
{
  "pool": 150,
  "analyzed": 150,
  "selectionFailures": 5,
  "templateSkeleton": 2,
  "templateFull": 0,
  "sectionComposition": 143,
  "safeFailure": 0,
  "scratchControlled": 0
}
```

El runner se detuvo antes de reservar adaptaciones. La inspección posterior confirmó `2a.used = 0`, cero filas en `visualEnginePilotRuns` y el schema de privacidad exacto.

Este resultado no demuestra que el selector sea incorrecto. Los 30 briefs originales se diseñaron para medir clasificación, filtros duros y abstención ante categorías incompatibles. Una salida dominante `section_composition` es coherente con ese propósito. El defecto es reutilizar ese dataset adversarial como si fuera una población de estructuras ya compatibles para probar `template_skeleton`.

## 2. Decisión

Separar definitivamente dos evaluaciones:

1. **Dataset de selección segura.** `SELECTOR_CASES` y `SELECTOR_HOLDOUT_CASES` permanecen sin cambios y siguen midiendo intención, filtros duros, abstención y selección prohibida.
2. **Cohorte de adaptación 2A.** Un contrato nuevo y versionado contiene únicamente casos donde la estructura de uno o más templates revisados es compatible, pero su identidad visual está por debajo del umbral de template completo y debe transformarse.

No se bajarán `DEFAULT_THRESHOLDS`, no se cambiará la taxonomía para fabricar elegibilidad y no se editará metadata publicada como parte automática de esta corrección. Una inexactitud real de metadata requerirá evidencia visual, revisión humana y un cambio separado y auditable.

## 3. Opciones descartadas

### 3.1 Bajar thresholds

Descartado. Convertiría candidatos estructuralmente débiles o de audiencia incompatible en skeletons y destruiría la propiedad de abstención que el programa intenta preservar.

### 3.2 Etiquetar más templates hasta alcanzar 75

Descartado como mecanismo de cuota. La metadata describe capacidades reales; no es una palanca para hacer pasar un piloto. Solo se corrige cuando la captura, el DOM y la revisión humana demuestran que el valor vigente es falso.

### 3.3 Saltar 2A y consumir 2B

Descartado. El preflight confirma que 2B será importante, pero no prueba que el compilador de skeletons funcione. La reserva `2b=75` permanece intacta hasta que 2A produzca evidencia válida o una decisión futura cancele explícitamente 2A.

## 4. Cohorte 2A versionada

### 4.1 Tamaño y estratos

La cohorte contiene exactamente **15 casos base**, tres por cada arquetipo estratégico:

1. infantil creativo;
2. restaurante/hospitality;
3. wellness;
4. SaaS técnico;
5. portfolio editorial.

Cada caso se expande con los cinco escenarios ya aprobados:

- `accessible-generous-spacing`;
- `anti-generic`;
- `identity-before-copy`;
- `plain`;
- `saved-brand-accent`.

El resultado es exactamente **75 filas predeclaradas**. No existen filas de reemplazo y no se seleccionan casos después de observar calidad visual.

La distribución lingüística es exacta: ocho casos en español y siete en inglés. Dentro de cada arquetipo habrá un brief corto, uno medio y uno detallado. La cohorte completa debe cubrir producto, servicio, comercio y contenido; presencia y ausencia de marca se cubren mediante los escenarios. La decisión de calificación y la decisión live deben usar al menos diez templates distintos, y ningún template puede representar más de dos casos base.

### 4.2 Límites de representación

2A prueba únicamente situaciones donde OpenLen ya posee una estructura reutilizable. No debe fingir cobertura para productos que necesitan composición.

En particular, el brief complejo “plataforma infantil de coloreo con galería, minijuegos, cuentos y actividades creativas” continúa en `section_composition` y pertenece a 2B. Los casos infantiles de 2A serán sitios con estructura existente —por ejemplo, landing de un club creativo, colección de imprimibles o presentación de una experiencia infantil— y no una plataforma multirrol artificialmente comprimida en un template.

### 4.3 Contrato por caso

El archivo de cohorte exportará un contrato readonly equivalente a:

```ts
interface VisualEngine2APilotCase {
  id: string;
  datasetVersion: "visual-engine-2a-cohort/1.0";
  archetype:
    | "children_creative"
    | "restaurant_hospitality"
    | "wellness"
    | "technical_saas"
    | "editorial_portfolio";
  language: "es" | "en";
  brief: string;
  expectedIntent: IntentAnalysis;
  allowedSkeletonTemplateIds: readonly string[];
  identityConflict: {
    structuralPattern: string;
    baselineIdentity: string;
    requestedIdentity: string;
  };
  requiredVisualSignals: readonly string[];
  forbiddenVisualSignals: readonly string[];
  structuralRationale: string;
}
```

Los briefs son sintéticos y se versionan en Git. No contienen usuarios, proyectos, negocios reales, correos, URLs privadas ni datos de producción.

`allowedSkeletonTemplateIds` no fuerza al selector a elegir un template. Es una aserción de auditoría: si el selector live escoge un template fuera del conjunto revisado, el preflight falla antes de reservar.

## 5. Construcción y aprobación de la cohorte

Para cada uno de los 15 casos:

1. Proponer el brief y `expectedIntent` sin ejecutar el modelo live.
2. Calcular ranking y decisión con `rankTemplates()` y `decideGenerationRoute()` sobre la metadata revisada vigente.
3. Exigir que la decisión determinista sea `template_skeleton` con thresholds de producción sin overrides.
4. Exigir para cada template permitido:
   - metadata presente y `reviewStatus = reviewed`;
   - `themeability = high`;
   - `structuralFit >= 0.75`;
   - `identityFit < 0.80`;
   - `adaptationCost <= 0.60`;
   - cero filtros duros;
   - inventario de skeleton construible;
   - ausencia de señales prohibidas no reemplazables ligadas al DOM.
5. Revisar la captura del template y documentar por qué la estructura es útil y qué identidad debe eliminarse.
6. Aprobar humanamente el manifest completo antes de cualquier preflight live.

Si no existen tres casos honestos para uno de los cinco arquetipos, la cohorte no se completa. No se sustituye el arquetipo silenciosamente, no se baja el umbral y no se añade metadata conveniente. Ese resultado vuelve a decisión de producto y puede justificar adelantar el diseño de 2B, pero no autoriza gastar su reserva.

## 6. Gate no-live obligatorio

Un comando nuevo, sin API key ni llamadas de modelo y con acceso **read-only** al catálogo de la base aprobada, valida el contrato completo sobre el commit candidato:

- versión exacta del dataset;
- 15 IDs únicos;
- tres casos por arquetipo;
- combinación lingüística declarada;
- cinco escenarios y 75 filas exactas;
- briefs no vacíos y libres de firmas de PII/secretos/HTML;
- templates permitidos únicos, publicados, revisados y de themeability alta;
- decisión `template_skeleton` para los 15 `expectedIntent`;
- template elegido dentro de `allowedSkeletonTemplateIds`;
- invariantes de score y filtros duros;
- inventario construible;
- al menos diez templates seleccionados y máximo dos casos base por template;
- hashes canónicos de la metadata, HTML e inventario de cada template permitido;
- fingerprint agregado del catálogo exacto usado para calificar;
- hash SHA-256 canónico del manifest.

El comando escribe únicamente un agregado ignorado bajo `scratch/visual-engine-2a/`. No escribe briefs, intents completos ni metadata en el ledger.

El preflight live se niega a iniciar si falta este artefacto, si su hash no coincide con el source actual, si el catálogo/HTML/inventario cambió o si el commit cambió después de crearlo. El comando de calificación no ejecuta `INSERT`, `UPDATE`, `DELETE`, DDL, reserva ni completion.

## 7. Preflight live corregido

Después de un gate no-live verde y una autorización pagada nueva, el runner analiza las 75 filas con el proveedor configurado.

Para continuar al primer `reserve()` deben cumplirse simultáneamente:

- 75/75 análisis terminados;
- cero `selectionFailures`;
- 75/75 rutas `template_skeleton`;
- cada template elegido pertenece al allowlist del caso correspondiente;
- mismas versiones de dataset, prompt, policy, taxonomy y metadata usadas por el gate no-live;
- mismos hashes del manifest, catálogo, metadata, HTML e inventarios;
- al menos diez templates seleccionados y máximo dos casos base por template;
- cuota `2a=75, used=0` y cero runs 2A.

Una sola desviación detiene el proceso antes de reservar. No se acepta `template_full`, `section_composition`, `safe_failure`, `scratch_controlled`, un template fuera del manifest ni un resultado fallido.

El resultado live no modifica automáticamente `expectedIntent` ni el allowlist. Corregir un caso requiere una nueva versión de cohorte, revisión y autorización; nunca se edita el dataset para acomodar la respuesta ya observada.

## 8. Coste y evidencia del preflight

El intento inicial demostró que un preflight puede consumir llamadas pagadas aunque no consuma cuota de adaptaciones. La nueva versión ampliará el usage tipado de análisis de intención para conservar `promptTokenCount`, `candidatesTokenCount`, `cachedContentTokenCount` y `thoughtsTokenCount` cuando el proveedor los reporte. Después acumulará ese usage seguro y producirá un reporte local ignorado con:

- dataset version y hash;
- commit SHA;
- modelo, prompt, policy y taxonomy versions;
- rate-card version y FIX fechado;
- conteos por ruta y fallo;
- input, output, cached y thinking tokens agregados cuando el proveedor los reporte;
- coste agregado calculado con la rate card congelada;
- duración agregada;
- `reservationCount`, que debe permanecer en cero durante todo el preflight.

El reporte no contiene briefs, HTML, copy, intents, respuestas crudas, errores crudos, claves, paths absolutos ni identidad del revisor.

Un usage ausente se marca como evidencia de coste incompleta; no se convierte en cero. El runner puede detenerse de forma segura, pero no puede presentar ese preflight como coste medido.

## 9. Ejecución de las 75 adaptaciones

Si el preflight live pasa, el mismo proceso continúa con las 75 filas predeclaradas. Se conservan sin cambios:

- reserva atómica inmediatamente antes de la llamada creativa;
- cero retries creativos;
- baseline Quick weighted real;
- candidate skeleton aislado en `shadow`;
- crítico diagnóstico;
- render baseline/candidate en versión normal y con copy neutralizado según el contrato 2A vigente;
- fingerprints estructurales;
- evidencia hash-bound;
- completion exactly-once;
- comparación humana ciega;
- no persistencia del candidato;
- no débito creativo al usuario.

No se repone una fila fallida. Las 75 reservas siguen siendo el denominador técnico.

## 10. Gates de éxito sin cambios

2A solo pasa si cumple todos los gates ya aprobados:

- exactamente 75 starts;
- al menos 72 éxitos técnicos;
- revisión ciega de todos los éxitos técnicos;
- al menos 90% de preferencia por 2A entre candidatos comparables;
- cero cambios de estructura protegida;
- cero persistencias parciales;
- cero señales prohibidas en resultados aceptados;
- coste medio production-equivalent estrictamente menor a MXN 0.40;
- cobertura de coste completa en los 75 starts;
- rollback verificado.

La cohorte dirigida limita la conclusión: demuestra que OpenLen puede cambiar identidad cuando existe una estructura compatible. No demuestra que el catálogo cubra cualquier producto ni que `section_composition` esté listo. Esa conclusión pertenece a 2B.

## 11. Seguridad y privacidad

- La cohorte es sintética y pública dentro del repositorio.
- El proveedor recibe únicamente el contenido ya autorizado para el piloto: briefs sintéticos, metadata permitida, HTML/copy de templates y capturas de candidatos durante las etapas que correspondan.
- El gate de calificación no usa proveedor y accede al catálogo/HTML de la DB únicamente en modo read-only.
- El preflight live no escribe runs ni consume cuota.
- El ledger conserva su allowlist escalar actual; no se añaden briefs, case IDs ni payloads.
- Manifest, preflight report, imágenes, reviewer session y scorecard permanecen bajo `scratch/visual-engine-2a/`, ignorado por Git.
- Cada segunda ejecución pagada requiere autorización explícita del usuario aunque la anterior se haya detenido antes de reservar.

## 12. Manejo de fallos

| Condición | Resultado obligatorio |
| --- | --- |
| Cohorte inválida o hash distinto | Detener antes de red/DB |
| Template eliminado, no publicado o metadata distinta | Detener en el gate no-live |
| Menos de 75 skeletons live | Detener antes de reservas |
| Template live fuera del allowlist | Detener antes de reservas |
| Usage incompleto | Marcar coste incompleto; no inventar cero |
| Cuota distinta de `75/0` o runs existentes | Detener antes de proveedor de adaptación |
| Fallo después de reservar | Completar con reason code o dejar stale para abandono; nunca reclamar cuota |
| Gate final fallido | Corregir 2A y pedir nueva decisión presupuestaria; no consumir 2B |

## 13. Pruebas requeridas

### Unitarias

- schema y cardinalidad 15×5;
- distribución exacta 3×5 arquetipos;
- IDs/versiones/allowlists únicos;
- detección de PII, HTML y secretos en briefs/racionales;
- manifest canónico y hash estable;
- invalidación por cualquier byte/version/template/metadata diferente;
- validación de scores y hard filters sin thresholds inyectados;
- uso agregado con missing usage explícito;
- DTO de reporte sin contenido sensible.

### Integración

- gate de calificación contra metadata y HTML publicados reales, con DB read-only y sin proveedor;
- preflight live simulado 75/75 que no llama `reserve` antes del último resultado;
- una de 75 rutas incorrecta produce cero reservas;
- template fuera del allowlist produce cero reservas;
- selección fallida produce cero reservas;
- hash stale produce cero llamadas live;
- camino 75/75 continúa exactamente una vez al runner de adaptaciones;
- selector adversarial existente permanece sin cambios y conserva sus gates.

### Operativas

- full Vitest y typecheck;
- rollback determinista vigente;
- `git diff --check`;
- auditoría de que no se staged `.env*`, reportes, imágenes, sesiones ni identidad;
- consulta DB confirma `2a.used=0` antes de una futura ejecución autorizada.

## 14. Rollout y autorizaciones

Implementar esta corrección no autoriza llamadas pagadas. El orden posterior es:

1. aprobar y commitear cohorte + gates;
2. ejecutar gate no-live;
3. revisar manifest y templates permitidos;
4. verificar código, privacidad y cuota cero;
5. congelar nuevamente precios oficiales y FIX vigente;
6. solicitar autorización explícita para una segunda ejecución pagada y sus payloads;
7. ejecutar una sola vez;
8. hacer revisión ciega y scorecard;
9. decidir rollout `skeleton` o diseño 2B.

`OPENLEN_VISUAL_ENGINE` permanece `off` por defecto. Ningún commit de esta corrección habilita `shadow` o `skeleton` globalmente.

## 15. Nivel de certeza

- **Alto:** la separación entre selección adversarial y adaptación dirigida corrige la contradicción observada sin debilitar thresholds.
- **Alto:** el gate no-live, allowlists predeclarados y hash impiden seleccionar casos después de observar calidad.
- **Medio:** los 15 briefs podrán producir 75/75 rutas live estables; debe probarse primero en el gate no-live y después mediante un único preflight autorizado.
- **Bajo hasta obtener evidencia:** preferencia visual, tasa técnica y coste real de las adaptaciones.
