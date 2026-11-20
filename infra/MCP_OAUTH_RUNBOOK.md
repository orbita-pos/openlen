# Runbook — OAuth de los conectores MCP y Google Calendar

Operación y puesta en marcha del OAuth de los conectores MCP (`lib/mcp-connectors/oauth/`, spec local `docs/superpowers/specs/2026-11-17-oauth-de-conectores-mcp-design.md`).

---

## 1. Migración de base de datos

La migración aditiva (`scripts/mcp-connectors-migrate-sql.ts`) crea `personMcpOAuth` y `personMcpOAuthFlows`, añade `authIssuer`, `authReason` y `authScope` a `personMcpServerState`, `fingerprint` a `personMcpOAuth`, y `startedFrom`, `heldTokens` y `confirmHash` a `personMcpOAuthFlows` (revisión final F5). Usa `CREATE TABLE IF NOT EXISTS` y `ALTER TABLE … ADD COLUMN IF NOT EXISTS`: es idempotente.

🔴 **Tiene que estar aplicada ANTES de que el código nuevo sirva**: el código lee esas tablas y columnas (por ejemplo `readServerStates` pide todas las columnas de `personMcpServerState`), y arrancar sin ellas rompe los conectores.

- **En producción la corre el despliegue**: `infra/scripts/deploy.ps1` (paso 6.2) ejecuta en el box `migrations/run.sh`, que lleva la migración `mcp-connectors-migrate` (lista en `scripts/build-migrations.mjs`), contra `DATABASE_URL_DIRECT` (el rol dueño de las tablas) y antes del intercambio atómico. Con `OPENLEN_SKIP_MIGRATE=1` esa corrida se salta y habría que lanzarla a mano en el box.
- **En local**: `npm run mcp-connectors:migrate` lee `.env.local`, es decir, la base de **desarrollo**. No sirve para producción.

---

## 2. Configuración en Google Cloud Console (Google Calendar MCP)

El servidor oficial de Google Calendar MCP (`https://calendarmcp.googleapis.com/mcp/v1`) exige un cliente OAuth de Google registrado con el indicador de agente de IA. En el proyecto de Google Cloud de OpenLen (el mismo donde vive el login con Google de `auth.ts`):

1. **Habilitar la API de Calendar MCP**
   - En *APIs & Services → Library*, buscar y habilitar **Google Calendar API** y el endpoint de **Calendar MCP** (`calendarmcp.googleapis.com`).

2. **Crear el cliente OAuth 2.0**
   - En *APIs & Services → Credentials → Create Credentials → OAuth client ID*:
     - **Application type:** `Web application`
     - **Name:** `OpenLen MCP Connectors`
     - Activar la casilla **«Use this client for an AI-powered agent»** (requerida por los servidores MCP de Google Workspace).
     - **Authorized redirect URIs** (exactamente estas dos, sin segmento de idioma):
       - Producción: `https://openlen.com/api/mcp-connectors/oauth/callback`
       - Local: `http://localhost:3000/api/mcp-connectors/oauth/callback`
   - Copiar el **Client ID** y el **Client Secret**.

3. **Pantalla de consentimiento OAuth (*OAuth consent screen*)**
   - En *Data Access / Scopes*, añadir el permiso:
     - `https://www.googleapis.com/auth/calendar`
   - Mientras Google no verifique el permiso de Calendar:
     - En *Audience → Test users*, añadir los correos de las personas autorizadas a probarlo (hasta 100 cuentas, empezando por la de Jesús).
     - Esos mismos correos deben ponerse en `OPENLEN_MCP_GOOGLE_TEST_USERS` para que `suggest_connectors` solo ofrezca Google Calendar a quienes pueden terminar el flujo sin que Google los bloquee.

