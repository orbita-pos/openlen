# Runbook — OAuth de los conectores MCP y Google Calendar

Operación y puesta en marcha del OAuth de los conectores MCP (`lib/mcp-connectors/oauth/`, spec local `docs/superpowers/specs/2026-11-17-oauth-de-conectores-mcp-design.md`).

---

## 1. Migración de base de datos

La migración aditiva (`scripts/mcp-connectors-migrate-sql.ts`) crea `personMcpOAuth` y `personMcpOAuthFlows`, añade `authIssuer`, `authReason` y `authScope` a `personMcpServerState`, `fingerprint` a `personMcpOAuth`, y `startedFrom`, `heldTokens` y `confirmHash` a `personMcpOAuthFlows` (revisión final F5). Usa `CREATE TABLE IF NOT EXISTS` y `ALTER TABLE … ADD COLUMN IF NOT EXISTS`: es idempotente.

🔴 **Tiene que estar aplicada ANTES de que el código nuevo sirva**: el código lee esas tablas y columnas (por ejemplo `readServerStates` pide todas las columnas de `personMcpServerState`), y arrancar sin ellas rompe los conectores.

- **En producción la corre el despliegue**: `infra/scripts/deploy.ps1` (paso 6.2) ejecuta en el box `migrations/run.sh`, que lleva la migración `mcp-connectors-migrate` (lista en `scripts/build-migrations.mjs`), contra `DATABASE_URL_DIRECT` (el rol dueño de las tablas) y antes del intercambio atómico. Con `OPENLEN_SKIP_MIGRATE=1` esa corrida se salta y habría que lanzarla a mano en el box.
- **En local**: `npm run mcp-connectors:migrate` lee `.env.local`, es decir, la base de **desarrollo**. No sirve para producción.

---

## 2. Configuración en Google Cloud Console (Google Calendar)

Desde el 24/11/2026 la tarjeta «Conectar» de Google Calendar conecta con **el servidor de Calendar de OpenLen**, `https://mcp.openlen.com/google-calendar` (`lib/google-calendar-mcp/`, spec local `docs/superpowers/specs/2026-11-24-servidor-de-google-calendar-design.md`), como Anthropic sirve `gcal.mcp.claude.com`: Google inicia la sesión de la persona con el cliente de OpenLen, el conector manda ese token a nuestro servidor, el servidor lo comprueba en `tokeninfo` y llama a la Google Calendar API v3. No guarda nada. ⚰️ El servidor de Google (`https://calendarmcp.googleapis.com/mcp/v1`) ya no se usa: es una *Developer Preview* que sólo atiende a quien Google admite como probador.

El cliente vive en su **propio proyecto de Google Cloud, «OpenLen Connectors» (`openlen-connectors`)**, NO en el del login con Google de `auth.ts`: los permisos de calendario son sensibles y piden la verificación de Google, y en un proyecto aparte el login (sólo correo y perfil, publicado sin verificación) nunca depende de ella.

1. **Habilitar la API**
   - En *APIs & Services → Library*, **Google Calendar API**. La de Calendar MCP (`calendarmcp.googleapis.com`) ya no hace falta.

2. **El cliente OAuth 2.0** (creado el 24/11/2026; no cambia)
   - *APIs & Services → Credentials → OAuth client ID*, tipo `Web application`, nombre `OpenLen MCP Connectors`.
   - **Authorized redirect URIs** (exactamente estas dos, sin segmento de idioma):
     - Producción: `https://openlen.com/api/mcp-connectors/oauth/callback`
     - Local: `http://localhost:3000/api/mcp-connectors/oauth/callback`
   - Su **Client ID** y su **Client Secret** van en `OPENLEN_MCP_GOOGLE_CLIENT_ID` / `OPENLEN_MCP_GOOGLE_CLIENT_SECRET` (§3). El servidor de Calendar acepta sólo los tokens emitidos para ese Client ID.

3. **Data Access: los tres permisos, y sólo ésos**
   - Quitar `https://www.googleapis.com/auth/calendar` y añadir:
     - `https://www.googleapis.com/auth/calendar.calendarlist.readonly`
     - `https://www.googleapis.com/auth/calendar.events`
     - `https://www.googleapis.com/auth/calendar.events.freebusy`
   - Son los que pide la tarjeta (`GCAL_SCOPES`, `lib/google-calendar-mcp/config.ts`) y los que el servidor exige: un token sin alguno de ellos recibe un 403 `insufficient_scope` y el conector pide a la persona más permisos.
   - ✅ Hecho el 24/11/2026. Google clasifica `calendarlist.readonly` y `events.freebusy` como **no sensibles**; sólo `calendar.events` es sensible, y es el único que la verificación tiene que justificar.

