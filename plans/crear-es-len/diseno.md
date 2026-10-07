# Crear es Len — un solo bucle, igual que DeepSeek

Fecha: 2026-10-06 · Estado: **especificación aprobada por Jesús el 06/10** («igual que deepseek, haz el plan») · Nada construido.

## 1. Qué se quiere

**Lo que dijo Jesús:**
- «Algo que no me está gustando es como que Crear no fuera Len… pasemos sólo a uno, que sería el de editar.»
- Para cada decisión que se le planteó, tres veces: **«que sea igual que DeepSeek»**. Ésa es la regla de este diseño: donde haya que elegir, se copia lo que hace `deepseek-ai/deepseek-harness`. Donde DeepSeek no tiene equivalente, se dice abiertamente (§7).

**Resultado:** crear una página es **el primer mensaje a Len** en un proyecto en blanco. `/api/generate` desaparece. Hay una sola maquinaria: un bucle, unas guardas, un cobro.

**Criterios de éxito:**
1. Las páginas creadas por Len son igual de bonitas que las de `/api/generate`, o más. Se juzga mirándolas ([[show-the-page-before-measuring]]).
2. El tiempo hasta ver algo en el lienzo no empeora.
3. El coste por página creada se conoce y Jesús lo acepta.
4. En el código queda un solo camino para crear y editar.

## 2. Decisiones tomadas (2026-10-06)

| # | Decisión | Por qué |
|---|---|---|
| D1 | Crear deja de ser una superficie aparte: es Len | Jesús, ver §1 |
| D2 | Verificación «como DeepSeek y Claude Code»: **se quita `verifyTurn`**, también al editar | El arnés no obliga; el modelo decide mirar (`mirar_pagina`). Se acepta perder el aviso garantizado |
| D3 | Enfoque A: la descripción es el primer mensaje del chat de Len (no Len escondido detrás de `/api/generate` ni dos caminos tras una palanca) | Es el único que hace que Crear *sea* Len |
| D4 | Todo lo demás, igual que DeepSeek | Jesús |

Esto **supera** la línea de `CLAUDE.md` «Crear NO tiene bucle… no re-proponer» (petición explícita). `CLAUDE.md` se actualiza cuando cambie el código (§9, fase 5).

> Corrección registrada: durante la conversación se dijo que Len «mira y tiene una vuelta para arreglar». Es falso desde Len 2.1: `verifyTurn` sólo MIDE y AVISA (`app/api/agent/route.ts:1362`). El docstring de `lib/agent/loop.ts:313`, que aún habla de «UN ciclo de arreglo», está viejo, y se borra con D2.

## 3. Lo que hace DeepSeek (comprobado en su repo, commit `5badb15`, 03/10)

1. **Un solo bucle.** `packages/core/agent-loop/src/agent.ts:533`: una respuesta sin llamadas a herramientas da el turno por completado. No hay modo «crear».
2. **No verifica por obligación.** `agent/turn-stopping` (`agent.ts:360`) es un enganche donde un plugin puede hacer seguir el turno con `steer()`. Por defecto sólo lo usan los puentes de hooks del usuario (`hooks-claude-code`, `hooks-codex`) y un registrador de ficheros cambiados que no hace seguir el turno.
3. **La sesión existe en blanco antes del primer mensaje** (`packages/client/ui-workspace/README.md:30,76,78`):
   - «New Session» toma la primera sesión en blanco que haya y sólo crea otra si no hay ninguna.
   - El compositor se activa y nada se manda solo.
   - La sesión en blanco seleccionada sale en la lista hasta su primer mensaje; las demás en blanco se ocultan.
4. **La pantalla de inicio es el estado vacío de la conversación** («Session Intent hero», que vive en `ui-conversation`). Tras el primer mensaje, la misma vista pasa a ser la conversación.
5. **Los argumentos de las herramientas se ven en directo** (`packages/client/ui-chat/README.md:96`, «Live tool deltas»).
6. **Modelo y esfuerzo en un único control del compositor**, por sesión, que se aplica a la siguiente petición (`packages/client/ui-model-selection/README.md`).
7. **El conocimiento de cada dominio va en instrucciones que se leen cuando hacen falta** (`AGENTS.md` en cadena, habilidades), no en un prompt aparte.

