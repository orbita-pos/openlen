# Edge Functions — runbook

Las Edge Functions de las páginas y las apps (spec local `docs/superpowers/specs/2026-10-11-edge-functions-design.md`):
el formato de Supabase por fuera (`supabase/functions/<nombre>/index.ts`, `Deno.serve`, `supabase secrets set`) y
nuestro motor por dentro. **Hoy están APAGADAS en producción**: sin `OPENLEN_FUNCTIONS_ENGINE` no corre nada,
`/functions/v1` contesta 503 y Len no las ofrece. El motor de producción será AWS Lambda (fase 3b, pendiente: ver §6).

## 0. Lo que el deploy ya hace solo

- **La migración** `functions-migrate` va en el paquete de migraciones (`scripts/build-migrations.mjs`) y corre antes
  del código: `functionDeployments` (con el paquete de producción, `bundleGz`), `functionUsage` (con
  `quotaAlertedPercent`), `functionPools` (con
  `alertedAt`), `functionInvocations`, `functionSecrets`, `functionBlocks` y el ref propio del borrador en
  `projectBackendEnvironments`. Aditiva e idempotente.
- **Caddy**: el `Caddyfile` del repo lleva `handle /functions/v1/*` en el comodín de `*.openlen.app` (con streaming).
- **El catálogo** de lo que una función puede importar va en el repo (`lib/functions/vendor/<catálogo>/`), congelado.
  Al empaquetar no se descarga nada.

## 1. Las variables (`/etc/openlen/openlen.env`)

| Variable | Qué hace | Hoy |
|---|---|---|
| `OPENLEN_FUNCTIONS_ENGINE` | El motor. Vacía = apagadas. `local` sólo para desarrollo (ver abajo). | vacía |
| `OPENLEN_FUNCTIONS=0` | Apaga TODAS las funciones aunque haya motor: 503 al momento. | — |
| `OPENLEN_FUNCTIONS_CAP_FREE_USD` | Tope del mes de la bolsa gratis, en dólares a precio de lista. | 0.25 |
| `OPENLEN_FUNCTIONS_CAP_PAID_USD` | Tope del mes de la bolsa de pago. **Súbelo antes de tener clientes de pago de verdad**: al llenarse, corta a gente dentro de su cuota. | 0.75 |
| `OPENLEN_FUNCTIONS_ALERT_EMAIL` | A quién va el aviso del 80 % de cada bolsa. Sin ella, `ABUSE_REPORT_EMAIL`; sin ésa, `info@jesusbr.com`. | — |
| `OPENLEN_FUNCTIONS_ALLOW_LOCAL_IN_PRODUCTION` | Deja usar el motor `local` con `NODE_ENV=production`. **No en la caja**: corre código ajeno dentro del proceso de la app. | — |

Cambiar una variable = reiniciar la app (`sudo systemctl restart openlen-app`).

## 2. Ver cómo van (psql de la base de la app)

```bash
ssh openlen
sudo -u postgres psql -p 5432 -d openlen
```

```sql
-- Las dos bolsas del mes: lo gastado y lo reservado, en dólares.
select "month", "pool", "spentNanoUsd" / 1e9 as gastado, "reservedNanoUsd" / 1e9 as reservado, "alertedAt"
  from "functionPools" order by "month" desc, "pool";

-- Los 20 proyectos con más llamadas este mes.
select u."projectId", p."title", u."calls", u."nanoUsd" / 1e9 as dolares
  from "functionUsage" u join "projects" p on p."id" = u."projectId"
 where u."month" = to_char(now() at time zone 'utc', 'YYYY-MM')
 order by u."calls" desc limit 20;

-- Los últimos errores de un proyecto (ya tapados).
select "startedAt", "environment", "name", "status", "errorCode", left("error", 200)
  from "functionInvocations" where "projectId" = '<id>' and ("status" >= 500 or "errorCode" is not null)
 order by "startedAt" desc limit 20;
```

## 3. Apagar las funciones de UN proyecto (abuso)

```sql
insert into "functionBlocks" ("projectId", "reason") values ('<id>', '<por qué>');
-- y para encenderlas otra vez:
delete from "functionBlocks" where "projectId" = '<id>';
```

Con la marca, sus llamadas (la página, el lienzo y el `curl` de Len) contestan 503 «Edge Functions are disabled for
this project» sin contar ni gastar, y su vista Base de datos → Funciones lo dice. Para todas a la vez:
`OPENLEN_FUNCTIONS=0` (§1).

## 4. Los avisos

- **Al dueño**, cuando las llamadas del mes de un proyecto llegan al 80 % y al 100 % de su plan: push y correo (el
  correo en inglés, como el del chat), uno por nivel y mes (lo marca `functionUsage.quotaAlertedPercent`). Al 100 %
  las llamadas siguientes dan 429 hasta que acabe el mes.
- **Al operador**, cuando lo gastado de una bolsa pasa del 80 % de su tope: un correo al mes por bolsa (lo marca
  `functionPools.alertedAt`). Para que vuelva a avisar este mes: `update "functionPools" set "alertedAt" = null where
  "month" = '<AAAA-MM>' and "pool" = '<free|paid>';`.

## 5. Los secretos

- Viven en `functionSecrets`, **cifrados con una llave que sale de `NEXTAUTH_SECRET`** (`lib/integrations/crypto.ts`):
  rotar ese secreto deja ilegibles TODOS los secretos de las funciones (y las demás integraciones). No se rota sin un
  plan para volver a pedirlos.
- Nadie los ve: ni la vista, ni Len, ni el operador desde la interfaz. La huella (sha256) sí.
- Borrar un proyecto se lleva sus secretos, lo desplegado, su uso y sus llamadas (en cascada).

## 6. Pendiente: el motor de producción (fase 3b)

Parado el 12/10 por Jesús hasta decidir la **salida a red**: AWS cobra a $0,09/GB lo que una función manda a internet,
y lo que una función manda por su cuenta no pasa por nuestra puerta, así que el tope exacto tiene un hueco. Cuando se
decida, la fase 3b trae: el motor `lambda` (con el SDK `@aws-sdk/client-lambda`, que instala Jesús), la cuenta de AWS
sólo para esto (raíz con MFA, el usuario IAM con permiso sólo sobre `openlen-*`, el rol de ejecución vacío, el
presupuesto de $1 con su acción de denegar), comprobar los precios de `lib/functions/meter.ts`, el ensayo de caja con
AWS y los turnos reales de Len. Este runbook gana entonces su sección de AWS.
