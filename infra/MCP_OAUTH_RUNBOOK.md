# Runbook — OAuth de los conectores MCP y Google Calendar

Operación y puesta en marcha del OAuth de los conectores MCP (`lib/mcp-connectors/oauth/`, spec local `docs/superpowers/specs/2026-11-17-oauth-de-conectores-mcp-design.md`).

---

## 1. Migración de base de datos

Antes o durante el despliegue, ejecutar la migración aditiva (crea `personMcpOAuth` y `personMcpOAuthFlows` y añade `authIssuer`, `authReason` y `authScope` a `personMcpServerState`):

```bash
npm run mcp-connectors:migrate
```

La migración usa `CREATE TABLE IF NOT EXISTS` y `ALTER TABLE … ADD COLUMN IF NOT EXISTS`: es idempotente.

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

Añadir en `.env.local` (desarrollo) y en el entorno del servicio de producción en Hetzner:

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
- **Callback OAuth:** `GET https://openlen.com/api/mcp-connectors/oauth/callback` (`Cache-Control: no-store`, `Referrer-Policy: no-referrer`, CSP `default-src 'none'; script-src 'unsafe-inline'`). Confía en el `state` de un solo uso (32 bytes aleatorios, caduca a los 10 minutos, atado a persona + servidor + huella + issuer).
- **Teléfono (`movil/`):** la tarjeta «Conectar» abre la URL de autorización en el navegador del sistema y consulta `GET /api/mcp-connectors` al volver la app al primer plano. Requiere generar e instalar una **APK nueva**.
