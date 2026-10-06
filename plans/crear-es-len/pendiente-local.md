# Crear es Len — lo que queda para hacer en local

Lo que la sesión en la nube (06/10) no pudo hacer, tarea por tarea. Ninguno de
estos pasos necesita cambiar código: son verificaciones.

> **Lo que SÍ se pudo en la nube** y no hace falta repetir: los `*.pg.test.ts`
> tocados corrieron contra un Postgres 16 de usar y tirar en `127.0.0.1:5546`
> (esquema con `drizzle-kit push --force`), y pasan. Los crates nativos se
> compilaron con `napi build` para que el typecheck y vitest los encuentren.

| Tarea | Paso | Qué | Por qué no en la nube |
|---|---|---|---|
| 3 | 9 | En un proyecto existente, «reescribe la portada entera»: el lienzo se llena ANTES de que acabe el turno y al final queda la página guardada. Después cancelar a mitad con ■: el lienzo VUELVE a la página de antes. Capturas de los dos casos. | Necesita el build de producción en 127.0.0.1 con sesión, y Fireworks de verdad (clave real). |
| 9 | 9 | Los cinco flujos con captura: (1) `/new` → `?project=<id>` con el compositor centrado; escribir, enviar: aparece el chat de Len con el mensaje, el lienzo se llena mientras escribe, queda guardado; recargar: sigue ahí, con el título del `<title>`. (2) Lo mismo con DOS fotos y una referencia por URL: la burbuja enseña las dos y la página usa la paleta. (3) Desde la portada de marketing con un brief: llega ESCRITO y NO se envía. (4) `/new` otra vez sin enviar nada: el MISMO proyecto en blanco (mismo id). (5) La lista de proyectos: el blanco no sale; abierto, la barra superior lo llama «Proyecto nuevo». | Igual: navegador + sesión + Fireworks real. |

## Cosas que mirar al hacerlo

- **El selector de escritor de Crear** (`SelectorDeModelo` en `HeroComposer`,
  `start-landing.tsx`) sigue en el compositor del estado vacío, pero ya no
  decide nada: lo que se envía va a Len, que corre en el papel `agent`. Se
  retira en la Tarea 12 (§4.7 de la especificación). Si molesta antes, se puede
  ocultar sin esperar a borrar `/api/crear/escritor`.
- **El evento `crear_envio`** (`lib/uso/catalogo.ts`) sigue registrando el
  `escritor` que habría elegido Crear; con Crear retirado ese campo deja de
  significar algo. Decidir en la Tarea 12 si se cambia o se retira.
- **El esfuerzo de Len en el compositor de la entrada** (§4.7, «se queda el
  control de esfuerzo de Len en el compositor»): el estado vacío usa el
  compositor de Crear, que no lo tiene; el primer mensaje sale con el esfuerzo
  guardado del dueño. Los mensajes siguientes ya van por el compositor del chat,
  que sí lo tiene.

## Parte B — las herramientas en inglés (06/10)

Todo el código está hecho y probado en la nube (ver `estado.md`). Lo que pide
navegador, sesión o Fireworks de verdad:

| Tarea | Qué | Por qué no en la nube |
|---|---|---|
| B2 | Un turno real de Len que use las herramientas nuevas: «¿cómo va mi página?» (→ `get_visits`), «mira si se ve bien en el móvil» (→ `view_page mode="measure"`), «prueba el formulario» (→ `use_page` con `steps`), «publícala» (→ `publish` y la tarjeta de confirmar). Que ninguna llamada vuelva con «There is no tool called…». | Clave real de Fireworks + sesión. |
| B2 | Abrir un proyecto con turnos guardados ANTES del 06/10 (que llamaron a `mirar_pagina`, `ver_visitas`…) y pedirle algo a Len: el turno sigue sin error (el historial se lee con los nombres de hoy). | Base de producción (o una copia) con turnos viejos. |
| B3 | En ese mismo proyecto, las tarjetas viejas del chat se pintan con su etiqueta («Mirando tus visitas», «Comprobando la página»…), nunca con el nombre crudo. Y la cara del chat cambia de estado igual que antes. | Navegador + sesión. |
| B3 | La llamada (`/llamada`) y la app móvil: la frase de avance mientras Len trabaja, y la tarjeta «Publicar» cuando Len la deja (ahora llega con `action: "publish"`). | Micrófono / dispositivo + sesión. |
| B4 | Las pruebas de disparo de Len-Bench (`npm run bench:len:disparos -- --yes`) **no se corrieron**: gastan dinero (un turno por consulta). Las carpetas se renombraron a `get_visits/`, `list_form_submissions/` y `list_messages/`, así que `--solo=` lleva ya los nombres nuevos. | Gasto real; fuera del presupuesto de esta sesión y de lo pedido (la medición es la Tarea 11). |

### Cosas que mirar

- **Quedan en español a propósito** (no son de las 11, o no son la API de una
  herramienta): la clave `preguntado` de la respuesta de `ask_user_question` y
  del modo plan; las claves de las líneas de `/.openlen/bandeja/*.jsonl`; el
  esquema de `/ajustes/proyecto.json` (`titulo`, `idiomas`, `modulos`); y la
  forma de la tarjeta de confirmar (`subdominio`, `idiomas`, `republicar`, y
  `para: "formulario"` en la de responder), que no la lee el modelo.
- **Las pruebas con navegador** necesitan
  `PUPPETEER_EXECUTABLE_PATH=/opt/pw-browsers/chromium` en este contenedor; en
  local, el Chrome de siempre.
- **La suite de la página (`data.pruebas`) quedó sin escritor.** La tarea 10
  retiró `verifyTurn`, que era quien llenaba `suiteDelTurno`; el bloque que la
  guardaba al cerrar el turno se quedó muerto y se borró en B2. Las promesas
  guardadas siguen en la base y `lib/agent/pruebas-de-la-pagina.ts` sigue
  existiendo, pero ningún turno las corre ni las actualiza. Decidir si se
  retira entera (tipo, módulo y `guardadas` de `verify.ts`) — no lo pedía
  ningún plan, así que no se tocó.
