# Task 13 — Informe: Chat clásico conserva la ventana prometida

## Raíz confirmada

El cliente de Chat clásico ya formaba los últimos 12 turnos completos en
`components/workspace-v2/panels/chat-panel.tsx`, pero la ruta
`/api/templates/ai-design` volvía a aplicar `.slice(-12)` al arreglo plano de
mensajes sanitizados. Así, el request real que recibía `fireworksStream` llevaba
sólo `u7..u12`/`a7..a12` cuando el cliente había enviado 12 pares.

`/api/agent` se inspeccionó como referencia: ya normaliza `historyTotal`, tiene
una ventana honesta y trata los turnos de herramienta con reglas distintas. No
se alteró su comportamiento.

## RED observado antes de producción

Primero se añadieron pruebas de ruta que consumen `POST`, agotan el stream SSE y
revisan el payload exacto entregado a `fireworksStream`.

Comando:

```powershell
node .\node_modules\vitest\vitest.mjs run app/api/templates/ai-design/route.test.ts
```

Resultado RED antes del cambio de producción: código 1; 5 pruebas nuevas rojas.
La primaria falló como se esperaba: esperaba 24 mensajes (`u1..u12` y
`a1..a12`) y recibió 12 (`u7..u12` y `a7..a12`). Las contra-pruebas también
mostraron que la ruta todavía no conservaba la ventana que el cliente enviaba.

## Cambio implementado

- Se creó `lib/chat/history-window.ts`, módulo browser-safe con la única
  constante `CHAT_HISTORY_TURNS = 12`.
- El cliente y la ruta clásica consumen esa constante. La ruta traduce los 12
  turnos a 24 mensajes sanitizados, conservando pares normales completos.
- La ruta acepta `historyTotal` únicamente si es `number` finito; aplica
  `Math.trunc` y el rango `[0, 500]`. Ausente o inválido queda en `null` y no
  añade aviso.
- Cuando el total válido es mayor que los turnos visibles (mensajes `user`
  históricos), el mensaje final al escritor incluye
  `CONVERSATION MEMORY WINDOW: visibles/totales` y prohíbe afirmar memoria de
  lo que queda fuera.
- La sanitización sigue reconstruyendo sólo `{ role, content }`; las entradas
  con campos `functionCalls` y `functionResponses` no cruzan el boundary.

No se añadió `data-slot-path=` ni se modificó `/api/agent`.

## GREEN y contra-pruebas

Después del cambio, el mismo comando terminó con código 0:

```text
Test Files  1 passed (1)
Tests  31 passed (31)
```

Las nuevas pruebas verifican el payload real de Fireworks para:

1. 12 pares: conserva `u1..u12` y `a1..a12`.
2. 12/12: no aparece el aviso de memoria recortada.
3. 13/13: conserva `u2..u13`, excluye `u1` y aparece `12/13` con la
   prohibición de afirmar memoria exterior.
4. `historyTotal` inválido (cadena): no inventa aviso.
5. Campos de herramienta: no se transmiten por la superficie clásica.

## Controles rojos y restauración

1. Se cambió temporalmente el límite del servidor de
   `-(CHAT_HISTORY_TURNS * 2)` a `-CHAT_HISTORY_TURNS` y se ejecutó:

   ```powershell
   node .\node_modules\vitest\vitest.mjs run app/api/templates/ai-design/route.test.ts -t "conserva los 12 pares"
   ```

   Resultado: código 1; esperaba 24 y recibió 12 (`u7..u12`). Se restauró
   `-(CHAT_HISTORY_TURNS * 2)` y se verificó con `rg` en la línea 260 de la
   ruta.

2. Se cambió temporalmente la condición de aviso de `>` a `>=` y se ejecutó:

   ```powershell
   node .\node_modules\vitest\vitest.mjs run app/api/templates/ai-design/route.test.ts -t "12/12 no anuncia"
   ```

   Resultado: código 1; el payload contenía erróneamente
   `CONVERSATION MEMORY WINDOW: 12/12`. Se restauró `>`.

## Verificación final

```powershell
node .\node_modules\typescript\bin\tsc --noEmit
node .\node_modules\vitest\vitest.mjs run app/api/templates/ai-design/route.test.ts
git -c safe.directory=C:/Users/jesus/Desktop/inari-pages diff --check
```

