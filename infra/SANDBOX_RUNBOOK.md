# La terminal real de Len (E2B) — runbook

Spec local: `docs/superpowers/specs/2026-10-21-real-terminal-e2b-design.md`. Código: `lib/agent/sandbox/`.
Invariante 5 de `CLAUDE.md`. Con `E2B_API_KEY`, el `bash` de Len corre en una caja de E2B por proyecto;
sin ella, o si la caja falla, en la terminal de siempre (interpreta, no ejecuta).

## 0. Lo que el deploy ya hace solo

- La tabla `projectSandboxes`: `sandbox-migrate` va en `scripts/build-migrations.mjs`, y el deploy la corre con
  las demás. A mano: `npm run sandbox:migrate`.
- El cron `cron/sandbox-reaper.mjs` viaja en el tarball (`scripts/build-cron.mjs`).
- **No** instala las unidades de systemd (§7) ni construye la plantilla (§6): las dos cosas son a mano.

## 1. Las variables (`/etc/openlen/openlen.env`)

| Variable | Qué hace |
|---|---|
| `E2B_API_KEY` | La enciende. Sin ella, todo turno usa la terminal de siempre, sin decir nada. |
| `OPENLEN_SANDBOX=0` | La apaga aunque haya clave. El reaper y el borrado de proyectos siguen matando cajas con la clave. |
| `OPENLEN_SANDBOX_DAILY_USD` | Tope de OpenLen para TODO el gasto de E2B por día UTC (5 por defecto). Pasado, la terminal de siempre con su aviso. |
| `OPENLEN_SANDBOX_ONLY_USERS` | Ids de usuario separados por comas: sólo ellos tienen caja. Para los primeros días. |

Cambiar una: `systemctl restart openlen-app`.

## 2. Encender por primera vez

1. Cuenta de E2B y su clave (`https://console.e2b.dev (pestaña Keys)`).
2. El paquete `e2b`, a versión exacta, y `loadE2bSdk` (`lib/agent/sandbox/e2b-driver.ts`) pasado a `import("e2b")`
   literal, para que el empaquetado lo lleve.
3. La plantilla (§6).
4. En `/etc/openlen/openlen.env`: `E2B_API_KEY=…` y `OPENLEN_SANDBOX_ONLY_USERS=<tu id>`; `systemctl restart openlen-app`.
5. El temporizador (§7).
6. Un turno de Len que corra `python3 -c "print(2+2)"`, y mirar el registro:

```bash
ssh openlen 'journalctl -u openlen-app --since "10 min ago" | grep "\[sandbox\]"'
```

Sin líneas `[sandbox] fallback`, la caja abrió.

## 3. Apagar

`OPENLEN_SANDBOX=0` y `systemctl restart openlen-app`. Los turnos siguientes usan la terminal de siempre, sin
aviso (está apagada a propósito). Las cajas pausadas se quedan hasta que el reaper las mate (una semana) o hasta
matarlas a mano (§5).

## 4. Ver cómo va (psql de la base de la app)

Lo cobrado hoy (día UTC), en dólares y créditos. El tope (`OPENLEN_SANDBOX_DAILY_USD`) suma además lo que llevan las cajas que corren ahora, que se cobra al cerrar su turno:

```sql
SELECT count(*) AS cobros, sum("costMicroUsd") / 1e6 AS usd, sum("centicredits") / 100.0 AS creditos
FROM "creditLedger"
WHERE "surface" = 'sandbox' AND "createdAt" >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
```

Las cajas, las últimas primero:

```sql
SELECT "projectId", "sandboxId", "state", "heldBy", "pausedAt", "updatedAt"
FROM "projectSandboxes" ORDER BY "updatedAt" DESC LIMIT 20;
```

Por qué cayó a la terminal de siempre (`only_users`, `conflict`, `held`, `budget`, `open_failed`, `died`):

```bash
ssh openlen 'journalctl -u openlen-app --since today | grep -o "\[sandbox\] fallback .*reason=[a-z_]*" | grep -o "reason=[a-z_]*" | sort | uniq -c'
```

## 5. Matar la caja de UN proyecto

```sql
SELECT "sandboxId", "heldBy" FROM "projectSandboxes" WHERE "projectId" = '<id>';
```

Matarla en E2B (panel, o su CLI: `e2b sandbox kill <sandboxId>`) y olvidar la fila:

```sql
DELETE FROM "projectSandboxes" WHERE "projectId" = '<id>' AND "heldBy" IS NULL;
```

El siguiente turno del proyecto crea una nueva desde los ficheros de Postgres. Si `heldBy` no es nulo y no hay
ningún turno de ese proyecto en marcha, la reserva quedó colgada. Un deploy (SIGTERM) no la deja: antes de salir,
cada turno vivo cierra su caja (la pausa, la suelta y la cobra hasta ese momento; `lib/agent/exit-flush.ts`). Si la
app murió de golpe (un fallo, un kill), al arrancar toma esas reservas con la suya (`boot-…`), pausa cada caja, la
suelta y cobra al dueño lo que corrió hasta el arranque (`lib/agent/close-dead-turns.ts`, línea `[dead-turns]` en el
diario), menos las del barrendero (`reaper-…`). Si no, se suelta sola a las 2 horas (el siguiente turno la toma) y
mientras tanto cada turno de ese proyecto cae a la terminal de siempre con `reason=held`. Para no esperar:

```sql
UPDATE "projectSandboxes" SET "heldBy" = NULL WHERE "projectId" = '<id>';
```

## 6. Rehacer la plantilla

La plantilla vive en `infra/e2b/openlen-terminal/` (lo que lleva, en su README). Una plantilla cambiada es un
NOMBRE nuevo en `SANDBOX_TEMPLATE` (`lib/agent/sandbox/config.ts`, p. ej. `openlen-terminal-v2`):

```bash
npm run sandbox:template
```

y después el deploy. La caja de cada proyecto nacida de la plantilla vieja se mata y se cambia por una nueva en su
siguiente turno; las que no vuelven a usarse, las mata el reaper.

## 7. El temporizador de las cajas viejas

`openlen-sandbox-reaper.timer` corre a diario (10:00 UTC) y mata las cajas sin usar desde hace más de 7 días (pausadas, o que un turno caído dejó «running»). Instalarlo
(una vez):

```bash
scp infra/app/openlen-sandbox-reaper.service infra/app/openlen-sandbox-reaper.timer openlen:/etc/systemd/system/
ssh openlen 'systemctl daemon-reload && systemctl enable --now openlen-sandbox-reaper.timer'
```

Ver cómo fue: `ssh openlen 'journalctl -u openlen-sandbox-reaper --since yesterday'` («matadas N · fallidas M»; con
alguna fallida sale con 1 y la unidad queda en fallo). `npm run infra:drift` compara las dos unidades con las del repo.
