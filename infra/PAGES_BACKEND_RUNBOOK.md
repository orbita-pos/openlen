# El backend de las páginas — runbook del primer deploy

La rama `pages-backend` (diseño y estado en `plans/pages-backend/design.md`, fuera del repo): cada página puede tener
su backend de Supabase —`/rest/v1` (PostgREST) y `/auth/v1` (GoTrue)— sobre una base de Postgres propia, en un clúster
aparte del de la app. Esto es lo que hay que hacer en la caja, en orden. **Nada de esto está aplicado todavía.**

## 0. Antes: lo que el deploy ya hace solo

- **La migración** `pages-backend-migrate` (tablas `projectBackends` y `projectFiles`) va en el paquete de migraciones
  (`scripts/build-migrations.mjs`) y corre en el paso 6 de `deploy.ps1`, antes del código. Aditiva e idempotente.
- **Caddy**: el `Caddyfile` del repo ya lleva `handle /rest/v1/*` y `handle /auth/v1/*` en el comodín de `*.openlen.app`,
  y el paso 8 del deploy lo sube y lo recarga. El host del proyecto (`<ref>.openlen.app`) entra por el mismo comodín.
- **El proxy de salida de Chromium** (`lib/security/egress-proxy.ts`) vive dentro del proceso de Next: no pide nada en la
  caja.

## 1. El clúster de las páginas (una vez, como root, ANTES del deploy)

```bash
scp infra/db/setup-pages-cluster.sh openlen:/tmp/
ssh openlen "sudo bash /tmp/setup-pages-cluster.sh"
```

Crea el clúster `17/pages` en `127.0.0.1:5433`, el administrador `openlen_pages_admin` (CREATEDB + CREATEROLE +
BYPASSRLS + `createrole_self_grant = 'set, inherit'`, **no** superusuario) y añade a `/etc/openlen/openlen.env`:

- `PAGES_DATABASE_URL` — la URL de ese administrador.
- `PAGES_AUTHENTICATOR_PASSWORD` — la del rol `authenticator`, con el que se atienden las peticiones.

Es idempotente y no pisa variables que ya estén. Sin estas dos variables la app no finge un backend:
`/rest/v1` y `/auth/v1` contestan 503 y el panel dice «no está disponible en este servidor».

⚠️ Los roles de Supabase (`anon`, `authenticated`, `service_role`, `authenticator`, `supabase_auth_admin`) los crea la
app la primera vez que un proyecto pide su base, y **tiene que crearlos ese administrador**: si los creara otro, no
podría concederlos (medido: «permission denied to grant role "anon"»). No crearlos a mano.

## 2. El deploy

```bash
npm run deploy:prod
```

## 3. En la MISMA ventana: las 5 plantillas, desde la caja

🔴 **No con `npm run templates:republish` desde el portátil**: su `DATABASE_URL` es la base local de desarrollo, así
que escribiría allí, imprimiría `ok` y producción no cambiaría (`fbc52872`). Se republican EN la caja, con la ruta
interna y las fuentes que el deploy deja en `/opt/openlen-app/templates-starter/` (DEPLOY_RUNBOOK §0,
`OPENLEN_INTERNAL_SECRET`). Dentro de `ssh openlen`, primero en seco y después con los mismos ids:

```bash
S=$(sudo grep -oP '^OPENLEN_INTERNAL_SECRET=\K.*' /etc/openlen/openlen.env)
curl -s -X POST -H "x-internal-secret: $S" -H "content-type: application/json" \
  -d '{"ids":["altanube","avenir","brote","gremio","yunque"]}' \
  http://127.0.0.1:3000/api/internal/republish-templates
curl -s -X POST -H "x-internal-secret: $S" -H "content-type: application/json" \
  -d '{"aplicar":true,"ids":["altanube","avenir","brote","gremio","yunque"]}' \
  http://127.0.0.1:3000/api/internal/republish-templates
```

Desplegar sin subirlas deja clonar las 5 viejas (altanube, avenir, brote, gremio, yunque) con conductas `data-ol-*`
cuyo código ya no existe: el menú fijo y los botones de copiar, muertos.

## 4. La copia nocturna de las bases de las páginas

`backup-system-to-r2.sh` gana la sección `pages/`: cada base `ol_<ref>` con `pg_dump` y los roles sin contraseña,
cifrado y a R2 como la base de la app. Instalarla (a mano, como el resto de la configuración del box):

```bash
scp infra/scripts/backup-system-to-r2.sh openlen:/tmp/
ssh openlen "sudo install -m 755 /tmp/backup-system-to-r2.sh /opt/openlen-backup/backup-system-to-r2.sh"
ssh openlen "command -v psql pg_dumpall"   # vienen con postgresql-client
```