## 4. Diseño

### 4.1 Entrada: el proyecto en blanco (como «New Session»)

- **Un proyecto está en blanco** si no tiene `data.html`, no tiene `data.pages` y no tiene mensajes en `projectChatMessages`. Es un estado que se deduce de los datos, no una columna nueva.
- **`/new` sin parámetros** resuelve el proyecto en blanco del usuario y abre directamente `?project=<id>`:
  - toma el **más reciente** en blanco;
  - si no tiene ninguno, lo crea con un **`POST /api/projects`** nuevo (hoy sólo hay `GET`), con `title` y `brief` vacíos.
- **Lista de proyectos**: el proyecto en blanco **abierto** sale como «Proyecto nuevo» (texto por locale). Los demás en blanco **no salen**, ni en `/projects` ni en `?view=projects`.
- **Con el proyecto en blanco abierto**, el centro muestra el **estado vacío del chat de Len**: el compositor de la entrada actual (`start-landing.tsx`, con la piel del chat desde `create-composer`), con la referencia por URL, las fotos y el límite del brief.
- **Nada se manda solo.**

### 4.2 Enviar es el primer mensaje

- Al enviar, el cliente llama a **`/api/agent`** con ese proyecto, por el mismo camino que cualquier mensaje del chat (`components/workspace-v2/chat/use-agent-chat.ts`).
- **Las fotos** viajan como imágenes del mensaje (`Message.images`), igual que una foto adjunta en el chat.
- **La referencia por URL** (`StyleDirection`) va dentro del primer mensaje como el mismo bloque de contexto que hoy se pone delante del brief (`lib/style-match/direction.ts`).
- **La vista se transforma ahí mismo**: el estado vacío pasa a ser la conversación, con el lienzo al lado. No hay redirección ni recarga.
- **Se retiran**: `lib/use-generation.ts`, su watchdog, el estado `generating` de `app/[locale]/new/page.tsx` (`generation.generate` en la línea ~909) y el modo de entrada `ai` como flujo propio.

### 4.3 La página se forma en directo («Live tool deltas»)

- **Hoy**, `lib/ai/fireworks-stream-client.ts:452` acumula los trozos de `tool_calls[].function.arguments` y sólo los entrega al final. **Cambio**: además, emite un evento de delta por llamada (`index`, `name` y el trozo).
- **El bucle** (`lib/agent/loop.ts`) reenvía ese delta al cliente:
  - si la herramienta es `Write` y su ruta es una página `.html`, extrae de forma incremental el campo `content` del JSON parcial y emite el HTML parcial con la página a la que pertenece;
  - el lienzo lo pinta igual que hoy pinta `html_chunk`.
- **La tarjeta de `Write`** en el chat aparece «escribiendo» desde el primer trozo.
- **Vale también al editar**: cualquier `Write` de Len se ve formarse.
- **Lo que no cambia**: el evento `html` final (`loop.ts:2221`) sigue siendo lo que se guarda y lo que cuenta. El parcial sólo se enseña, nunca se persiste.

### 4.4 El conocimiento de crear va a `/.openlen/docs`

> **Ajuste del 06/10, al escribir el plan:** no hace falta un `crear-desde-cero.md` nuevo. El índice de `/AGENTS.md` ya manda leer `guia-de-diseno.md` «BEFORE writing a page from scratch», y el contrato ya es el mismo. Lo propio de Crear (la entrada «diseñas la página entera», el bloque STRUCTURE, el `<title>` que nombra el producto y que el `<head>` lo escribe Len) entra **dentro de `guia-de-diseno.md`**: menos ficheros, más DeepSeek. Además, `EL_HEAD_YA_EXISTE` (`lib/publish-contract-min.ts:346`) dice «el documento que editas ya los tiene», lo que es falso en una página vacía, y se corrige.

