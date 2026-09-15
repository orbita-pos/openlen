# Len no pierde nada — informe

**Sesión 2026-09-14.** Encargo: los siete invariantes de
`PROMPT-len-no-pierde-nada.md`, cada uno con su prueba que primero falla y luego
pasa, sin fiarme del documento.

**Cero llamadas pagadas.** No se corrió ningún modelo, ninguna batería, ningún
turno de Len. No hay commit, ni push, ni deploy.

**Producción: leída con tu permiso y SÓLO LECTURA** — identidad impresa antes de
nada y `set default_transaction_read_only = on` en todas las consultas. Ni un
`insert`, ni un `update`, ni una migración. Lo que salió de ahí está en la §6, y
cambia la respuesta a «por qué faltaban los modales».

---

## 1 · Lo REPRODUCIDO

**La reproducción del documento corre y da exactamente su salida.**

```
npx tsx --require ./scripts/test-node-server-only-shim.cjs --test scratch/repro-len-pisa-su-script.test.ts
```

```
[1] disco lleva 'nuevo': true | disco lleva 'viejo': false
[1] sesión.taggedHtml lleva 'nuevo': false | lleva 'viejo': true
[1] sesión.baseHtml   lleva 'nuevo': false | lleva 'viejo': true
[2] avisó «alguien editó la página»: true
[2] versiones: ["Before AI edit","Agente (0 ops + comportamiento): multi-deck","Tu edición, justo antes de que el Agente la pisara","Agente (1 ops): titular"]
[2] disco lleva 'nuevo': false | disco lleva 'viejo': true
```

Byte a byte lo que decía el documento. **El hallazgo 1 es cierto.**

Tras el arreglo, la misma reproducción sale verde y la fila falsa desaparece del
historial: `["Before AI edit", "Agente (0 ops + comportamiento): multi-deck",
"Before AI edit", "Agente (1 ops): titular"]`.

---

## 2 · Lo LEÍDO en el código

Verificado por símbolo (grep), no por número de línea.

- **Hallazgo 1 — CIERTO y más grande de lo que decía.** `persistPage` hace
  `input = {...input, html: aplicarIntentDeScript(input.html, intent)}` y
  devuelve ese `input.html`. `persistHtmlChange` re-etiquetaba con `finalHtml`
  —el de ANTES— y **lo devolvía también como `finalHtml`**, que sube a
  `updatedHtml`: o sea que el lienzo del taller también le estaba enseñando al
  usuario el documento de antes del guardado. El documento no menciona esa
  tercera consecuencia.
- **Hallazgo 2 — CIERTO.** `staleRuntimeRefs` sólo se calcula dentro de
  `persistPage` y su único destino era `data.degradations`. Al modelo le llegaba
  por `app/api/agent/route.ts:625` (`degradaciones: project.data?.degradations`),
  que se lee UNA vez al montar el turno. Turno siguiente, confirmado.
- **Hallazgo 3 — CIERTO.** `persistHtmlChange` guardaba igual y archivaba con
  `etiquetaPrevia`.
- **Hallazgo 4 — CIERTO.** `reetiquetar(session, activeHtml(...))` sin comparar,
  en `leer_estado` (dos ramas) y `buscar_en_pagina`. Y **hay un daño que el
  documento no nombra**: al mover `session.baseHtml` a lo del otro, esa lectura
  DESARMABA la detección de escrituras ajenas para el resto del turno.
- **Hallazgo 7 — CIERTO.** `DEFAULT_MAX_TOOL_CALLS = 10`,
  `ABSOLUTE_MAX_TOOL_CALLS = 20`, `DEFAULT_MAX_TURNS = 6`,
  `ABSOLUTE_MAX_TURNS = 12`.
- **Hallazgo 8 — CIERTO.** `degraded.title` = «Algunas cosas no se pudieron
  traer» se usa también para `runtime_stale`, en las 10 lenguas. **No lo he
  tocado**: es texto de producto y el encargo eran los invariantes.

