# Crear es Len — estado al cerrar la sesión en la nube (06/10)

Rama `crear-es-len`, todo empujado, en el PR orbita-pos/openlen#1. Sin
despliegue y sin tocar `master`. La Tarea 11 (medición pagada) **se canceló**
(ver `medicion/README.md`); la Tarea 12 (borrar Crear) **está hecha**, más
abajo.

## Parte A — `plan.md`, Tareas 1–10: hechas

| Tarea | Commit | Qué |
|---|---|---|
| 1 | `1e80062` | Fireworks entrega los trozos de los argumentos en vivo (`function_call_delta`), opcional (`streamToolArgs`). |
| 2 | `7b5b6d0` | `lib/agent/write-preview.ts`: leer un `Write` a medias y sacar un documento pintable cada 1.500 caracteres. |
| 3 | `d463259` | El evento `page_preview`: el lienzo se llena mientras Len escribe y vuelve a lo guardado si el turno no guarda. |
| 4 | `878d642` | Lo que sólo sabía Crear (el bloque FROM_SCRATCH) pasa a la guía que Len lee antes de escribir desde cero. |
| 5 | `35d6ac7` | `adoptPlaceholderTitle`: el título de relleno se adopta del `<title>` de la portada, sin pisar uno puesto a mano. |
| 6 | `b428131` | El proyecto en blanco reutilizable (`findOrCreateBlankProject`, `isBlankProject`, `visibleProjects`). |
| 7 | `9eea63a` | Hasta 4 fotos por mensaje a Len (`MAX_PHOTOS_PER_MESSAGE`), con su bloque en el contexto. |
| 8 | `90bf5fe` | La referencia por URL (`styleDirection`) viaja con el mensaje. |
| 9 | `4de3e19` | `/new` sin proyecto crea (o reutiliza) el blanco; el estado vacío del chat es la entrada; enviar llama a `/api/agent`; la portada de marketing RELLENA el compositor y no envía. |
| 10 | `b9a7f47` | Fuera `verifyTurn`, `medirParaElModelo` y `OPENLEN_AGENT_VISION`; `medirDelTurno` y `outcome.diagnosticos` se quedan; la línea de «compruébalo antes de decir listo» en `/AGENTS.md`. |

**Tres cosas de la Parte A que las puertas por tarea no vieron** (corrían sólo
los tests tocados) y que salieron al correr la suite entera; se arreglaron en
el commit de B2 (`4a1aa68`):

- `app/api/agent/route.ts`: tras la Tarea 10 nadie llenaba `suiteDelTurno`, y
  la escritura de la suite de la página al cerrar el turno era código muerto.
  Fuera, y con ella la guarda «los tres eslabones del turno» de
  `lib/agent/pruebas-de-la-pagina.test.ts` (su sujeto eran «las promesas
  rotas», que la Tarea 10 retira). Ver la decisión pendiente en
  `pendiente-local.md`.
- `lib/lienzo/documento.test.ts`: la guarda «quien mide hornea la vista» pedía
  que la ruta del Agente llamara a `vistaParaMedir`; ya no mide, quien arma la
  vista es `lib/agent/tools.ts`.
- `lib/prompts-superficies.test.ts`: la frase del `<head>` cambió a propósito
  en la Tarea 4 («When the document already has them…», porque Len también
  escribe desde cero).

## Parte B — `plan-herramientas.md`, B1–B4: hechas

| Tarea | Commit | Qué |
|---|---|---|
| B1 | `08c82c1` | `lib/agent/tool-renames.ts`: `TOOL_RENAMES`, `currentToolName`, `currentToolCall` (nombre, claves, valores y pasos de `use_page`), generalizado desde `preguntar`. |
| B2 | `4a1aa68` | Las 11 en inglés con sus parámetros, valores y respuestas (`view_page`, `use_page`, `toggle_module`, `find_photo`, `edit_image`, `publish`, `undo_last_change`, `get_visits`, `list_form_submissions`, `list_messages`, `draft_reply`). Guarda `tools-in-english.test.ts`. Llamar a un nombre viejo responde «It is called "view_page" now». La confirmación de publicar lleva `action: "publish"`. Golden actualizada (sólo renombrados). |
| B3 | `1092d7a` | El cliente: `KNOWN_TOOLS` y las claves `agent.tool.*` de los 10 idiomas con los nombres nuevos (sólo la clave); las filas viejas se resuelven con `currentToolName` en la tarjeta, la cara del chat y el móvil. |
| B4 | `39a1141` | Len-Bench: casos, juez, sesión y las carpetas de disparo (`get_visits/`…) con los nombres nuevos; las grabaciones viejas puntúan igual. |

