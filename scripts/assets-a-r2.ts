// LAS SUBIDAS DE LOS USUARIOS, DEL DISCO DEL SERVIDOR A R2.
//
// Arregla dos cosas a la vez, las dos medidas el 2026-08-30:
//
//   1. LAS URLS ROTAS. Siete páginas llevan dentro un
//      `https://localhost:3000/api/projects/<id>/assets/<f>` como <img src>: la
//      foto que el dueño subió está muerta para todo el mundo menos para quien
//      corra en su propia máquina. La causa (dos juegos de nombres para el
//      mismo bucket) se arregló en `a80deb82`, pero eso cura las subidas NUEVAS
//      — las que ya están guardadas siguen apuntando a localhost.
//
//   2. 🔴 EL DEPLOY LAS DEJA HUÉRFANAS. `LocalFsAssetStorage` escribe en
//      `<cwd>/uploads/<projectId>/`, o sea DENTRO de `/opt/openlen-app`, que es
//      justo el directorio que el swap atómico reemplaza:
//
//          mv /opt/openlen-app   /opt/openlen-app.old
//          mv <staging>          /opt/openlen-app
//
//      El directorio nuevo sale del tarball y no trae `uploads/`. O sea que
//      cada despliegue deja las subidas en `.old` —vivas un ciclo más, hasta
//      que el siguiente despliegue las pise— y desaparecidas de la ruta que se
//      sirve. `deploy.ps1` no nombra `uploads` en ninguna línea. Son 28 MB y 97
//      ficheros de gente de verdad.
//
//      En R2 el problema no existe: no viven en el directorio que se
//      intercambia.
//
// SUBE TODO lo que encuentre, no sólo lo de las 7 páginas rotas: el borrado del
// deploy le pasa a todos los ficheros, no sólo a los mal enlazados. Subir de más
// no le hace daño a nadie; reescribir el HTML —que sí cambia lo que el usuario
// ve— se hace aparte y sólo sobre las URLs rotas.
//
// IDEMPOTENTE: la clave de R2 es `<projectId>/<filename>` y el nombre del
// fichero es el hash de su contenido, así que volver a subir escribe los mismos
// bytes en la misma clave.
//
//   npm run assets:r2 -- --desde=<carpeta>              (informa y no sube)
//   npm run assets:r2 -- --desde=<carpeta> --aplicar
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const MIMES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  wav: "audio/wav",
};

function args() {
  const desde = process.argv.find((a) => a.startsWith("--desde="))?.split("=")[1];
  return { desde, aplicar: process.argv.includes("--aplicar") };
}

async function main() {
  const { desde, aplicar } = args();
  if (!desde) {
    console.error("Falta --desde=<carpeta con los uploads del servidor>");
    process.exit(2);
  }

  const e = process.env;
  const cuenta = e.R2_ACCOUNT_ID;
  const bucket = e.R2_BUCKET || "openlen-uploads";
  const publicBase = (e.R2_PUBLIC_URL || "https://uploads.openlen.com").replace(/\/$/, "");
  if (!cuenta || !e.R2_ACCESS_KEY || !e.R2_SECRET_KEY) {
    console.error("Faltan credenciales R2 (R2_ACCOUNT_ID / R2_ACCESS_KEY / R2_SECRET_KEY).");
    process.exit(2);
  }

  // QUÉ BUCKET, ANTES DE NADA — mismo criterio que la migración de créditos.
  // Un bucket equivocado no da error: sube, y las fotos siguen sin verse.
  console.log(`bucket: ${bucket} · público: ${publicBase}`);

  const proyectos = readdirSync(desde).filter((d) =>
    statSync(join(desde, d)).isDirectory(),
  );
  const ficheros: { key: string; ruta: string; mime: string; bytes: number }[] = [];
  for (const p of proyectos) {
    for (const f of readdirSync(join(desde, p))) {
      const ruta = join(desde, p, f);
      if (!statSync(ruta).isFile()) continue;
      const ext = f.split(".").pop()?.toLowerCase() ?? "";
      ficheros.push({
        key: `${p}/${f}`,
        ruta,
        mime: MIMES[ext] ?? "application/octet-stream",
        bytes: statSync(ruta).size,
      });
    }
  }
  const total = ficheros.reduce((a, f) => a + f.bytes, 0);
  console.log(
    `${ficheros.length} ficheros en ${proyectos.length} proyectos · ${(total / 1e6).toFixed(1)} MB`,
  );

  if (!aplicar) {
    console.log(`\nEN SECO. Para subirlos: --aplicar`);
    process.exit(0);
  }

  const client = new S3Client({
    region: "auto",
    endpoint: `https://${cuenta}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: e.R2_ACCESS_KEY, secretAccessKey: e.R2_SECRET_KEY },
    forcePathStyle: true,
  });

  let subidos = 0;
  const fallos: string[] = [];
  for (const f of ficheros) {
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: f.key,
          Body: readFileSync(f.ruta),
          ContentType: f.mime,
          CacheControl: "public, max-age=31536000, immutable",
        }),
      );
      subidos += 1;
      if (subidos % 20 === 0) console.log(`  ${subidos}/${ficheros.length}…`);
    } catch (err) {
      fallos.push(`${f.key}: ${(err as Error).message}`);
    }
  }
  console.log(`\nsubidos ${subidos}/${ficheros.length}`);
  for (const f of fallos) console.log(`  FALLO ${f}`);

  // SE COMPRUEBA QUE SE VEN, que es lo que importa: un PUT que devuelve 200
  // sobre un bucket sin dominio público deja las fotos igual de rotas.
  console.log(`\ncomprobando que se sirven…`);
  let ok = 0;
  const rotos: string[] = [];
  for (const f of ficheros) {
    try {
      const res = await fetch(`${publicBase}/${f.key}`, {
        method: "HEAD",
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) ok += 1;
      else rotos.push(`${f.key} -> HTTP ${res.status}`);
    } catch (err) {
      rotos.push(`${f.key} -> ${(err as Error).message}`);
    }
  }
  console.log(`se sirven ${ok}/${ficheros.length}`);
  for (const r of rotos.slice(0, 10)) console.log(`  ROTO ${r}`);

  process.exit(rotos.length > 0 || fallos.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
