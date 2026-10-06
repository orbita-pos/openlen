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
