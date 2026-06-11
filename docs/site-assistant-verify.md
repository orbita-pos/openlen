# Verificar el Asistente del sitio (cuando recargues Gemini)

El motor, el widget, el panel y el metering ya están en master, con tsc limpio +
28 tests unitarios + i18n verde + el panel verificado en navegador. Lo único que
falta es la prueba que **necesita saldo de Gemini**: que el modelo de verdad
obedezca las reglas. Esta nota es para correr eso cuando recargues.

## Prerrequisito — recargar el prepago de Gemini

El `GEMINI_API_KEY` es **prepago y está agotado**. El gateway lo muestra como
`rate limited by upstream`, pero el error real de Google es
`429 RESOURCE_EXHAUSTED — "Your prepayment credits are depleted."`. **No se
arregla esperando; hay que recargar:**

- https://ai.studio/projects → billing (o activa pago automático).
- Es el mismo key compartido con las otras sesiones — una recarga destraba todo.

## 1. Evals del modelo — lo que el saldo destraba (~$0.01)

```bash
npm run assistant:evals
```

- Corre **18 casos** contra un negocio de prueba: *golden* (responde bien con la
  info de la página/cerebro), *lead/handoff* (captura datos), *refusal* (declina
  off-topic — incluye "¿cuándo juega México?" y "2+2"), y *trampas* (inyección de
  prompt, descuento inventado, precio fuera de la página, role-swap con `<|system|>`).
- Salida ✓/✗ por caso. En los ✗ dice **exactamente qué regla incumplió**
  (intent equivocado, dato prohibido, precio inventado…).
- Subconjunto mientras iteras: `npm run assistant:evals -- --only trap/`
  (también `golden/`, `refusal/`, `lead/`, `handoff/`).
- Señal de "sigue sin saldo": el primer caso falla con `rate limited` / 429.

### Si fallan casos
1. Ajusta las reglas en `lib/site-assistant/prompt.ts` (`buildSystemPrompt`).
2. Re-corre solo ese grupo (`--only ...`). Itera hasta verde.
3. ¿El modelo se queda corto? Sube de tier sin tocar código:
   `ASSISTANT_MODEL=gemini-3.1-flash-lite npm run assistant:evals`
   (el endpoint lee el mismo env `ASSISTANT_MODEL`, default `gemini-2.5-flash-lite`).

## 2. E2E en la app — toggle/guardar/publicar/widget

Necesita el dev server + un proyecto. La parte de panel (toggle/guardar) **no**
gasta Gemini; solo el chat publicado consume.

```bash
npx next dev      # webpack — NO `npm run dev` (Turbopack sale vacío con los nativos)
```

Abre un proyecto (`/new?project=...`) → pestaña ✨ **Asistente** (solo en modo
edición). Checklist:

- [ ] El toggle "Activar" prende y **persiste** (recarga la página → sigue ON).
- [ ] Escribir el cerebro del negocio + **Guardar** → "Guardado ✓".
- [ ] Se ve la barra "Mensajes este mes — X/cap".
- [ ] **Publicar** → abrir el sub publicado → aparece la burbuja ✨ abajo-derecha.
- [ ] Preguntar algo de la página → responde correcto.
- [ ] Preguntar "¿cuándo juega México?" → **declina amable** y reencauza.
- [ ] Preguntar algo no cubierto → pide nombre+correo → **llega el lead** al
      backend de forms + correo (Resend).
- [ ] La burbuja aparece en **todas** las páginas del sitio (multi-página), y el
      asistente contesta sobre subpáginas aunque el visitante esté en el home.

## Referencia rápida

| Cosa | Dónde |
|---|---|
| Prompt de grounding | `lib/site-assistant/prompt.ts` |
| Extractor HTML→texto | `lib/site-assistant/extract-text.ts` |
| Cuota/cap por plan (free 30 / pro 1000 por sitio) | `lib/site-assistant/quota.ts` |
| Endpoint público del chat | `app/api/assistant/[sub]/route.ts` |
| Widget (Shadow DOM) + inyección | `lib/publish/assistant-widget.ts` |
| Panel del workspace | `components/workspace-v2/panels/assistant-panel.tsx` |
| Settings API (GET/PATCH) | `app/api/projects/[id]/assistant/route.ts` |
| Harness de evals | `scripts/assistant-evals.ts` |

Notas: cap por sitio separado de los créditos de creación (anti denial-of-wallet);
sobre el cap → degrada a captura de lead (no error); el cerebro del negocio nunca
viaja en el HTML publicado (el widget lo lee server-side).