4. **Audience: «In production»**
   - Pasar `openlen-connectors` a **In production** sin esperar la verificación: en modo de prueba Google caduca los tokens de refresco a los 7 días y habría que reconectar cada semana.
   - Para publicar, Google exige el Branding completo: App name `OpenLen`, inicio `https://openlen.com`, privacidad `https://openlen.com/en/privacy`, términos `https://openlen.com/en/terms`, dominio autorizado `openlen.com`, sin logo (un logo obliga a verificar), como el proyecto del login.
   - ✅ Hecho el 24/11/2026 (antes del deploy: el servidor viejo de Google ya no funcionaba, no había nada que romper). Google avisa: «Your app requires verification».
   - Sin verificar, quien conecta ve el aviso de Google de «app no verificada», y Google limita la app a 100 cuentas. `OPENLEN_MCP_GOOGLE_TEST_USERS` (§3) sigue decidiendo a quién le ofrece OpenLen la tarjeta.

5. **Después del despliegue**
   - Jesús quita su conexión vieja de Google Calendar (se hizo contra `calendarmcp.googleapis.com`: su fila está atada a esa URL y a la huella de esa entrada, así que no se reutiliza) y conecta otra vez desde la tarjeta.
   - Prueba: leer la agenda y crear un evento de prueba.

6. **Verificación de Google** (en *Verification Center*)
   - `openlen.com` verificado en Search Console por una cuenta que sea dueña del proyecto `openlen-connectors` (añadir la cuenta que falte en un lado o en el otro).
   - La política de privacidad (`/[locale]/privacy`, apartado «Google Calendar y otros conectores») con la declaración de *Limited Use* de Google.
   - Un vídeo oculto en YouTube: conectar desde la tarjeta, la pantalla de Google, leer la agenda y crear un evento.
   - La justificación de cada uno de los tres permisos.
   - Cuando Google apruebe, quitar `OPENLEN_MCP_GOOGLE_TEST_USERS` del entorno de producción para que la tarjeta aparezca a todos.

---

## 3. Variables de entorno

Dónde van:

- **Desarrollo:** `.env.local`.
- **Producción (Hetzner):** `/etc/openlen/openlen.env`, que `openlen-app.service` carga con `EnvironmentFile=` (infra/app/openlen-app.service). systemd lo lee al **arrancar** el servicio: tras cambiarlo hay que reiniciar (`systemctl restart openlen-app`); un despliegue ya lo reinicia.

🔴 **La URL de vuelta sale de `NEXT_PUBLIC_SITE_URL`**, no de la petición: `siteOrigin()` (`lib/mcp/config.ts`) la lee en ejecución y, si falta, usa `https://openlen.com`. La URI de redirección (`<sitio>/api/mcp-connectors/oauth/callback`) y la URL del documento de cliente (`<sitio>/oauth/mcp-client.json`) se construyen con ella, y tienen que ser exactamente las registradas en Google.

- **Producción:** `/etc/openlen/openlen.env` debe traer `NEXT_PUBLIC_SITE_URL=https://openlen.com` (así lo documenta `infra/artifacts/README.md`, que también lo necesita en ejecución); comprobar que está, porque si falta el valor por defecto coincide pero no se ve.
- **Local:** para iniciar sesión desde `http://localhost:3000` hay que poner `NEXT_PUBLIC_SITE_URL=http://localhost:3000` en `.env.local`. Sin eso la URI de vuelta es la de producción y Google devolvería a la persona a `openlen.com`, no a tu máquina.

```dotenv
# Cliente OAuth de OpenLen para servidores con issuer https://accounts.google.com
OPENLEN_MCP_GOOGLE_CLIENT_ID=<client-id>.apps.googleusercontent.com
OPENLEN_MCP_GOOGLE_CLIENT_SECRET=<client-secret>

# Lista de correos en Google Cloud → Audience → Test users (separados por coma).
# Mientras exista, solo estas cuentas ven Google Calendar en suggest_connectors.
# Borrar la variable cuando Google verifique la app.
OPENLEN_MCP_GOOGLE_TEST_USERS=jesus@...

# Palancas opcionales (encendido por defecto; solo el literal "0" apaga):
# OPENLEN_MCP_OAUTH=0   # Apaga OAuth (un 401 vuelve a contarse como failed)
# OPENLEN_MCP=0         # Apaga todos los conectores MCP
# OPENLEN_GCAL_MCP=0    # Apaga el servidor de Calendar de OpenLen (contesta 503)

# Sólo en local: la URL pública del servidor de Calendar (por defecto https://mcp.openlen.com/google-calendar).
# Decide qué servidor recibe el cliente de Google de OpenLen, así que sólo acepta esa URL pública o esta máquina
# (localhost, 127.0.0.1, [::1]) fuera de producción; cualquier otro valor falla con «GCAL_MCP_RESOURCE_URL is not an
# approved endpoint.», como Claude Code con CLAUDE_CODE_CUSTOM_OAUTH_URL.
# GCAL_MCP_RESOURCE_URL=http://localhost:3000/api/mcp/google-calendar
```