4. **Verificación de Google**
   - En *Verification Center*, enviar la solicitud para el scope `https://www.googleapis.com/auth/calendar` (enlace a la política de privacidad de OpenLen y vídeo breve mostrando el botón «Conectar Google Calendar» en el chat, la pantalla de consentimiento de Google y la lectura/creación de un evento).
   - Una vez aprobada la verificación, eliminar `OPENLEN_MCP_GOOGLE_TEST_USERS` del entorno de producción para que Google Calendar aparezca en el directorio para todos los usuarios.

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
```

---

## 4. Documentos y rutas públicas

- **Client ID Metadata Document (CIMD):** `GET https://openlen.com/oauth/mcp-client.json` (`Cache-Control: public, max-age=3600`). Los servidores MCP que anuncian `client_id_metadata_document_supported` lo usan directamente como `client_id` sin registro dinámico ni configuración manual.
- **Callback OAuth:** `GET https://openlen.com/api/mcp-connectors/oauth/callback` (`Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, CSP `default-src 'none'; script-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'`). Gasta primero el `state` de un solo uso (32 bytes aleatorios, caduca a los 10 minutos, atado a persona + servidor + huella + issuer) y **no confía sólo en él** (revisión final F5) — qué comprueba, según dónde se empezó el inicio de sesión:
  - **Desde la web** (la sesión del navegador): exige que el navegador que vuelve tenga la sesión de OpenLen de **la misma persona** del flujo. La cookie de sesión (`authjs.session-token`, `__Secure-` en https) es `SameSite=Lax`, así que viaja en la redirección GET de nivel superior del proveedor. Sin sesión o con la de otra persona: no se canjea el código, el flujo queda gastado y la página dice «ábrelo otra vez desde la pestaña de OpenLen donde lo empezaste» (403, `wrong_browser`). Por eso alguien que empieza un inicio de sesión en SU cuenta y le manda la URL del proveedor a otra persona no se queda con los tokens de ésta.
  - **Desde el teléfono** (la llave de la app; el navegador del sistema casi nunca tiene sesión): canjea el código pero **retiene** los tokens en el flujo (`heldTokens`, cifrados): no son una conexión, ningún turno ni montaje los usa. La página pregunta «¿Conectar «X» a la cuenta de OpenLen j***@…?» con «Conectar a esta cuenta» y «No soy yo», en un formulario cuyo único campo es un token de un solo uso (en la base sólo su SHA-256, `confirmHash`) que se envía a `POST /api/mcp-connectors/oauth/confirm` (sólo del mismo origen: `Sec-Fetch-Site: same-origin` u `Origin` de OpenLen). Sólo «Conectar» guarda los tokens y monta; «No soy yo» los borra y los revoca. Los tokens retenidos caducan con el flujo (10 minutos desde el inicio) y se borran. Si el navegador SÍ tiene la sesión de la misma persona, no pregunta; con la de otra persona, se niega (`other_account`).
  - Después: el issuer (RFC 9207 `iss` y un descubrimiento nuevo; un cambio es `issuer_changed` y el issuer nuevo se guarda para la próxima tarjeta), la huella de la entrada aprobada, y el canje con PKCE.
  La página de resultado avisa a la web por un `BroadcastChannel("openlen:mcp-oauth")` del mismo origen (y, de respaldo, con `postMessage` al opener, que la ventana ya no tiene a propósito).
- 🔴 **El dominio del sitio tiene que ser el de la sesión**: la cookie de sesión es del host exacto. Si alguien usa OpenLen en otro host que el de `NEXT_PUBLIC_SITE_URL` (p. ej. `www.`), la vuelta llega sin sesión y un inicio de sesión de la web se niega como `wrong_browser`.
- **Teléfono (`movil/`):** la tarjeta «Conectar» abre la URL de autorización en el navegador del sistema; allí la persona confirma la cuenta (arriba) y, al volver, la app consulta `GET /api/mcp-connectors` cuando Capacitor avisa (`appStateChange`) de que volvió al primer plano. La aprobación de lo que escribe Len (tarjeta con versión) es sólo de la web: en el teléfono esa tarjeta informa, mira la lista al aparecer y al volver, y ofrece «Conectar» cuando ya se aprobó en la web y el servidor pide iniciar sesión. Requiere generar e instalar una **APK nueva**.
