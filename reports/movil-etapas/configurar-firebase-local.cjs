// Lee la credencial sin imprimirla y la prepara sólo en el entorno local ignorado.
const fs = require('node:fs');
const path = require('node:path');
const { createPrivateKey } = require('node:crypto');
const dotenv = require('dotenv');
try {
  const repo = path.resolve(__dirname, '../..');
  const cuenta = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const android = JSON.parse(fs.readFileSync(path.join(repo, 'movil/android/app/google-services.json'), 'utf8'));
  if (cuenta.type !== 'service_account' || cuenta.project_id !== 'len-movil' || android.project_info.project_id !== cuenta.project_id || !android.client.some(c => c.client_info?.android_client_info?.package_name === 'app.openlen.len')) throw new Error();
  if (typeof cuenta.client_email !== 'string' || !cuenta.client_email.endsWith('@len-movil.iam.gserviceaccount.com') || createPrivateKey(cuenta.private_key).asymmetricKeyType !== 'rsa') throw new Error();
  const valor = JSON.stringify({ project_id: cuenta.project_id, client_email: cuenta.client_email, private_key: cuenta.private_key });
  if (valor.includes("'")) throw new Error();
  const archivo = path.join(repo, '.env.local');
  const anterior = fs.existsSync(archivo) ? fs.readFileSync(archivo, 'utf8') : '';
  const existente = dotenv.parse(anterior).FCM_SERVICE_ACCOUNT_JSON;
  if (existente && existente !== valor) throw new Error();
  if (!existente) {
    const nuevo = anterior + (anterior.endsWith('\n') || !anterior ? '' : '\n') + `FCM_SERVICE_ACCOUNT_JSON='${valor}'\n`;
    if (dotenv.parse(nuevo).FCM_SERVICE_ACCOUNT_JSON !== valor) throw new Error();
    fs.writeFileSync(archivo, nuevo);
  }
  const guardado = JSON.parse(dotenv.parse(fs.readFileSync(archivo, 'utf8')).FCM_SERVICE_ACCOUNT_JSON);
  if (guardado.project_id !== 'len-movil' || createPrivateKey(guardado.private_key).asymmetricKeyType !== 'rsa') throw new Error();
  console.log('Credencial RSA validada para len-movil y configurada en .env.local. Ningún secreto se imprimió ni se envió al servidor.');
} catch {
  console.error('No se pudo validar o preparar Firebase. No se muestran credenciales.');
  process.exitCode = 1;
}