Además de lo que listaba el plan, B2/B3 tocaron dos sitios que el plan no
nombraba y que rompían con el cambio: `lib/agent/terminal/ajustes.ts` (llamaba
a `toggle_module` con `modulo`/`encender` y leía `aviso`) y la app móvil
(`movil/src/chat/hilo.ts`, `movil/src/muestra.ts`), que lee los mismos eventos.

La base **no se migró**: los turnos guardados se traducen al leer.

## Tarea 12 — borrar Crear: hecha

Pedida por Jesús el 06/10, tras cancelar la 11. Commit «retirar(crear): …».

**Lo que se borró** (el plan, y lo que el `grep` dijo que quedaba huérfano):

- `app/api/generate/` (la ruta y su prompt), su cliente `lib/use-generation.ts`,
  `app/api/crear/escritor/`, `lib/ai/escritor-guardado.ts` y el selector de
  escritor (`selector-de-modelo.tsx`) con sus claves `heroPrompt.modelo.*` en los
  10 idiomas.
- Las subpáginas declaradas: `lib/generation/subpagina-prompt.ts`,
  `lib/projects/paginas-declaradas.ts`, `lib/projects/construir-paginas-declaradas.ts`
  y `lib/generation/repeticion-de-portada.ts`.
- La tubería de Crear: `lib/ai-stream/generate.ts`, `lib/harden.ts` (el
  envoltorio TS; la función Rust se queda) y `lib/page-engine/rotura-observable.ts`.
- `scripts/evals-pages.ts` y `lib/evals/` (el cohorte y el marcador), con
  `npm run evals:pages`: medían la tubería de Crear, y la 11 se canceló.
- De `provider-switch.ts`, lo del selector (`ESCRITORES_ELEGIBLES`,
  `escritorDeCrear`, el defecto de Crear…); se queda `writerForTurn(hasImages)`
  para el Chat.
- De `referencia-adjunta.ts`, la puerta del `data:` del cuerpo de Crear; se
  queda `MAX_REFERENCIAS`, y `MAX_PHOTOS_PER_MESSAGE` pasa a ser ese mismo número.
- Los eventos de uso `crear_modelo_abrio`, `crear_modelo_eligio` y `crear_fallo`
  (con `registrarEnServidor` y `nombreDeError`, que sólo lo escribían a él);
  `crear_envio` pierde `escritor`.
- En `credits.ts`, dos constantes que sólo documentaban costes de Crear.

**Lo que NO se borró, a propósito:** la columna `users.crearWriter` y su
migración (está en producción; quitarla es una migración aparte), y la función
Rust `harden_visual_quality`.

**Las pruebas:** las que tenían a Crear por sujeto se fueron con él; las que lo
usaban como contra-prueba miran ahora el contrato crudo (`PUBLISH_CONTRACT_MIN`).
La guarda de la afinidad de caché se mudó a la ruta de creación de hoy (la de
Len). El golden de los demás prompts **no cambió** (sólo salió el bloque de
«crear»). `CLAUDE.md` y el `README.md` dicen lo nuevo, y los comentarios que
describían `/api/generate` como vivo se corrigieron (los de historia se quedan).

**Puertas:** `npm run typecheck` limpio; eslint sin errores (los 4 avisos de
`page.tsx` ya estaban); `npm run test:node` 676 de 676; `npx vitest run`
entero, con el Postgres de pruebas: **6.628 pasan y 42 fallan**, y los 42 son
exactamente los de la lista de «La suite entera» de abajo (ya fallan en
`master` o son del entorno; `system-prompt.test.ts` ya no está porque se fue con
la ruta). Y `npm run build` **pasa**, sin `/api/generate` ni `/api/crear/*` en
la lista de rutas.