---

## 3 · Lo que resultó FALSO del documento

**Hallazgo 5 — la frase que cita es falsa, y es una frase que vive en el
código.** El comentario de `lib/agent/tools.ts` decía: *«de los doce escritores
de `project.data`, el único con concurrencia optimista es el editor»*. Contados:

- Son **TRECE**, no doce.
- El del editor (`app/api/projects/[id]/html/route.ts`) **no tiene concurrencia
  optimista**: su `baseUpdatedAt` archiva y sobrescribe igual. Eso el documento
  sí lo decía bien por su cuenta.
- **El único con compare-and-swap de verdad es
  `app/api/projects/[id]/settings/route.ts`**, y además es el mejor escritor del
  repo: escribe con `jsonb_set` sobre la clave `settings` y sólo sobre ella, con
  CAS sobre el subárbol leído y un bucle de reintento con jitter. No puede pisar
  `html` ni queriendo.

Ese escritor es de donde salió el patrón de I4, no una excepción a él.

**Deriva encontrada de paso (sin arreglar, fuera de encargo):** el comentario de
la tarifa `deepseek-pro` en `lib/credits.ts` dice «El Agente, y SÓLO el Agente:
es el único papel que corre en Pro». Los TRES papeles de `model-policy.ts`
cobran `deepseek-flash`; el único que usa `deepseek-pro` es
`lib/agent/redesign.ts`, que se monta la tarifa fuera de la tabla.

---

## 4 · Claude Code — releído (2.1.270)

Leído con un extractor propio sobre los 227 MB. Las seis cosas que el documento
pedía verificar:

**1 · Tras su propio Write actualiza `readFileState` con lo que escribió — SÍ,
literal.** Es exactamente el fallo 1, resuelto al revés:

```js
let Le; await xe.recheckBeforeWrite();
try{ Le = await Gne(xe.ioPath, n, Ie, "LF") } catch(We){ throw bf(I), We }
if (d.set(I, {content: f_(n), timestamp: Le, offset: void 0, limit: void 0,
              ...(m||Ye)&&{contentNotInModelContext:!0}}), Ie==="utf8") Y9(I,n); else bf(I);
```

`d` es `readFileState`. `n` es el contenido **ya transformado** (`n = jet(I,n)`
unas líneas antes) y `Le` es el mtime que devuelve la escritura. Su línea base
sale de lo escrito, no de lo propuesto. Por eso sus escrituras no pueden
parecerle ajenas nunca.

**La línea base es contenido + bytes + sha256**, y la comparación también:

```js
function b(e){return{sha256:_("sha256").update(e,"utf8").digest("hex"),bytes:Buffer.byteLength(e,"utf8")}}
function $ot(e,n){return Buffer.byteLength(n,"utf8")===e.bytes&&b(n).sha256===e.sha256}
var A="File has been modified since read, either by the user or by a linter. Read it again before attempting to write it.";
```

**2 · Edit contra el disco actual — sí.** El guardia lee el fichero
(`readExisting()`) y llama a `VIo({fullFilePath, diskContent: Ae.content,
lastRead: d.get(I), …})`: compara el DISCO contra la línea base leída. La
variante empaquetada del sandbox lo hace explícito —lee, cuenta ocurrencias,
sustituye, escribe—.

**3 · Qué le dice al modelo cuando el fichero cambió — literal, y es I3:**

> «Note: ${filename} changed on disk since you last read it. That's usually
> deliberate, so take it as the current state rather than reverting it; if the
> change looks wrong, say so rather than undoing it yourself — otherwise no need
> to call it out.» + «Here are the relevant changes (shown with line numbers):»

**5 · Diagnósticos del mismo turno — confirmado.** Cadena literal
`<new-diagnostics>The following new diagnostic issues were detected:`.