---

## 4. Documentos y rutas públicas

- **Client ID Metadata Document (CIMD):** `GET https://openlen.com/oauth/mcp-client.json` (`Cache-Control: public, max-age=3600`). Los servidores MCP que anuncian `client_id_metadata_document_supported` lo usan directamente como `client_id` sin registro dinámico ni configuración manual.
- **Callback OAuth:** `GET https://openlen.com/api/mcp-connectors/oauth/callback` (`Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, CSP `default-src 'none'; script-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'`). Gasta primero el `state` de un solo uso (32 bytes aleatorios, caduca a los 10 minutos, atado a persona + servidor + huella + issuer) y **no confía sólo en él** (revisión final F5) — qué comprueba, según dónde se empezó el inicio de sesión:
  - **Desde la web** (la sesión del navegador): exige que el navegador que vuelve tenga la sesión de OpenLen de **la misma persona** del flujo. La cookie de sesión (`authjs.session-token`, `__Secure-` en https) es `SameSite=Lax`, así que viaja en la redirección GET de nivel superior del proveedor. Sin sesión o con la de otra persona: no se canjea el código, el flujo queda gastado y la página dice «ábrelo otra vez desde la pestaña de OpenLen donde lo empezaste» (403, `wrong_browser`). Por eso alguien que empieza un inicio de sesión en SU cuenta y le manda la URL del proveedor a otra persona no se queda con los tokens de ésta.
  - **Desde el teléfono** (la llave de la app; el navegador del sistema casi nunca tiene sesión): canjea el código pero **retiene** los tokens en el flujo (`heldTokens`, cifrados): no son una conexión, ningún turno ni montaje los usa. La página pregunta «¿Conectar «X» a la cuenta de OpenLen correo@dominio.com?» con el correo ENTERO, y sólo se ofrece si ese correo está verificado (`users.emailVerified`; las cuentas de OpenLen funcionan antes de verificar el correo, así que cualquiera podría registrar el de otra persona): con un correo sin verificar no se canjea el código ni se retiene nada, se gasta el flujo (`email_unverified`) y la página dice que se termine desde un navegador donde esa persona tenga la sesión abierta en OpenLen (o que verifique antes su correo). La pregunta lleva «Conectar a esta cuenta» y «No soy yo», en un formulario cuyo único campo es un token de un solo uso (en la base sólo su SHA-256, `confirmHash`) que se envía a `POST /api/mcp-connectors/oauth/confirm` (sólo del mismo origen: `Sec-Fetch-Site: same-origin` u `Origin` de OpenLen). Sólo «Conectar» guarda los tokens y monta; «No soy yo» los borra y los revoca. Los tokens retenidos caducan con el flujo (10 minutos desde el inicio) y se borran. Si el navegador SÍ tiene la sesión de la misma persona, no pregunta; con la de otra persona, se niega (`other_account`).
  - Después: el issuer (RFC 9207 `iss` y un descubrimiento nuevo; un cambio es `issuer_changed` y el issuer nuevo se guarda para la próxima tarjeta), la huella de la entrada aprobada, y el canje con PKCE.
  La página de resultado avisa a la web por un `BroadcastChannel("openlen:mcp-oauth")` del mismo origen (y, de respaldo, con `postMessage` al opener, que la ventana ya no tiene a propósito).
- 🔴 **El dominio del sitio tiene que ser el de la sesión**: la cookie de sesión es del host exacto. Si alguien usa OpenLen en otro host que el de `NEXT_PUBLIC_SITE_URL` (p. ej. `www.`), la vuelta llega sin sesión y un inicio de sesión de la web se niega como `wrong_browser`.
- **Teléfono (`movil/`):** la tarjeta «Conectar» abre la URL de autorización en el navegador del sistema; allí la persona confirma la cuenta (arriba) y, al volver, la app consulta `GET /api/mcp-connectors` cuando Capacitor avisa (`appStateChange`) de que volvió al primer plano. La aprobación de lo que escribe Len (tarjeta con versión) es sólo de la web: en el teléfono esa tarjeta informa, mira la lista al aparecer y al volver, y ofrece «Conectar» cuando ya se aprobó en la web y el servidor pide iniciar sesión. Requiere generar e instalar una **APK nueva**.