Cuatro guardas que leen ficheros como texto (y que por eso el typecheck no ve)
se cayeron en la primera pasada de la suite y se arreglaron antes del commit:
`sin-perfil`, `superficies-que-laten`, `memoria-en-las-tres-superficies` y
`afinidad-cache`.

## Pruebas

Por tarea: `npm run typecheck` limpio; eslint de lo tocado sin errores (sólo
avisos `react-hooks/exhaustive-deps` que ya estaban); los tests tocados en
verde. Los `*.pg.test.ts` tocados, contra un Postgres 16 de usar y tirar en
`127.0.0.1:5546`. Las pruebas con navegador, con
`PUPPETEER_EXECUTABLE_PATH=/opt/pw-browsers/chromium`.

### La suite entera, al final

Corrida al final, con `DATABASE_URL` apuntando al Postgres de usar y tirar
(así corren también los `*.pg`):

- **vitest** (`npx vitest run`): 6.920 pasan, 45 fallan, 9 saltadas, en 601
  ficheros. **Los 45 fallos son todos de los de abajo** (ninguno es de esta
  rama).
- **node:test** (`npm run test:node`, las suites con el binding nativo): 709
  de 709.

La primera corrida entera (antes de B3/B4 y sin base) dio 59 fallos: los 45 de
abajo, los `*.pg` sin base, y los que eran de esta rama — las tres guardas de
la Parte A (arregladas en B2), `movil/src/chat/hilo.test.ts` (la tarjeta de
publicar, arreglada en B2) y las de B3/B4, que todavía no estaban hechas.

**Fallos que NO son de esta rama** (comprobados en un worktree de `master`
con el mismo entorno, o por su causa):

- Ya fallan en `master`: `app/api/generate/system-prompt.test.ts` (3),
  `lib/templates/visual-metadata-review-launcher.test.ts` (5),
  `lib/agent/prueba-js.browser.test.ts` + `lib/ai/visual-quality-renderer.test.ts`
  (30 entre las dos), `lib/style-match/scrape/fetch-raw.test.ts` (1),
  `lib/ai/imagenes-perezosas.browser.test.ts` (1),
  `lib/notifications/dispatch.test.ts` (2, con la misma base).
- De entorno: `lib/len-bench/graders.browser.test.ts` (2: esperan
  `ERR_NAME_NOT_RESOLVED` y el proxy del contenedor contesta
  `ERR_CONNECTION_RESET`); `lib/fs/write-json-atomic.test.ts` (1: depende de la
  profundidad del directorio de trabajo — desde `/home/user/openlen` la ruta
  relativa contiene `/tmp/…`; pasa desde un worktree en `/tmp`; `lib/fs` no se
  tocó).

## Ensayo de caja en local (06/10, noche) — lo de `pendiente-local.md`

Worktree de `crear-es-len` en la máquina de Jesús. `npm run build` de
producción (`OPENLEN_DIST_DIR=.next-ensayo`) y `next start -H 127.0.0.1 -p 3007`,
con el entorno de Len-Bench (R2, Cloudflare, Resend y Exa vacíos;
`PUBLISH_ROOT` en `plans/len-2/publicadas`), una base Postgres de usar y tirar
en `127.0.0.1:5547` (esquema con `drizzle-kit push`) y la clave REAL de
Fireworks. Cuenta de prueba registrada en `/es/register`. 9 turnos reales del
modelo (más la confirmación de publicar):
**31,44 créditos (~0,31 $)**, con OK de Jesús hasta 2 $.

**Puertas en local:** `npm run typecheck` limpio; `npm run test:node` 676 de
676 (antes y después de los arreglos de abajo); las pruebas tocadas en verde.