**6 · Tope de pasos — SÍ, pero en los SUBAGENTES, no en el bucle principal.** El
atributo `max_turns_reached`, el log `[Agent: ${agentType}] Reached max turns
limit (${maxTurns})` y la telemetría `tengu_agent_max_turns_reached` cuelgan de
la ruta de agentes. El comentario de nuestro `loop.ts` («su bucle principal no
lleva tope») se sostiene con lo que vi.

**4 · Checkpoints y rewind: NO lo verifiqué.** No era necesario para ninguno de
los siete invariantes y no quise gastar más pasadas de 227 MB en algo que no
cambiaba una línea de código. **Queda sin confirmar.**

---

## 5 · Los siete invariantes

Un arreglo por invariante, cada uno con su prueba **roja antes, verde después**.

| | Qué cierra | Arreglo | Prueba |
|---|---|---|---|
| **I1** | Lo que Len recuerda = lo que se guardó | `persistHtmlChange` usa `saved.html` para re-etiquetar, para el atajo de ids y para lo que devuelve | `tools.test.ts` · «I1 · lo que Len recuerda…» (2) |
| **I2** | Nunca pisar lo que no se vio | Si el disco ≠ base, se **rechaza** con el documento fresco dentro del error y la sesión se muda a él | `tools.test.ts` · «I2 · nunca pisar…» (3) |
| **I3** | Nunca adoptar el disco en silencio | `refrescarDesdeDisco` compara, avisa con los dos índices, y sólo entonces adopta. Tres sitios, una función | `tools.test.ts` · «I3 · nunca adoptar…» (4) |
| **I4** | Todos los escritores con concurrencia optimista | `lib/projects/escribir-data.ts` — CAS sobre `updatedAt` en el `WHERE` + reintento. 13 escritores migrados | `escribir-data.test.ts` (5) + guardia de fuente `escritores-de-data.test.ts` (2) |
| **I5** | Diagnóstico en el mismo turno | `persistPage` devuelve `referenciasRotas`; `editar_pagina` y `cambiar_tema` lo cuentan en su propia respuesta | `tools.test.ts` · «I5 · el diagnóstico…» (2) |
| **I6** | Corte honesto | `finishOnCap` recibe, además de los hechos, si la ÚLTIMA escritura dejó la página rota | `loop.test.ts` · «I6 · al cerrar por tope…» (3) |
| **I7** | Todo lo sobrescrito sigue recuperable | El «antes» se archiva DESPUÉS de escribir y sale del documento que de verdad se pisó | `persist.test.ts` · «I7 · el punto de restauración…» (2) |

**Qué cubre cada prueba, en corto** (verde no es verificado):

- **I1** cubre que tras `editar_runtime` la sesión, la base y el **lienzo**
  llevan el script nuevo; y que la edición siguiente del mismo turno no avisa de
  nadie, no archiva con la etiqueta falsa, y no pierde el runtime. No cubre el
  orden exacto de llamadas del turno de Jesús.
- **I2** cubre que el disco queda byte-intacto, que no se guarda ni se archiva
  nada, que el documento fresco viaja etiquetado, y que el modelo **reaplica en
  el mismo turno** conservando lo del otro. Brazo de control incluido.
- **I3** cubre `leer_estado incluir_documento` y `buscar_en_pagina`, el brazo de
  control (disco == base ⇒ silencio), y que tras avisar **deja de avisar**.
  No cubre la rama `leer_estado op_id=` con una prueba propia — comparte función.
- **I4** cubre que el CAS vive en el `WHERE`, que perder el CAS no escribe nada,
  que «no existe» y «conflicto» se distinguen, y que **al reintentar no se
  revierte lo del otro** (el caso que importa: dos claves distintas del mismo
  blob). El guardia lee el fuente y falla si aparece un `UPDATE … SET data`
  nuevo fuera del primitivo. No es una prueba contra Postgres de verdad.
