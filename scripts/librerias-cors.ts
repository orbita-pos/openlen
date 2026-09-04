// scripts/librerias-cors.ts — ponerle CORS al bucket de las librerías.
//
//   npm run librerias:cors             # enseña lo que hay hoy, no toca nada
//   npm run librerias:cors -- --aplicar
//
// POR QUÉ HACE FALTA. El SRI sobre un origen ajeno EXIGE CORS, y
// `crossorigin="anonymous"` lo exige por su cuenta. Sin
// `Access-Control-Allow-Origin` el navegador BLOQUEA el fichero — en la página
// publicada y en el render que la mide, igual. Ver `lib/librerias.ts`.
//
// ESTO ARREGLA TAMBIÉN LAS PÁGINAS YA PUBLICADAS, que es lo que un despliegue
// no puede hacer: su HTML ya está en disco con `integrity` y `crossorigin`
// dentro. Cambiar el prompt cambia lo que se escribe a partir de ahora; cambiar
// el origen cambia lo que hace el navegador con lo que ya está escrito.
//
// ⚠️ LA CACHÉ DE CLOUDFLARE VA A MORDER. Los ficheros salen con
// `max-age=31536000, immutable` y Cloudflare no varía por `Origin` por defecto,
// así que la respuesta vieja —la que no lleva la cabecera— se puede seguir
// sirviendo desde el borde. Después de aplicar hay que PURGAR esas URLs.
// Se distingue igual que la trampa del 404: si `?cb=<ts>` da otra respuesta que
// la URL pelada, es caché y no configuración. `npm run librerias:comprobar`
// pregunta de las dos formas y lo dice.

import { LIBRERIAS } from "../lib/librerias";

/**
 * `*` y no una lista: las páginas de los usuarios viven cada una en su
 * subdominio (`<sub>.openlen.com`, `<sub>.openlen.app`), los dominios propios
 * son de ellos, y el render que las mide sale de `127.0.0.1:<puerto efímero>`.
 * Enumerar eso es imposible y además no protegería nada: son ficheros públicos
 * de terceros, servidos sin credenciales y sin cookies.
 */
const POLITICA = {
  CORSRules: [
    {
      AllowedOrigins: ["*"],
      // HEAD además de GET: es lo que manda un `fetch(..., {method:"HEAD"})` y
      // lo que usan las comprobaciones.
      AllowedMethods: ["GET", "HEAD"],
      AllowedHeaders: ["*"],
      MaxAgeSeconds: 86_400,
    },
  ],
};

async function main(): Promise<void> {
  const aplicar = process.argv.includes("--aplicar");
  const {
    R2_ACCOUNT_ID,
    R2_ACCESS_KEY,
    R2_SECRET_KEY,
    R2_LIBS_ACCESS_KEY,
    R2_LIBS_SECRET_KEY,
    R2_LIBS_BUCKET,
  } = process.env;

  const accessKey = R2_LIBS_ACCESS_KEY ?? R2_ACCESS_KEY;
  const secretKey = R2_LIBS_SECRET_KEY ?? R2_SECRET_KEY;
  if (!R2_ACCOUNT_ID || !accessKey || !secretKey || !R2_LIBS_BUCKET) {
    process.stdout.write(
      "Faltan credenciales en .env.local: hacen falta R2_ACCOUNT_ID, R2_LIBS_BUCKET\n" +
        "y R2_LIBS_ACCESS_KEY/R2_LIBS_SECRET_KEY (o los R2_ACCESS_KEY/R2_SECRET_KEY de siempre).\n",
    );
    process.exitCode = 1;
    return;
  }

  const { S3Client, GetBucketCorsCommand, PutBucketCorsCommand } = await import(
    "@aws-sdk/client-s3"
  );
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
  });

  process.stdout.write(`Bucket: ${R2_LIBS_BUCKET}\n\n`);

  // 1. Lo que hay HOY. Un bucket sin política contesta con un error, no con una
  //    lista vacía — así que no tener CORS no es un fallo del script.
  let actual: unknown = null;
  try {
    const r = await client.send(new GetBucketCorsCommand({ Bucket: R2_LIBS_BUCKET }));
    actual = r.CORSRules ?? null;
    process.stdout.write(`Política actual:\n${JSON.stringify(actual, null, 2)}\n\n`);
  } catch {
    process.stdout.write("Política actual: NINGUNA (el bucket no manda CORS).\n\n");
  }

  if (!aplicar) {
    process.stdout.write(
      `Se aplicaría:\n${JSON.stringify(POLITICA.CORSRules, null, 2)}\n\n` +
        "Nada tocado. Para aplicarlo de verdad:\n" +
        "  npm run librerias:cors -- --aplicar\n",
    );
    return;
  }

  await client.send(
    new PutBucketCorsCommand({
      Bucket: R2_LIBS_BUCKET,
      CORSConfiguration: POLITICA,
    }),
  );
  process.stdout.write("Aplicada.\n\n");

  // 2. Y las URLs que hay que purgar, escupidas para copiar y pegar. No se
  //    purgan desde aquí: no hay credenciales de Cloudflare en .env.local, y
  //    dar por hecho que la caché se rindió sola es justo lo que ya costó dos
  //    diagnósticos falsos.
  process.stdout.write(
    "⚠️ AHORA PURGA ESTAS URLs en Cloudflare (caché → purgar por URL), o la\n" +
      "respuesta vieja sin la cabecera se seguirá sirviendo desde el borde:\n\n",
  );
  for (const l of LIBRERIAS) {
    for (const sc of l.scripts) process.stdout.write(`  ${sc.url}\n`);
    if (l.css !== null) process.stdout.write(`  ${l.css}\n`);
  }
  process.stdout.write("\nY luego comprueba: npm run librerias:comprobar\n");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