- **Len ya funciona como DeepSeek**: `/AGENTS.md` más documentos a demanda (`guia-de-diseno.md`, `librerias.md`, `api-d.md`; `lib/agent/ficheros/manual.ts`, `lib/agent/manual-de-la-plataforma.ts`). Además, el manual ya usa el **mismo contrato** que Crear (`conContratoMinimo`, `contratoParaSuperficie`).
- ~~Nuevo documento `/.openlen/docs/crear-desde-cero.md`~~ → sustituido por el ajuste de arriba: el texto va a `guia-de-diseno.md`.
- **El reparto, hecho contra el fichero real** (`app/api/generate/system-prompt.ts`):
  - **Se muda**: la entrada, STRUCTURE, el `<title>` y el `<head>`.
  - **Ya está en Len**: el contrato mínimo, las librerías y el JavaScript (la cláusula `agente`).
  - **Se tira**: el OUTPUT FORMAT («el primer carácter es `<`», que en Len es un `Write`) y `modelRuntimePromptBlock`.

### 4.5 Páginas: un fichero más (sin «subpáginas»)

- **Para Len ya no existen las subpáginas.** Una página es un fichero, como en DeepSeek y en Claude Code: `/index.html` es la portada y `/<slug>/index.html` cada página. Es el mismo árbol que escribe `publishToDir` (`lib/agent/ficheros/sitio.ts`). Todas se crean igual, con `Write`, y Len ya admite varias por turno (`masPaginas`).
- **Lo que se retira es el mecanismo de Crear**: primero la portada, luego el modelo «declara» páginas en su menú, y después una llamada aparte con prompt propio por cada página declarada (`lib/generation/subpagina-prompt.ts`), con su crédito.
  - Lo usa también el arnés de evals (`scripts/evals-pages.ts`). Se retira con él o se pasa a medir con Len; el plan decide cuál.
- **El usuario nunca ve la palabra**: no hay textos de interfaz con «subpágina» (`messages/es`, `messages/en`). Queda en comentarios y nombres de código (`chat-panel.tsx`, `site-pages-panel.tsx`…), y se cambia a «página» sólo en los ficheros que esta obra toque.
- **Fuera de alcance**: en la base, la portada sigue en `data.html` y las demás en `data.pages`. Igualarlo exigiría una migración, y para Len ya son iguales a través de los ficheros.

### 4.5a Fotos y título (paridad con Crear, encontrado al escribir el plan)

- **Varias fotos por mensaje.** Crear admite hasta 4 (`MAX_REFERENCIAS`, `lib/ai/referencia-adjunta.ts:53`), y el mensaje de Len sólo una (`attachedImage`). Como los adjuntos de DeepSeek, el mensaje admite hasta 4: el cuerpo de `/api/agent` acepta `attachedImages`, y la columna JSONB `projectChatMessages.attachedImage` guarda un objeto (filas viejas) o una lista (nuevas), sin migración. El compositor del chat sigue ofreciendo una; el de la entrada, hasta 4.
- **El título del proyecto.** Crear lo saca del `<title>` (`createProject` → `titleFromHtml`), y `persistPage` no lo toca nunca. Un proyecto en blanco nace con `"Untitled page"`, y en cuanto Len guarda una portada con `<title>` se adopta ese título. **Sólo si sigue el de relleno**: un nombre puesto por el usuario no se pisa.

### 4.5b Cobro

- Por uso, como cualquier turno de Len. Desaparece el «1 crédito por página» de Crear (ver §7).

### 4.6 Verificación (D2)

- **Se quita `verifyTurn`**:
  - la opción de `runAgentLoop` (`loop.ts:318`) y su bloque al cerrar (`loop.ts:~1770`);
  - el cableado en `app/api/agent/route.ts:1370`;
  - el texto «AND THE PAGE HAS NOT BEEN CHECKED» y lo que sólo existía para ella (`sinComprobar`).
