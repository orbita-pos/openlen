# Edge Functions — runbook

Las Edge Functions de las páginas y las apps (specs locales `docs/superpowers/specs/2026-10-11-edge-functions-design.md`
y `2026-10-12-edge-functions-cloudflare-design.md`): el formato de Supabase por fuera (`supabase/functions/<nombre>/index.ts`,
`Deno.serve`, `supabase secrets set`) y nuestro motor por dentro. El de producción es **Cloudflare Workers for Platforms**
(§6). **Hasta encenderlo, están APAGADAS en producción**: sin `OPENLEN_FUNCTIONS_ENGINE` no corre nada,
`/functions/v1` contesta 503 y Len no las ofrece.

## 0. Lo que el deploy ya hace solo

- **La migración** `functions-migrate` va en el paquete de migraciones (`scripts/build-migrations.mjs`) y corre antes
  del código: `functionDeployments` (con el paquete de producción, `bundleGz`), `functionUsage` (con
  `quotaAlertedPercent`), `functionPools` (con
  `alertedAt`), `functionInvocations`, `functionSecrets`, `functionBlocks` y el ref propio del borrador en
  `projectBackendEnvironments`. Aditiva e idempotente.
- **Caddy**: el `Caddyfile` del repo lleva `handle /functions/v1/*` en el comodín de `*.openlen.app` (con streaming).
- **El catálogo** de lo que una función puede importar va en el repo (`lib/functions/vendor/<catálogo>/`), congelado.
  Al empaquetar no se descarga nada.
- **El despachador** (`lib/functions/engines/cloudflare/dispatcher.mjs`) vive en Cloudflare: el deploy NO lo sube. Si
  cambia, se vuelve a subir con `functions:cloudflare-setup` (§6).

## 1. Las variables (`/etc/openlen/openlen.env`)

| Variable | Qué hace | Hoy |
|---|---|---|
| `OPENLEN_FUNCTIONS_ENGINE` | El motor: `cloudflare` en producción (§6); `local` sólo para desarrollo (ver abajo). Vacía = apagadas. | vacía |
| `OPENLEN_FUNCTIONS=0` | Apaga TODAS las funciones aunque haya motor: 503 al momento. | — |
| `OPENLEN_CF_ACCOUNT_ID` | La cuenta de Cloudflare (la de openlen.com). | — |
| `OPENLEN_CF_API_TOKEN` | Token con permiso «Workers Scripts: Edit» y nada más; otro que el `CLOUDFLARE_API_TOKEN` de purgar la caché. | — |
| `OPENLEN_CF_NAMESPACE` | El namespace de Workers for Platforms de los scripts de los proyectos (`openlen-functions`). | — |
| `OPENLEN_CF_DISPATCH_URL` | La dirección del despachador: la imprime `functions:cloudflare-setup`. | — |
| `OPENLEN_CF_DISPATCH_KEY` | La clave compartida con el despachador (`openssl rand -hex 32`). | — |
| `OPENLEN_FUNCTIONS_CAP_FREE_USD` | Tope del mes de la bolsa gratis, en dólares a precio de lista, contando toda la CPU permitida de cada llamada. | 1 |
| `OPENLEN_FUNCTIONS_CAP_PAID_USD` | Igual, la bolsa de pago. Al llenarse corta a gente dentro de su cuota: súbelo cuando avise del 80 %. | 25 |
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
- En Cloudflare, cada script lleva una copia como secreto suyo (la pone el motor al desplegar y cada vez que cambian);
  la de verdad es la de `functionSecrets`.
- Nadie los ve: ni la vista, ni Len, ni el operador desde la interfaz. La huella (sha256) sí.
- Borrar un proyecto se lleva sus secretos, lo desplegado, su uso y sus llamadas (en cascada).

## 6. El motor de producción: Cloudflare Workers for Platforms

Cada proyecto con funciones es un script por entorno (`openlen-<ref>-draft|live`) en un namespace de Workers for
Platforms; nuestra puerta los llama a través del **despachador**, un Worker nuestro que les pone los límites del plan
(CPU 50/200 ms, peticiones a fuera 50/1.000). Cuesta $25 al mes (incluye 20 M llamadas, 60 M ms de CPU y 1.000
scripts) y no cobra lo que las funciones mandan a internet.

**Encenderlo (una vez):**

1. Contratar Workers for Platforms en el panel de Cloudflare (la cuenta de openlen.com).
2. Si la cuenta aún no tiene subdominio `workers.dev`, abrir Workers & Pages una vez en el panel (lo crea).
3. Crear un token de API con permiso **Workers Scripts: Edit** y nada más.
4. Generar la clave del despachador: `openssl rand -hex 32`.
5. Desde una máquina con el repo (en la caja no hay tsx):

   ```bash
   OPENLEN_CF_ACCOUNT_ID=… OPENLEN_CF_API_TOKEN=… OPENLEN_CF_NAMESPACE=openlen-functions OPENLEN_CF_DISPATCH_KEY=… npm run functions:cloudflare-setup
   ```

   Crea el namespace (si no está), sube el despachador e imprime `OPENLEN_CF_DISPATCH_URL=…`.
6. En la caja, en `/etc/openlen/openlen.env`: `OPENLEN_FUNCTIONS_ENGINE=cloudflare` y las cinco `OPENLEN_CF_*`; luego
   `sudo systemctl restart openlen-app`.

**Antes de abrirlo a todos, el ensayo real** (spec local 2026-10-12, Parte 8 y «Riesgos abiertos»): desplegar un
borrador y publicar a producción; llamar a una función, también una que responde en streaming; cambiar un secreto;
pasarse de CPU a propósito y apuntar el mensaje exacto de Cloudflare (el despachador lo trata como límite si dice
«exceeded» o «limit») y **dónde llega**: `worker.mjs` contesta en el acto y la función corre detrás, así que lo más
probable es que el exceso corte el flujo a mitad en vez de lanzar en el `fetch` del despachador; entonces la puerta da
hoy un 500 «the function stopped before finishing» en vez del 546, y el arreglo va en el despachador (reenviar sólo
líneas enteras y, si el flujo se corta con ese mensaje, añadir `{t:"error",kind:"cpu"}` y el fin); comprobar que la
etiqueta `h-<hash>` se guarda entera; que sube un paquete grande (Stripe + OpenAI, el del borrador sin minificar);
borrar un proyecto; y medir lo que tarda la caja en llegar a Cloudflare.

**Ver los scripts:** panel de Cloudflare → Workers for Platforms → el namespace, o
`GET /accounts/{id}/workers/dispatch/namespaces/{ns}/scripts` con el token.

**Cambiar la clave del despachador:** una nueva con `openssl rand -hex 32`, repetir el paso 5 con ella y poner la misma
en `OPENLEN_CF_DISPATCH_KEY`; reiniciar. Entre los dos pasos, las llamadas dan 503.

**Apagarlas todas:** `OPENLEN_FUNCTIONS=0` (§1). **Las de un proyecto:** la marca de §3.
