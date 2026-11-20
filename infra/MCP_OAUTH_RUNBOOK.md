# Runbook — OAuth de los conectores MCP y Google Calendar

Operación y puesta en marcha del OAuth de los conectores MCP (`lib/mcp-connectors/oauth/`, spec local `docs/superpowers/specs/2026-11-17-oauth-de-conectores-mcp-design.md`).

---

## 1. Migración de base de datos

La migración aditiva (`scripts/mcp-connectors-migrate-sql.ts`) crea `personMcpOAuth` y `personMcpOAuthFlows`, añade `authIssuer`, `authReason` y `authScope` a `personMcpServerState` y `fingerprint` a `personMcpOAuth`. Usa `CREATE TABLE IF NOT EXISTS` y `ALTER TABLE … ADD COLUMN IF NOT EXISTS`: es idempotente.

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
- **Callback OAuth:** `GET https://openlen.com/api/mcp-connectors/oauth/callback` (`Cache-Control: no-store`, `Referrer-Policy: no-referrer`, CSP `default-src 'none'; script-src 'unsafe-inline'`). Confía en el `state` de un solo uso (32 bytes aleatorios, caduca a los 10 minutos, atado a persona + servidor + huella + issuer). La página avisa a la web por un `BroadcastChannel("openlen:mcp-oauth")` del mismo origen (y, de respaldo, con `postMessage` al opener, que la ventana ya no tiene a propósito).
- **Teléfono (`movil/`):** la tarjeta «Conectar» abre la URL de autorización en el navegador del sistema y consulta `GET /api/mcp-connectors` cuando Capacitor avisa (`appStateChange`) de que la app volvió al primer plano. La aprobación de lo que escribe Len (tarjeta con versión) es sólo de la web: en el teléfono esa tarjeta informa y no tiene botón. Requiere generar e instalar una **APK nueva**.