- **Lo que necesita `mirar_pagina` se queda**: render, medición determinista y visión bajo demanda. Antes de borrar nada de `lib/agent/verify.ts` se comprueba qué usa `mirar_pagina`.
- **`/AGENTS.md`** añade una línea al estilo Claude Code: comprobar el trabajo antes de decir que está hecho. `mirar_pagina tipo="medir"` es gratis.
- **Decidido el 06/10 (Jesús): también se quita `medirParaElModelo`**, la medición con navegador que vuelve al MODELO tras cada tanda de ediciones (`loop.ts:349`, `:1086-1150`; `route.ts:1342`). Claude Code tiene algo así (sus diagnósticos tras editar), pero **DeepSeek no**: su paquete `lsp` sólo ofrece cuatro consultas de navegación que el modelo pide (`docs/subsystems/lsp.md:11`), y nunca le devuelve diagnósticos por su cuenta. La regla es DeepSeek.
- **Con las dos fuera, `OPENLEN_AGENT_VISION` ya no apunta a nada y se borra** ([[la-palanca-que-no-vuelve-a-ningun-sitio]]).
- **Lo que NO se toca en esta obra**: los diagnósticos estáticos que devuelven las propias herramientas al escribir (`outcome.diagnosticos`, `loop.ts:2275`: sin navegador, por ejemplo una clase de CSS que no existe). Siguen llegando al modelo. Si se quieren igual que DeepSeek, es otra decisión.
- **Lo que se pierde, dicho**: el bloque de `verifyTurn` también avisaba de las **promesas rotas** (un turno que se cargaba el carrito de hace seis turnos, `loop.test.ts:184`) y la tarjeta «verificar_diseno». La medición tras cada edición sigue llegando al modelo; el aviso garantizado al usuario no. El cliente **sigue pintando** las tarjetas `verificar_diseno` de turnos viejos guardados. Y con `medirParaElModelo` fuera, Len tampoco se entera solo de que desborda en móvil o de que rompió el JavaScript: sólo si lo mira él (`mirar_pagina` / `usar_pagina`), como en DeepSeek.
- **Aparte (06/10, Jesús)**: las 11 herramientas con nombre y parámetros en español (`mirar_pagina` con `tipo="medir"`…) pasan al inglés en snake_case, como las de DeepSeek (`bash`, `send_message`, `list_agents`). Va en **un plan propio**, no en éste.

### 4.7 Selectores

- **Se queda el control de esfuerzo de Len** en el compositor, como el de DeepSeek: se aplica al siguiente mensaje.
- **Se retira el selector de escritor de Crear**: `app/api/crear/escritor/`, la preferencia guardada (`lib/ai/escritor-guardado`) y `writerForTurn`. Len corre en el papel `agent` de `lib/generation/model-policy.ts`.
- La columna de la preferencia se deja sin migración de borrado en esta entrega. Se anota como deuda.

## 5. Lo que se borra (fase 5, sólo después de medir)

- `app/api/generate/` (`route.ts`, `system-prompt.ts`)
- `lib/use-generation.ts`
- `app/api/crear/escritor/`
- `lib/generation/subpagina-prompt.ts`
- `verifyTurn` y lo suyo (§4.6)
- Las operaciones de `model-policy.ts` que se queden sin llamador. La guarda `model-policy-sin-huerfanas.test.ts` las señala sola.
- Los comentarios que citan `/api/generate` en otros ficheros (`lib/agent/*`, `lib/page-engine/*`…) se revisan uno a uno. No todos se borran: algunos explican historia.

## 6. Lo que NO cambia

- **El lienzo, el panel de contenido, el inspector y la publicación.** Una página creada por Len es un proyecto como cualquier otro.
- **Las guardas de entrada**: lo que escribe Len ya pasa por `lib/page-engine/prepare.ts` y las guardas de `Write`.
- **Plantillas y pegar HTML** (`?mode=template`, `?mode=paste`): no son Crear y siguen igual.

## 7. Donde DeepSeek no tiene equivalente

| Pieza | Por qué no hay copia posible | Qué se hace |
|---|---|---|
| Lienzo con la página formándose | DeepSeek enseña los argumentos en la tarjeta de la herramienta; no tiene lienzo | Se pinta el HTML parcial del `Write`, igual que hoy `html_chunk` |
| Cobro | DeepSeek no cobra | Se cobra por uso, como Len. **Cambia el precio de crear**, y eso lo decide Jesús con los números de §8 |
| Selector de modelo | DeepSeek elige modelo por sesión; Len tiene un único papel | Se queda sólo el esfuerzo; elegir modelo para Len sería otro proyecto |
| Instrucción de verificar | El prompt de DeepSeek no la tiene; el de Claude Code sí | Una línea en `/AGENTS.md` (Claude Code es la vara para el comportamiento, según el reparto del 01/10) |