| Paso | Resultado |
|---|---|
| a) `/new` sin proyecto | ✅ Abre un blanco (`?project=<id>`) con el compositor centrado y «Proyecto nuevo» arriba. Enviar → el chat de Len con el mensaje; la página se guarda; al recargar sigue, con el título sacado del `<title>` («Café Nube — Cafetería de especialidad en Oaxaca»). 6,59 créditos, 5 min 22 s. El lienzo se pintó a medias mientras escribía (en este turno el modelo mandó la ruta primero). |
| b) Dos fotos + referencia por URL | ✅ La burbuja dice «2 imágenes enviadas» con sus dos miniaturas; el servidor: «fotos de la conversación — 2 de 2 a la vista». La página usa la paleta MEDIDA de stripe.com (`#533afd`, `#000eff`, `#b9b9f9`, `#e5edf5`, `#0a2540`) y las dos fotos; título del `<title>`. (Las miniaturas salen rotas en el ensayo: sin R2 las fotos caen a `public/uploads/`, y `next start` no sirve lo que se añade a `public/` después del build. En producción van a R2.) |
| c) Portada de marketing con brief | ✅ Llega ESCRITO al compositor del mismo blanco y NO se envía (ningún POST a `/api/agent`). Ver la nota de `fixRedirectHost` abajo. |
| d) `/new` otra vez sin enviar | ✅ El MISMO id. Y cuando el blanco ya tiene página, `/new` da otro blanco nuevo. |
| e) Lista de proyectos | ✅ «0 páginas» con el blanco abierto; arriba dice «Proyecto nuevo». |
| f) «Reescribe la portada entera» | ❌ → ✅ tras el arreglo `0dceeacf` (abajo). Antes del arreglo, la vista a medias salía UNA vez, medio segundo antes de guardar. Después: la vista a medias creció 1.644 → 3.145 → 4.645 → 6.148 caracteres en 5 s, y ■ en ese momento devolvió el lienzo a la página de antes en 0,2 s (mismo `<h1>`, mismos 310.094 caracteres), con 0 créditos. |
| g) Selector de modelo y red | ✅ El compositor de la entrada no tiene selector (sólo «+» y dictar). En la red, ninguna llamada a `/api/generate` ni a `/api/crear/escritor`; el build no lista ninguna de las dos. |
| 3) Herramientas nuevas, turno real | ✅ `get_visits` (respuesta con `today`/`views`…), `view_page` (`mode: "measure"`/`"describe"`, `question`, `area`), `use_page` (`steps` con `click`/`into`/`type`/`read`), `find_photo`, `publish` → la tarjeta «Publicar tu página» con Publicar/Cancelar; al pulsar, «Publicada en cafe-nube-ensayo.openlen.app» (en la carpeta local). Ninguna de las 9 grabaciones tiene «There is no tool called» ni «It is called … now». La única llamada que falló fue un paso mal armado de `use_page`; su error en inglés lo corrigió en el reintento. |
| 4) Conversación de ANTES | ❌ → ✅ tras el arreglo `12cec48d` (abajo). Fila sembrada a mano en la base de prueba con `ver_visitas`, `mirar_pagina {tipo:"medir", pregunta}` y `usar_pagina {pasos:[{pulsa},{lee},{en,escribe}]}` en `actions`, `toolResults` y `transcript`. Un turno nuevo sobre ese historial: sin error, y Len siguió con los nombres de hoy (`Read`, `Edit`, `use_page`, `view_page`). |
| 5) Llamada y móvil | ⚪ Sin probar en vivo: piden micrófono, la voz en tiempo real y un dispositivo. Sus pruebas en local: `components/llamada` + `movil/src`, 20 ficheros y 120 pruebas en verde (las frases de avance de `puente-a-len` y la tarjeta de publicar de `hilo`). |

### Lo que se arregló en la rama

- **`0dceeacf` — el lienzo a medias esperaba a la ruta del `Write`.** El orden
  de las claves lo elige el modelo: en las tres «reescribe la portada» mandó
  `content` antes que `file_path` (en las dos creaciones, al revés), y
  `createWritePreview` no pintaba nada sin ruta. Ahora, mientras la ruta no
  llega, un contenido que empieza como documento se pinta en la página activa
  del turno (`activePage` → `agentSession.page`); cuando llega, manda la ruta.
  Si al final era otra página, el cliente ya devolvía el lienzo a lo guardado
  al cerrar (`previewPainted`). Pruebas nuevas en `write-preview.test.ts`.
