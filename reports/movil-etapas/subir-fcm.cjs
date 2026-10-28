// La credencial viaja sólo por stdin de SSH, sin argumentos, archivos intermedios ni logs.
const fs = require('node:fs');
const { createPrivateKey } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const dotenv = require('dotenv');
try {
  const c = JSON.parse(dotenv.parse(fs.readFileSync('.env.local', 'utf8')).FCM_SERVICE_ACCOUNT_JSON);
  if (c.project_id !== 'len-movil' || !c.client_email.endsWith('@len-movil.iam.gserviceaccount.com') || createPrivateKey(c.private_key).asymmetricKeyType !== 'rsa') throw new Error();
  const r = spawnSync('ssh', ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'openlen', 'python3 /root/openlen-instalar-fcm.py'], { input: JSON.stringify(c), encoding: 'utf8', timeout: 30000, maxBuffer: 16000 });
  if (r.status !== 0 || !r.stdout.startsWith('FCM ')) throw new Error();
  console.log(r.stdout.trim());
} catch {
  console.error('Falló la instalación de FCM. La credencial no se imprime.');
  process.exitCode = 1;
}
