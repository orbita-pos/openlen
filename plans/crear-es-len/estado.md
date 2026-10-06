# Crear es Len — estado al cerrar la sesión en la nube (06/10)

Rama `crear-es-len`, todo empujado. Sin despliegue, sin tocar `master`, sin PR.
Las Tareas 11 (medición pagada) y 12 (borrar Crear) **no se hicieron**: no
estaban pedidas.

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

## Lo que queda

- Las verificaciones con navegador, sesión y Fireworks de verdad:
  `pendiente-local.md` (Parte A: tareas 3 y 9; Parte B: un turno real con las
  herramientas nuevas, conversaciones viejas, llamada y móvil, disparos de
  Len-Bench).
- Tarea 11 (medición pagada) y Tarea 12 (borrar Crear): sin empezar, como se
  pidió.
- La suite de la página (`data.pruebas`) se quedó sin escritor ni lector tras
  la Tarea 10. Decidido el 06/10: se deja como está por ahora (ver
  `pendiente-local.md`).
