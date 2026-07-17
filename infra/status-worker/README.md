# openlen-status — status.openlen.com

Worker de Cloudflare: monitorea prod cada 5 min (app, página canaria, API+DB),
guarda historial en D1, sirve la página de estado y alerta por email vía Resend.
La lógica de estado vive en `src/logic.ts` (funciones puras, tests en vitest del repo).

## Setup one-time (cuenta de Cloudflare, requiere autorización)

Desde `infra/status-worker/`:

0. `npx wrangler login` (OAuth de la cuenta de Cloudflare; una sola vez por máquina).
1. `npx wrangler d1 create openlen-status` → pegar el `database_id` en wrangler.toml.
2. `npx wrangler d1 execute openlen-status --remote --file=schema.sql` (reporta
   "3 commands executed" — 2 tablas + 1 índice).
3. `npx wrangler secret put RESEND_API_KEY`   (misma key del box)
4. `npx wrangler secret put ALERT_EMAIL`      (email personal del operador — NUNCA en el repo)
5. Elegir canario: una página estable del explore de @openlen → poner el host
   (p.ej. `algo.openlen.com`) en `CANARY_HOST` de wrangler.toml.
6. `npx wrangler deploy`
7. Verificar: `curl -s https://status.openlen.com | grep -c "status-dot"` → 3,
   y `curl -s https://status.openlen.com/api/summary | jq .overall`.

> ⚠️ El check de páginas depende del cache-buster `?sc=`: si algún día una
> Cache Rule de Cloudflare usa una custom cache key que IGNORE la query string,
> el buster queda derrotado en silencio y el check reportaría UP con el origen
> muerto. Si se tocan las cache rules, re-verificar este check.

## Simulacro de caída (validar alertas end-to-end)

1. Deploy temporal con `CANARY_HOST = "no-existe-drill.openlen.com"`.
2. Esperar 2 runs del cron (~10-12 min) → email 🔴 + página en rojo.
3. Restaurar `CANARY_HOST` real + `npx wrangler deploy` → email 🟢.

## Typecheck / tests

- `npx tsc -p infra/status-worker --noEmit` (o `npm run status:typecheck`)
- `npx vitest run infra/status-worker` (registrado en el include de vitest.config.ts)