- **I5** cubre que borrar el elemento que el script busca sale en la MISMA
  respuesta, con el nombre del elemento, y el brazo de control.
- **I6** cubre que se nombra en el cierre, que **deja de nombrarse si la edición
  siguiente lo arregla**, y el brazo de control.
- **I7** cubre que el «antes» archivado es el documento del otro escritor (rojo
  con el código viejo: archivaba el de la lectura inicial) y que un guardado
  fallido no archiva nada (rojo con el orden viejo).

### Lo que cambió de comportamiento, dicho

- **`piso_edicion_del_usuario` desaparece.** Describía un hecho que ya no puede
  pasar. No tenía ningún consumidor fuera de `tools.ts` (comprobado en todo el
  repo), así que no toca la UI.
- **Se retiró la prueba `«avisa cuando el turno PISA una edición…»`**, que fijaba
  el comportamiento viejo. Lo que cubría lo cubre ahora el bloque I2, con el
  mismo montaje.
- **`PersistPageDeps.saveProjectData` y `AgentDeps.saveProjectData` reciben una
  FUNCIÓN**, no un blob, y **lanzan** si no pudieron escribir. El `void` de antes
  no sabía decir «no se guardó».
- **El «antes» se archiva después de escribir.** El motivo viejo («si el guardado
  falla la versión ya existe») dejó de valer al ser todo-o-nada: si el CAS no
  gana, no se escribió nada.

### Puertas

| | |
|---|---|
| `npx tsc --noEmit` | ✅ limpio |
| `npm test` (vitest) | ✅ **360 ficheros · 5.074 pruebas** |
| `npm run test:node` | ✅ **708 pruebas** |
| `npx next lint` | ✅ sin errores; los warnings son de hooks de React preexistentes, ninguno en fichero tocado |

Tres ficheros de prueba de rutas (`ai-design`, `autofill`, `apply-template`)
necesitaron que su doble de base de datos aprendiera el CAS (`select` con
`updatedAt`, `update…returning`). Eran 10 fallos; están explicados y verdes.

---

## 6 · PRODUCCIÓN — leída con tu permiso, sólo lectura

Identidad impresa antes de nada, y **todas** las consultas bajo
`set default_transaction_read_only = on`:

```
PostgreSQL 17.10 (Ubuntu 17.10-1.pgdg24.04+1) on x86_64-pc-linux-gnu · base: openlen
```

⚠️ **Otra cosa falsa del documento de traspaso, y es la peligrosa.** Dice: *«La
`DATABASE_URL` local **ES** producción»*. **No lo es.** La memoria
`database-url-local-es-produccion` lo corrigió el 31/08 tras medirlo: la local es
una Postgres de DESARROLLO en Windows (PG 17.4, x86_64-WINDOWS). Producción es
Ubuntu/PG 17.10 y se llega por `ssh openlen`. La regla operativa que el documento
saca de ahí («nunca `db:push`, nunca migraciones») sigue valiendo; la premisa no.

### El proyecto

`0f4b62c9-0a86-41bd-8afd-dad638101f52` — «Deckforge — Arma y ordena tus decks de
Yu-Gi-Oh!». Creado 22:38:41, última escritura 22:43:50. Cinco minutos, ocho
versiones, dos turnos.

| # | hora | bytes | `id="cName"` | `cHue` | `cLvl` | menciona cName | etiqueta |
|---|---|---|---|---|---|---|---|
| 1 | 22:38:41 | 40.840 | — | — | — | — | Generated |
| 2 | 22:40:14 | 41.610 | — | — | — | — | Agente (4 ops): barra de acciones, pestañas de deck **y modales** |
| 3 | 22:40:27 | 43.884 | — | — | — | — | estilos de modales, pestañas… |
| 4 | 22:40:56 | 50.668 | — | — | — | **sí** | comportamiento |
| 5 | 22:41:28 | 50.086 | — | — | — | sí | comportamiento |
| 6 | 22:42:04 | 50.016 | — | — | — | sí | 3 ops |
| 7 | 22:42:47 | 53.103 | **sí** | **sí** | **sí** | sí | **inserto los modales** |
| 8 | 22:43:18 | 53.187 | sí | sí | sí | sí | cableo los modales y blindo el script |