Al restaurar: `roles.sql` primero, luego `pg_restore` de cada base. Las contraseñas no viajan: la de `authenticator`
la repone `provisionDatabase` desde `openlen.env`, y la de cada rol de desarrollador está cifrada en
`projectBackends.dbPasswordEncrypted` (base de la app).

## 4b. Storage de las páginas (carril D de Len 2.5: `/storage/v1`, `lib/backend/storage`)

Los ficheros que suben los visitantes van a **R2** (Jesús, 04/10), a un bucket propio y **privado**: nada se sirve
desde R2, todo sale por `/storage/v1` en `<ref>.openlen.app`, que pone las cabeceras.

1. En Cloudflare → R2: crear el bucket `openlen-page-storage`, **sin** dominio público ni acceso público. Las
   credenciales que ya usa la app (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY`, `R2_SECRET_KEY`) tienen que poder leer y escribir
   en él (si el token está limitado a otros buckets, añadirle éste).
2. Si el bucket se llama de otra forma: `PAGES_STORAGE_R2_BUCKET=<nombre>` en `/etc/openlen/openlen.env`.
3. Opcional: `PAGES_STORAGE_FILE_SIZE_LIMIT` (bytes por fichero; por defecto 52428800 = 50 MB, el del plan gratis de
   Supabase; Cloudflare corta los cuerpos en 100 MB) y `PAGES_STORAGE_PROJECT_LIMIT` (bytes por proyecto; por
   defecto 1 GB).
4. `sudo systemctl restart openlen-app`.

Sin credenciales de R2, `/storage/v1` contesta 503 «Storage is not available on this server»: no se finge.

El esquema `storage` (las 73 migraciones de `supabase/storage`) y el rol `supabase_storage_admin` los monta la app sola
la primera vez que un proyecto usa su backend (una petición o un `supabase db push`), también en las bases que ya
existían. No crearlos a mano.

Borrar un proyecto desde la app se lleva sus ficheros (`<ref>/` en el bucket). Los de un proyecto borrado a mano se ven
en el bucket bajo su `ref`.

## 4c. Realtime de las páginas (carril D de Len 2.5: `/realtime/v1`, `lib/backend/realtime`)

Un servicio Node aparte (`openlen-realtime`, `127.0.0.1:4100`): Next no sostiene WebSockets. Broadcast y presence no
tocan la base; `postgres_changes` lee la WAL con wal2json desde un slot TEMPORAL por proyecto con suscriptores, y los
canales privados miran RLS en `realtime.messages`. El esquema `realtime` lo monta la app sola, como el de Storage.

En este orden (el 2 reinicia el clúster de las páginas: unos segundos sin `/rest/v1`, `/auth/v1` ni `/storage/v1`;
mejor a una hora tranquila):

1. El código desplegado (lleva `/opt/openlen-app/realtime/server.mjs`, el bloque de Caddy y la unidad en `infra/app/`).
2. `sudo bash infra/db/setup-pages-cluster.sh` otra vez: instala `postgresql-17-wal2json`, pone `wal_level = logical`,
   `max_replication_slots = 64` y `max_slot_wal_keep_size = 2GB`, reinicia el clúster, le da al administrador `SET ON
   PARAMETER log_min_messages` y crea `openlen_realtime` (LOGIN REPLICATION, nada más) con `PAGES_REALTIME_PASSWORD` en
   `/etc/openlen/openlen.env`. Es idempotente.
3. `sudo install -m 644 /opt/openlen-app/../<repo>/infra/app/openlen-realtime.service /etc/systemd/system/` (o
   `install-app.sh`), `sudo systemctl daemon-reload && sudo systemctl enable --now openlen-realtime`. A partir de aquí
   el deploy la reinicia tras cada swap.
4. Opcionales en `/etc/openlen/openlen.env` (los de Supabase por defecto): `PAGES_REALTIME_MAX_CONCURRENT_USERS` (200),
   `PAGES_REALTIME_MAX_EVENTS_PER_SECOND` (100), `PAGES_REALTIME_MAX_JOINS_PER_SECOND` (100),
   `PAGES_REALTIME_MAX_CHANNELS_PER_CLIENT` (100), `PAGES_REALTIME_MAX_PAYLOAD_SIZE_KB` (3000).

El servicio lleva el Janitor de Supabase: a los 10 minutos de arrancar y luego cada 4 horas, en cada proyecto con
canales privados desde que arrancó, borra las particiones diarias de `realtime.messages` de hace más de 72 horas y crea
las de los días que vienen. No hay nada que activar.

Sin el paso 2, broadcast y presence funcionan y `postgres_changes` contesta su error («Realtime was unable to connect
to the project database» o el de crear el slot): no se finge.

🔴 Lo que sólo se puede probar en la caja: el slot de wal2json de verdad (PGlite no tiene replicación lógica y el
Postgres de la máquina de desarrollo no trae wal2json). Lo demás —la publicación, las suscripciones, `apply_rls`, el
reparto— está probado con el código de producción. El formato de wal2json se compara en el paso 5.

## 5. Comprobar

```bash
# La puerta de GoTrue de un proyecto que ya tenga backend (el ref sale del panel o de projectBackends):
curl -s https://<ref>.openlen.app/auth/v1/health
# → {"version":"openlen","name":"GoTrue",...}

# Storage (carril D): la lista de buckets con la clave secreta del proyecto (sale del panel).
curl -s https://<ref>.openlen.app/storage/v1/bucket -H "apikey: <sb_secret_…>" -H "authorization: Bearer <sb_secret_…>"
# → [] (o sus buckets). Un 503 «Storage is not available» = faltan las credenciales de R2.
# Listar NO toca R2: el bucket de R2 sólo se prueba subiendo un fichero. Si al subir sale
# «…: its storage bucket does not exist» o «…: it has no access to its storage bucket» (503), es el §4b:
# crear el bucket o añadirlo al token `openlen-app`. El registro de openlen-app dice cuál.
# Y en el host de la PÁGINA tiene que dar 404 (un fichero subido nunca vive en el origen de la página):
curl -s -o /dev/null -w "%{http_code}\n" https://<sub>.openlen.app/storage/v1/bucket -H "apikey: <sb_secret_…>"
# → 404

# Realtime (carril D): el servicio y su puerta (sin upgrade contesta como HTTP).
systemctl is-active openlen-realtime
curl -s https://<ref>.openlen.app/realtime/v1/websocket -H "apikey: <sb_publishable_…>"
# → {"error":"Upgrade required"} (400). Un 502 = la unidad no está corriendo.
# El slot de verdad: con un canal de postgres_changes abierto en una página, en la caja
sudo -u postgres psql -p 5433 -d ol_<ref> -Xc "select slot_name, plugin, temporary, active from pg_replication_slots"
# → realtime_<ref> | wal2json | t | t   (y al cerrar la pestaña, desaparece)
# Y que wal2json da lo que apply_rls espera: una fila nueva en una tabla publicada tiene que llegar al navegador
# con `new` (y la de otro usuario NO, si su RLS lo separa).
```

- En el editor, una página con backend enseña el icono «Base de datos» en el rail (sólo si su base existe).
- Len: pedirle algo que guarde datos («que las reseñas se queden») y ver que escribe la migración y la aplica con
  `supabase db push`.

## Al borrar a mano una cuenta o un proyecto

Borrar un proyecto desde la app ya se lleva la base de su página y su rol `ol_<ref>` (`lib/backend/teardown.ts`). Lo
que NO pasa por ahí deja la base en el clúster de las páginas, con las cuentas de los visitantes dentro y sin dueño:
una cuenta o un proyecto borrados a mano en SQL (la cascada se lleva la fila de `projectBackends`, no la base del otro
clúster), o un borrado que falló (en el registro: «no se pudo borrar la base de la página <ref>»). Después de borrar a
mano, o si sale esa línea:

```bash
scp infra/db/pages-orphans.sh openlen:/tmp/
ssh openlen "sudo bash /tmp/pages-orphans.sh"                 # sólo lista
ssh openlen "sudo bash /tmp/pages-orphans.sh --drop <ref>"    # borra las que se nombren
```

Sin argumentos no toca nada. Con `--drop` sólo borra un `ref` que esté en la lista de huérfanas; uno con dueño se
salta. Si no puede leer `projectBackends`, se para sin tocar nada.

## Lo que se sabe de antemano

- `taller` y `marea` (de Jesús) llamaban a `/api/d/*`, retirado con `data-ol-stores`: Caddy les contestará con la
  página estática. 0 filas en `pageData`.
- La visita de Len (`usar_pagina`) usa la base REAL, como la vista previa de Lovable; puede entrar como un usuario que
  ya existe (`sign_in_as`). Si Len rellena un registro, sale un correo de confirmación de verdad.
- `lienzo-<id>.openlen.app` comparte sitio con las publicadas hasta que `openlen.app` esté en la Public Suffix List.

## Marcha atrás

El clúster puede quedarse: sin las variables, la app no lo toca. Volver al release anterior con el procedimiento de
siempre (`DEPLOY_RUNBOOK.md`). Las bases `ol_*` que se hubieran creado siguen ahí, con sus datos.
