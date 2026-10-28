// Verifica autenticación con Google; nunca imprime ni guarda el token recibido.
const fs = require('node:fs');
const { createSign } = require('node:crypto');
(async () => {
  const cuenta = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  if (cuenta.project_id !== 'len-movil' || !cuenta.client_email?.endsWith('@len-movil.iam.gserviceaccount.com')) throw new Error();
  const ahora = Math.floor(Date.now() / 1000);
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const base = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: cuenta.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: ahora, exp: ahora + 3600 })}`;
  const firma = createSign('RSA-SHA256').update(base).sign(cuenta.private_key, 'base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${base}.${firma}` }), signal: AbortSignal.timeout(15000) });
  if (!r.ok) { console.error(`Google rechazó la verificación: HTTP ${r.status}. No se muestran credenciales.`); process.exitCode = 1; return; }
  const datos = await r.json();
  if (typeof datos.access_token !== 'string' || datos.token_type !== 'Bearer') throw new Error();
  console.log('Google aceptó la credencial para Firebase Messaging. Token no guardado ni impreso; no se enviaron notificaciones.');
})().catch(() => { console.error('No se pudo verificar la autenticación. No se muestran credenciales.'); process.exitCode = 1; });