### Lo que esto dice, medido

**La hipótesis 6 del documento es FALSA, en sus dos variantes.** Los modales no
se perdieron: **nunca estuvieron**. No aparecen en ninguna versión guardada antes
de la 7, que es el turno 2. Nada los borró porque nada los escribió.

- La versión 2 dice en su etiqueta «y modales» y **no contiene ni uno**. Esa
  etiqueta es el `resumen` del modelo — su afirmación, no una medida.
- El tamaño lo confirma sin depender de ninguna búsqueda: la v2 añadió **+770
  bytes**, y cuando los modales sí se escribieron (v7, UNA sola op) costaron
  **+3.087**. En 770 bytes no caben.
- La **v4** es donde entra el `<script>` que menciona `cName` — con los elementos
  todavía inexistentes. **Ése es exactamente el `runtime_stale` que vio Jesús**, y
  llegó tres versiones antes de que Len se enterara.

Así que el fallo de los modales **no es de persistencia: es la familia de
[[reporta-exito-sin-haberlo-hecho]]** — el modelo declaró un trabajo que sus ops
no hicieron, y nadie lo contrastó. Lo que I5 e I6 atacan directamente: desde hoy,
el turno que escribe un script cuyos elementos no existen se entera **en esa misma
respuesta** (v4 lo habría dicho), y si el turno topa sin arreglarlo, el cierre lo
dice en vez de rematar con «Listo».

**Si la op de los modales fue rechazada contra la raíz** (`rejectDocumentWideOps`)
**o el modelo nunca la mandó, no se puede saber**: las ops del turno no se guardan
en ningún sitio. `data` de ese proyecto sólo tiene `html`, `degradations` y
`degradationsDismissed` — no hay `chat`, así que no hay tarjetas de herramienta
que leer. Lo dejo dicho como lo que es: **indistinguible con lo que hay grabado**.

### Y un hallazgo que no buscaba

Len le dijo a Jesús: *«tu cambio quedó a salvo en Versiones como "Tu edición,
justo antes de que el Agente la pisara"»*.

```sql
select label, count(*) from "projectVersions" where label ilike '%pisara%';
→ (0 filas)
```

**Esa fila no existe. En toda la base de producción, cero.** El aviso no sólo era
falso —nadie había editado—, sino que **la promesa de recuperación también lo
era**. La causa: `createVersion` deduplica cuando el html coincide con la última
versión del mismo ámbito (`versions.ts:116`), y `persistPage` no le pasa
`relabelDedup`. Como el falso positivo lo provocaba el propio guardado anterior de
Len, el «antes» era byte-idéntico a su propia versión previa → deduplicado → ni
fila ni etiqueta.

Es la avería completa: **avisar de una pérdida que no hubo, y ofrecer como
consuelo una fila que no se creó.** I2 la cierra por la raíz, porque ya no hay
escritura que pisar y por tanto no hay nada que prometer.

---

## 6 bis · Lo que sigue sin confirmar

1. **Si la op de los modales del turno 1 fue rechazada o nunca se mandó.** Ver
   arriba: no queda registro de las ops del turno. Indistinguible.
2. **Checkpoints y rewind de Claude Code** (punto 4 de la lista del documento). No
   verificado; no bloqueaba ningún invariante.
3. **El texto del modal** (hallazgo 8). Confirmado que el título genérico se
   reutiliza para `runtime_stale` en las 10 lenguas. No lo cambié: es producto,
   no invariante, y quería tu criterio.

---

## 7 · El tope — RESUELTO como lo hace Claude Code

