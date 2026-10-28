// Sólo metadatos operativos. Nunca imprime credenciales ni tokens de usuarios.
const fs = require('node:fs');
const { createPrivateKey } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
(async () => {
  const pid = execFileSync('systemctl', ['show', '-p', 'MainPID', '--value', 'openlen-app'], { encoding: 'utf8' }).trim();
  if (!/^\d+$/.test(pid) || pid === '0') throw new Error('servicio_inactivo');
  const entorno = {};
  for (const linea of fs.readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0')) {
    const igual = linea.indexOf('=');
    if (igual > 0) entorno[linea.slice(0, igual)] = linea.slice(igual + 1);
  }
  if (!process.argv.includes('--solo-db')) {
    const cuenta = JSON.parse(entorno.FCM_SERVICE_ACCOUNT_JSON);
    if (cuenta.project_id !== 'len-movil' || createPrivateKey(cuenta.private_key).asymmetricKeyType !== 'rsa') throw new Error('fcm_invalido');
    console.log('Proceso activo: Firebase len-movil, credencial RSA válida.');
  }
  const requerir = createRequire('/opt/openlen-app/server.js');
  const { Client } = requerir('pg');
  const db = new Client({ connectionString: entorno.DATABASE_URL, connectionTimeoutMillis: 10000 });
  try {
    await db.connect();
    const { rows: [permisos] } = await db.query(`SELECT
      has_table_privilege(current_user, '"movilAvisos"', 'SELECT') AS lectura,
      has_table_privilege(current_user, '"movilAvisos"', 'INSERT') AS alta,
      has_table_privilege(current_user, '"movilAvisos"', 'UPDATE') AS rotacion,
      has_table_privilege(current_user, '"movilAvisos"', 'DELETE') AS baja`);
    if (!Object.values(permisos).every(v => v === true)) throw new Error('permisos_incompletos');
    const { rows: [restricciones] } = await db.query(`SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='movilAvisos_llave_usuario_fk' AND conrelid='"movilAvisos"'::regclass) AS llave_usuario`);
    if (!restricciones.llave_usuario) throw new Error('restriccion_ausente');
    const { rows: [conteo] } = await db.query('SELECT count(*)::int AS dispositivos FROM "movilAvisos"');
    console.log('Base de datos: tabla de avisos, permisos de la app y relación llave/usuario correctos.');
    console.log(`Dispositivos suscritos: ${conteo.dispositivos}.`);
  } finally { await db.end(); }
})().catch(e => {
  const seguros = new Set(['servicio_inactivo', 'fcm_invalido', 'permisos_incompletos', 'restriccion_ausente']);
  console.error('Comprobación no superada: ' + (seguros.has(e.message) ? e.message : 'error_de_configuracion_o_acceso') + '. No se muestran secretos.');
  process.exitCode = 1;
});