## 8. Medición antes de borrar (pagada, con OK previo)

- **Qué**: las mismas 5–6 descripciones reales de crear, por `/api/generate` y por Len en un proyecto en blanco. Se mide:
  - las páginas, **vistas una al lado de la otra antes de mirar números**;
  - el tiempo hasta el primer trozo pintado;
  - el tiempo total;
  - el coste;
  - los pasos que da Len.
- **Dónde**: en local, con base de usar y tirar ([[turnos-reales-en-local-con-base-de-usar-y-tirar]]).
- **Presupuesto**: se calcula y se presenta antes de correr nada ([[medicion-pagada-proporcional]]). No se corre sin el OK.
- **Si Len sale peor** en belleza o tiempo, se arregla en Len antes de seguir. No se mantienen los dos caminos.

## 9. Orden de construcción

1. **Directo** (§4.3): los deltas de `Write` al lienzo. Sirve también al editar y se puede probar sin tocar Crear.
2. **Conocimiento** (§4.4): `crear-desde-cero.md` y el índice de `/AGENTS.md`.
3. **Entrada** (§4.1–4.2): proyecto en blanco, `POST /api/projects`, el estado vacío del chat y enviar como primer mensaje. `/api/generate` sigue existiendo, pero `/new` ya no lo usa.
4. **Medición** (§8), con OK y presupuesto.
5. **Borrado** (§5), `verifyTurn` (§4.6), selectores (§4.7) y actualizar `CLAUDE.md` (fila de `app/api/generate/`, el modelo mental de `/new`, la línea de «Crear NO tiene bucle»).

Un solo despliegue al final, con ensayo de caja antes ([[un-deploy-con-todo-ensayo-de-caja-antes]]). **No se despliega nada sin pedirlo.**

## 10. Pruebas

- `fireworks-stream-client`: los deltas de argumentos salen en orden, y la llamada final sigue siendo idéntica byte a byte.
- `loop.ts`: un `Write` de `.html` emite HTML parcial creciente y después el `html` final de siempre; un `Write` de otra cosa no emite parcial. Los tests de `verifyTurn` se borran con él.
- **Proyecto en blanco**: se reutiliza el más reciente; se crea sólo si no hay; deja de estar en blanco al primer mensaje; la lista oculta los blancos salvo el abierto.
- **Manual**: `/AGENTS.md` nombra `crear-desde-cero.md`, y `Read` lo abre.
- **Flujo entero en el navegador** (build de prod en local): `/new` → escribir → la página se forma → queda guardada → recargar → sigue ahí. Lo mismo con foto y con referencia por URL.
- `npm run typecheck`, lint y sólo los tests tocados ([[vitest-por-carpetas-satura-la-app]]).

## 11. Riesgos y preguntas abiertas

- **JSON parcial**: extraer `content` de un JSON a medias tiene que tolerar escapes cortados (`\u`, `\"`) en el borde de un trozo. Si un trozo no se puede leer, se espera al siguiente; nunca se pinta basura.
- **Coste y tiempo de crear**: sin medir. Si Len tarda mucho más en el primer trozo (por pensar o por leer el manual antes de escribir), es el primer número a mirar.
- **Proyectos en blanco viejos**: los que ya existan sin html por fallos de Crear contarían como en blanco y se reutilizarían. Es aceptable (es lo que hace DeepSeek), pero hay que saberlo.
- **La portada** (`components/marketing/hero-prompt-input.tsx:135`), **decidido el 06/10: igual que DeepSeek.** Hoy manda a `/new?mode=ai&brief=…&autostart=1` y se envía sola. Pasa a lo que hace DeepSeek con `startSession(…, { prompt })` (`ui-workspace/README.md:78,92`): el brief llega **escrito** en el compositor del proyecto en blanco y **no se envía**; el usuario pulsa enviar. Se retira `autostart`.