Jesús: «la opción que sea como Claude Code lo hace en Claude Code». Leído en
2.1.270, y ninguna de mis cuatro opciones era la suya:

1. **Su bucle principal no tiene tope de pasos.** `maxTurns` es un campo
   OPCIONAL por definición de agente («Maximum number of agentic turns (API
   round-trips) before stopping»). Sin defecto.
2. **Lo que acota una sesión larga es el CONTEXTO, y compactando CONTINÚA**:
   «Context low (…% remaining) · Run /compact to compact & continue».
3. **El dinero se topa por MES y por cuenta, nunca por turno**: «You can set a
   maximum amount you can spend on usage credits per month», con auto-recarga.
4. **Cuando un presupuesto sí se agota, no se tira nada**: «Stopping further
   agent() calls. In-flight agents will complete; their results are preserved.»
   Y donde hay tope (subagentes): «stopped at its N-turn limit (partial result;
   … to continue)» — parcial + dirección para seguir.

**El punto 3 es el que nos separaba.** Nosotros YA tenemos el tope mensual
(`CREDITS_BY_PLAN`), así que el de turno era un **segundo muro redundante con el
primero** — y era el que partía el trabajo en dos.

### Lo aplicado

`topesPorPlan(plan)` en `lib/agent/loop.ts`, cableado desde
`app/api/agent/route.ts` con el `plan` que `getCreditState` ya devolvía: **cero
consultas extra**.

| plan | vueltas | llamadas | antes |
|---|---|---|---|
| **pro** | 12 | 20 | 6 / 10 |
| **free** | 6 | 10 | igual |

Free se queda porque **Claude Code puede no tener muro por turno gracias a la
auto-recarga, y el plan gratuito de aquí no la tiene**: su muro del mes son 20
créditos sin arrastre, y dejar que un turno patológico se lleve medio saldo es
justo la pérdida que todo esto viene a evitar.

### 🔴 Lo que se midió al hacerlo, y habría dejado el cambio muerto

Subir **sólo** las vueltas no habría cambiado **nada**. `maxTurns` y
`maxToolCalls` son dos muros independientes, y el de llamadas es el más bajo en
la práctica: una edición por vuelta gasta una llamada por vuelta, así que con 12
vueltas y 10 llamadas el corte seguía llegando en la 10. **La prueba salió
`tool_limit` donde esperaba `turn_limit`** — por eso `topesPorPlan` devuelve los
dos de una vez. Separarlos es cómo se construye una palanca que no mueve nada.

Y el **cable tiene su propia prueba** (`route.test.ts`, «los topes salen del
PLAN»): sin ella `topesPorPlan` sería una función con prueba y sin efecto,
porque el bucle cae a su defecto si la ruta no la pasa.

Pruebas: 4 en `loop.test.ts` + 2 en `route.test.ts`, todas rojas antes.

### El punto 4 de Claude Code ya lo teníamos

Comprobado de punta a punta: `topeAlcanzado` viaja bucle → evento terminal →
`chat-panel.tsx` → `avisoDeTope`; `WRAP_UP_INSTRUCTION` ya dice «pídemelo de
nuevo para continuar»; y con I6 el cierre lleva los hechos y si la página quedó
rota. Ahí no había nada que hacer.

---

## 8 · Nota aparte

`lib/projects.ts` es el único `.ts` del repo commiteado con CRLF (1.319 CRLF +
13 LF sueltos). Con `.gitattributes` diciendo `*.ts eol=lf`, cualquier edición
normaliza finales de línea y el diff sale de fichero entero — 2.619 líneas para
un cambio de 30. Lo reconstruí sobre los bytes de HEAD, así que su diff ahora
son **39/58**. La anomalía sigue ahí y algún día habrá que renormalizarla; no lo
hice porque sería un commit grande sin relación con esto.

**Sin commit.** El árbol está sucio a propósito, como sueles dejarlo.