- **`12cec48d` — la tarjeta de los pasos pintaba crudos los nombres de antes.**
  `StepRow` (`steps-card.tsx`) usaba `action.tool` tal cual para la etiqueta
  (el icono ya pasaba por `activityOf`, que traduce). Ahora resuelve con
  `currentToolName`, como `agent-action-card`. Visto en el navegador: «Mirando
  tus visitas», «Comprobando la página», «Probando la página». Prueba nueva en
  `steps-card.test.tsx`.

### Segunda ronda (07/10): lo que salió en el ensayo, arreglado «como DeepSeek»

Jesús pidió arreglar lo visto. Cada arreglo con su prueba, typecheck y lint, y
comprobado después en el build de producción en 127.0.0.1 con Fireworks real
(esta ronda: ~13 créditos, ~0,13 $; la sesión entera, 44,75 créditos).

| Commit | Qué | Comprobado en el ensayo |
|---|---|---|
| `0c68e064` | **■ a mitad de un `Write`**: el cliente de Fireworks armaba los argumentos a medias y salía «tool arguments were not JSON» → «El modelo tuvo un problema». Como DeepSeek (`interrupted: true`): lo dicho se queda y las llamadas sin despachar no existen. | ■ con la página a medias: «Cancelado.» / «Detenido · lo que ya hizo se queda»; el lienzo vuelve a lo guardado en <1 s. |
| `93b13596` | **El stream que se corta a mitad de una llamada** (visto al comprobar lo anterior: un turno de crear murió con 16.738 caracteres de página cortados dentro de un `<path>`). Sólo se arman llamadas si el stream terminó: sin `finish_reason` es corte de transporte (se reintenta); con `length`, `max_tokens` (el bucle continúa como Claude Code). | Pruebas; el corte real no se repitió. |
| `24fad8fb` + `fd1f7334` | **Retomar lo cortado**: la transcripción guarda `detenido` (el `interrupted` de DeepSeek) y el historial pone detrás la marca «[Request interrupted by the owner (■)…]», como Claude Code. Y la causa real: el aviso de «turno mudo» («If the user asked you for a change and it still isn't applied, apply it NOW») saltaba tras un turno parado antes de su primera herramienta; parado no es mudo. | En una conversación LIMPIA (Pino): tras el ■, «¿cómo va mi página?» → sólo `get_visits`, «la landing quedó a medias… ¿La escribo ya?». (En Brisa y en Monte siguió rehaciéndola: su historial traía razonamientos VIEJOS que citaban el aviso —en Monte, la fila sembrada a mano para el paso 4—.) |
| `1ca1bda9` | **Inglés al empezar**: la petición del dueño iba pegada detrás del contexto en inglés con «WHAT THE USER ASKS YOU NOW:». Como DeepSeek (su contexto es otro mensaje, `runtimeContext.project`) y Claude Code: el contexto en su propio mensaje, y el último es el del dueño, solo (con sus fotos y, marcados, los avisos). | Dos primeros turnos de proyecto (Tinta, Brisa): toda la narración en español desde la primera frase. Antes, 3 de 3 empezaban en inglés. |
| `d45cb804` | **Redirecciones a openlen.com**: `fixRedirectHost` sólo rehace hacia openlen.com si la petición llegó por un host público (Caddy pasa el Host y `X-Forwarded-Host` de fuera). | `localhost:3007/` → `/es`, portada → `/new?brief=` y login con `?next=`, todo en local. |
| `bb9dc660` | **El lienzo en local**: con un Host local, `urlDelDocumento` va a `http://lienzo-….localhost:<puerto>` también en producción. | El lienzo carga por su origen, sin «vista limitada». |
| `3facae7c` | **Las fotos sin R2 con `next start`**: `app/uploads/[...path]` sirve lo subido después del build (sólo ráster, nosniff, sin salir de la carpeta, nada si hay R2). | Las dos miniaturas del brief se ven. |
| `ffac2660` | **«Untitled page» en la barra** de un proyecto cuyo primer turno no escribió la portada: el relleno se traduce siempre («Proyecto nuevo»). | Pino sin portada: «Proyecto nuevo». |

**Puertas al final:** typecheck limpio; las pruebas tocadas en verde
(`fireworks-stream-client`, `loop`, `transcripcion`, `context`, `manual-de-la-plataforma`,
`route` del agente, `prompts-golden`, `lienzo`, `middleware-redirect-host`,
`app/uploads`); `test:node` 676 de 676; `npm run build` compila.

### Tercera ronda (07/10): los tres que quedaban, como DeepSeek

| Commit | Qué | Comprobado en el ensayo |
|---|---|---|
| `1354a8c1` | **Recargar con una pregunta en el aire**: como DeepSeek («a browser that reconnects receives it again and can still complete it»), el registro de turnos abiertos guarda la pregunta mientras espera (`preguntaPendiente`), el reenganche la devuelve y el chat pinta su tarjeta. | Pino: pregunta del modo plan esperando, recarga → la tarjeta vuelve; «Planear primero» desde ella llega al turno VIVO (`respuesta=Plan first`) y Len sigue en modo plan. |
| `d0a1c949` | **La pregunta del modo plan como texto en inglés y sin tarjeta**: el modelo la mandó en la misma tanda que `find_photo` y `Read`. El servidor ponía como texto del turno nuestra frase fija en inglés, y el chat sólo buscaba la pregunta en la ÚLTIMA tarjeta. Ahora una pregunta con `intent` cierra el turno sin texto (la tarjeta la pinta traducida), y la pregunta abierta sale de su llamada, esté donde esté (`openQuestionIndex`). | La tarjeta en español («Len quiere planear antes de cambiar nada. ¿Planear primero?»), sin «Switch to plan mode?». La tanda en paralelo, con pruebas (no se pudo forzar en vivo). |
| `9f878435` | **El ■ antes de que llegue el uso cobraba 0**: Fireworks manda el uso al final del stream. Como DeepSeek (el dueño paga lo que el modelo llegó a gastar), sin el uso del proveedor el bucle cuenta lo que llegó —la petición y lo generado— con el estimador de la compactación; sin un solo trozo, nada. | ■ a los 7 s del primer stream: «■ del dueño — 64 … vueltas=1 llamadas=0» (antes, 0). |

Puertas: typecheck limpio, las pruebas tocadas en verde, `test:node` 676 de 676,
`npm run build` compila.

### Cuarta ronda (07/10): el razonamiento viejo, como DeepSeek

DeepSeek **también** devuelve el razonamiento de turnos anteriores («Reasoning
content from a prior assistant turn is passed back verbatim», README de
`llm-deepseek`), así que quitarlo no sería hacerlo como DeepSeek. La diferencia
era otra: DeepSeek guarda en la sesión el contexto con el que el modelo razonó
(su `runtime-context` es un mensaje durable), y Len mandaba los avisos de cada
turno y los tiraba. Un «The system notice says…» de un turno viejo, sin el aviso
al lado, se leía como si el aviso fuera de AHORA.

`ffa3a95a`: `buildAgentMessages` devuelve los avisos del turno, la ruta los guarda
en la transcripción (`avisos`) y `historialDesdeLaBase` los repone detrás de las
palabras del dueño, como se mandaron. Comprobado: «Hola» (turno mudo) → «¿Qué dice
el botón principal?» lleva el aviso de mudo, y queda guardado en SU fila; la
reposición en el historial, con pruebas. Las filas de antes de este cambio no
tienen sus avisos guardados y no se pueden reconstruir: ésas se van cuando salen
de la ventana.

## Lo que queda

- ~~Las verificaciones con navegador, sesión y Fireworks de verdad~~: hechas en
  el ensayo de caja de arriba, salvo la llamada y el móvil en vivo, y los
  disparos pagados de Len-Bench (`npm run bench:len:disparos`), que no se
  pidieron.
- Tarea 11 (medición pagada): **cancelada por Jesús el 06/10**, porque el
  criterio no servía (ver `medicion/README.md`). No se corrió ni se gastó nada.
- Tarea 12 (borrar Crear): hecha. Su ensayo de caja (paso 6: build de
  producción, 127.0.0.1 y los cinco flujos de la Tarea 9 con captura) pide
  navegador, sesión y Fireworks de verdad: está en `pendiente-local.md`.
- La suite de la página (`data.pruebas`) se quedó sin escritor ni lector tras
  la Tarea 10. Decidido el 06/10: se deja como está por ahora (ver
  `pendiente-local.md`).