- `tsc --noEmit`: código 0, salida vacía.
- Vitest final: código 0, 1 archivo y 31 pruebas aprobadas.
- `git diff --check`: código 0.

Vitest emitió los stderr esperados de casos existentes que prueban fallos de
cobro, stream y operaciones rechazadas; el resumen final no tuvo fallos.

## Archivos y commit

- `app/api/templates/ai-design/route.ts`
- `app/api/templates/ai-design/route.test.ts`
- `components/workspace-v2/panels/chat-panel.tsx`
- `lib/chat/history-window.ts`
- `.superpowers/sdd/hallazgos-superficies-ai/task-13-report.md`

Commit local: `fix(chat): conserva los doce turnos prometidos` (el hash final
se entrega junto con este informe).

## Auto-revisión y preocupaciones

- Alcance limitado a la ventana del Chat clásico, el cliente y su prueba de
  ruta; `/api/agent` no cambió.
- La constante es importable desde el navegador y no depende de APIs de Node.
- La nota vive en el prompt enviado al escritor, no sólo en una prueba ni en
  una UI local.
- No se ejecutó la suite completa por indicación del brief; corresponde al
  controlador final.
- No se observan secretos nuevos ni cambios a archivos ajenos. El árbol ya
  tenía numerosos untracked ajenos, que no se incluirán en el commit.

## Fix round 1 — referencia visual no puede borrar la ventana honesta

### Raíz y RED

La ruta iniciaba `finalUserContent` con `historyWindowNotice`, pero cuando la
referencia visual estaba activa y `renderHtmlToInlineImage` devolvía una imagen,
la reasignación de esa rama comenzaba de nuevo desde `userMessageContent`. Eso
eliminaba la nota obligatoria antes de entregar el payload a Fireworks.

Primero se añadieron dos pruebas de ruta que activan
`OPENLEN_AIDESIGN_PAGE_REFERENCE=1`, usan el mock de render existente y agotan
el SSE antes de inspeccionar `mocks.fireworksStream.mock.calls[0][0]`.

Comando RED:

```powershell
node .\node_modules\vitest\vitest.mjs run app/api/templates/ai-design/route.test.ts -t "con referencia visual conserva la nota"
```

Resultado: código 1; la prueba recibió `VISUAL CONTEXT` en el mensaje real del
escritor, pero no `CONVERSATION MEMORY WINDOW: 12/13`. Por tanto el fallo era
la rama de referencia, no el cálculo de la ventana original.

### Cambio y contra-prueba

La reasignación de la rama visual ahora vuelve a anteponer
`${historyWindowNotice}` a `${userMessageContent}` antes de añadir
`VISUAL CONTEXT`. No se cambió la sanitización, los límites, los proveedores ni
`/api/agent`.

La prueba primaria verifica 13/13 + referencia: render invocado con el HTML
actual, la nota `12/13` y el contexto visual llegan juntos al payload real. La
contra-prueba verifica 12/12 + referencia: llega el contexto visual pero no se
inventa la nota de recorte.

Comando GREEN focal:

```powershell
node .\node_modules\vitest\vitest.mjs run app/api/templates/ai-design/route.test.ts -t "referencia visual"
```

Resultado: código 0; 2 aprobadas, 31 omitidas.

### Sabotaje, restauración y verificación

Se reintrodujo temporalmente la asignación antigua
`finalUserContent = \`${userMessageContent}...\`` y se ejecutó de nuevo la
prueba primaria. Resultado: código 1 y el mismo error esperado: faltaba
`CONVERSATION MEMORY WINDOW: 12/13` aunque `VISUAL CONTEXT` sí estaba presente.
Se restauró `${historyWindowNotice}${userMessageContent}` y se inspeccionaron
las líneas 585 y 590 de la ruta para confirmar ambos prefijos.

Verificación posterior:

```powershell
node .\node_modules\typescript\bin\tsc --noEmit
node .\node_modules\vitest\vitest.mjs run app/api/templates/ai-design/route.test.ts
```

- `tsc --noEmit`: código 0, salida vacía.
- Vitest dirigido: código 0; 1 archivo y 33 pruebas aprobadas.

Auto-revisión: el prefijo se conserva en las dos formas de `finalUserContent`,
incluida la única rama que agrega referencia visual; el control rojo confirma
que la prueba fallaría con el error original. No hay cambios de datos,
persistencia, `data-slot-path=`, llamadas de pago, servidor, push o deploy.
