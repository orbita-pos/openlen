// scripts/librerias-subir.ts — sube las librerías congeladas a libs.openlen.com.
//
//   npm run librerias:subir            # comprueba y dice qué haría
//   npm run librerias:subir -- --subir # sube de verdad
//
// QUÉ HACE, Y POR QUÉ EN ESTE ORDEN:
//
//   1. Baja de npm la versión EXACTA del catálogo (`npm pack`, sin instalar ni
//      ejecutar nada) y saca el fichero de dentro del tarball.
//   2. Calcula el SRI y lo compara con el que `lib/librerias.ts` ya promete.
//      SI NO COINCIDE, ABORTA. Ésta es la comprobación que importa: el SRI vive
//      en las páginas de los usuarios, así que subir unos bytes que no cuadran
//      con lo que el prompt reparte es publicar una librería que ningún
//      navegador va a ejecutar.
//   3. Mira si la ruta YA existe en el origen público. Si existe con bytes
//      distintos, ABORTA — congelado significa congelado: cambiar los bytes
//      bajo una ruta viva le rompe la librería a todas las páginas que ya la
//      cargan. Versión nueva = ruta nueva.
//   4. Sólo entonces sube.
//
// CREDENCIALES. Usa un bucket PROPIO, no el de uploads: los ficheros de
// `uploads.openlen.com` los llena el usuario y ése no puede ser un origen de
// código. Necesita en `.env.local`:
//
//   R2_ACCOUNT_ID         el de siempre (identifica la CUENTA, no el token)
//   R2_LIBS_BUCKET        p. ej. openlen-libs
//   R2_LIBS_PUBLIC_URL    https://libs.openlen.com
//   R2_LIBS_ACCESS_KEY    ┐ del token acotado a ESE bucket. Si faltan, se cae
//   R2_LIBS_SECRET_KEY    ┘ a R2_ACCESS_KEY / R2_SECRET_KEY.
//
// POR QUÉ CREDENCIALES PROPIAS. Un token de R2 acotado a `openlen-libs` da
// claves NUEVAS, y meterlas en `R2_ACCESS_KEY` rompería el acceso a
// uploads/templates/images, que comparten esas dos variables. Separarlas deja
// tener el token con el mínimo privilegio que merece: escritura sobre el origen
// del JavaScript de todas las páginas publicadas no es un permiso que quieras
// de propina en la credencial que sube las fotos de los usuarios.
//
// El bucket tiene que estar servido en ese dominio ANTES de que esto sirva de
// algo; mientras no lo esté, cada URL del catálogo devuelve 404 y las páginas
// nacen con la función muerta. Ver `lib/librerias.ts`.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { R2Storage } from "../lib/storage/r2";
import { LIBRERIAS, type Libreria } from "../lib/librerias";

/** De dónde sale cada fichero dentro del tarball de npm. */
const DENTRO_DEL_PAQUETE: Record<string, { script: string; css?: string }> = {
  "chart.js": { script: "package/dist/chart.umd.min.js" },
  swiper: {
    script: "package/swiper-bundle.min.js",
    css: "package/swiper-bundle.min.css",
  },
};

function sri(buf: Buffer): string {
  return `sha384-${createHash("sha384").update(buf).digest("base64")}`;
}

// En Windows `npm` es un `.cmd`, y desde la corrección de CVE-2024-27980 Node
// se niega a lanzarlo con `execFile` salvo con `shell: true`. Como eso mete un
// intérprete de por medio, el spec se valida ANTES contra una forma estrecha —
// hoy sale de una constante nuestra, pero un `shell: true` que confía en su
// entrada es una inyección esperando a que la entrada cambie de sitio.
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";
const CON_SHELL = process.platform === "win32";
const SPEC_SEGURO = /^[a-z0-9][a-z0-9._-]*@\d+\.\d+\.\d+$/;

/** La ruta bajo el host, derivada de la URL del catálogo. NO se escribe a mano:
 *  si las dos se escribieran por separado, se separarían. */
function claveDe(url: string, base: string): string {
  if (!url.startsWith(`${base}/`)) {
    throw new Error(`la URL ${url} no cuelga de ${base} — revisa R2_LIBS_PUBLIC_URL`);
  }
  return url.slice(base.length + 1);
}

function sacarDelTarball(dir: string, tgz: string, interno: string): Buffer {
  execFileSync("tar", ["xzf", tgz, interno], { cwd: dir, stdio: "pipe" });
  return readFileSync(path.join(dir, interno));
}

/** ¿Qué hay hoy en esa URL? `null` si no hay nada. */
async function bytesPublicados(url: string): Promise<Buffer | null> {
  const r = await fetch(url).catch(() => null);
  if (!r || !r.ok) return null;
  return Buffer.from(await r.arrayBuffer());
}

interface Fichero {
  readonly url: string;
  readonly esperado: string;
  readonly contentType: string;
  readonly bytes: Buffer;
}

async function prepararLibreria(l: Libreria, dir: string): Promise<Fichero[]> {
  const dentro = DENTRO_DEL_PAQUETE[l.id];
  if (!dentro) throw new Error(`${l.id}: falta su entrada en DENTRO_DEL_PAQUETE`);

  const spec = `${l.id}@${l.version}`;
  if (!SPEC_SEGURO.test(spec)) throw new Error(`spec con forma rara, no se lanza: ${spec}`);
  process.stdout.write(`  bajando ${spec}…\n`);
  const tgz = execFileSync(NPM, ["pack", spec, "--silent"], {
    cwd: dir,
    encoding: "utf8",
    shell: CON_SHELL,
  })
    .trim()
    .split("\n")
    .pop()!;

  const out: Fichero[] = [
    {
      url: l.script,
      esperado: l.scriptSri,
      contentType: "application/javascript; charset=utf-8",
      bytes: sacarDelTarball(dir, tgz, dentro.script),
    },
  ];
  if (l.css !== null && l.cssSri !== null && dentro.css) {
    out.push({
      url: l.css,
      esperado: l.cssSri,
      contentType: "text/css; charset=utf-8",
      bytes: sacarDelTarball(dir, tgz, dentro.css),
    });
  }
  return out;
}

async function main(): Promise<void> {
  const subir = process.argv.includes("--subir");
  const {
    R2_ACCOUNT_ID,
    R2_ACCESS_KEY,
    R2_SECRET_KEY,
    R2_LIBS_ACCESS_KEY,
    R2_LIBS_SECRET_KEY,
    R2_LIBS_BUCKET,
    R2_LIBS_PUBLIC_URL,
  } = process.env;
  // Las propias mandan; las compartidas son el respaldo para quien no haya
  // separado el token todavía.
  const accessKey = R2_LIBS_ACCESS_KEY || R2_ACCESS_KEY;
  const secretKey = R2_LIBS_SECRET_KEY || R2_SECRET_KEY;
  const base = (R2_LIBS_PUBLIC_URL ?? "https://libs.openlen.com").replace(/\/+$/, "");

  const dir = mkdtempSync(path.join(tmpdir(), "openlen-libs-"));
  let problemas = 0;
  const listos: { fichero: Fichero; clave: string }[] = [];

  try {
    for (const l of LIBRERIAS) {
      process.stdout.write(`\n${l.nombre} ${l.version}\n`);
      for (const f of await prepararLibreria(l, dir)) {
        const clave = claveDe(f.url, base);
        const real = sri(f.bytes);

        if (real !== f.esperado) {
          problemas++;
          process.stdout.write(
            `  ✗ ${clave}\n    SRI DISTINTO. catálogo: ${f.esperado}\n                 real:     ${real}\n` +
              `    Los bytes de npm no son los que el prompt reparte. NO se sube.\n`,
          );
          continue;
        }

        const ya = await bytesPublicados(f.url);
        if (ya !== null && sri(ya) !== real) {
          problemas++;
          process.stdout.write(
            `  ✗ ${clave}\n    YA EXISTE con bytes distintos. Congelado es congelado:\n` +
              `    sobrescribir rompe la librería a todas las páginas que ya la cargan.\n` +
              `    Sube una VERSIÓN nueva en una RUTA nueva.\n`,
          );
          continue;
        }
        if (ya !== null) {
          process.stdout.write(`  = ${clave} (${f.bytes.length} B) ya está, idéntica\n`);
          continue;
        }

        process.stdout.write(`  → ${clave} (${f.bytes.length} B) SRI ok\n`);
        listos.push({ fichero: f, clave });
      }
    }

    if (problemas > 0) {
      process.stdout.write(`\n${problemas} problema(s). No se sube nada.\n`);
      process.exitCode = 1;
      return;
    }
    if (listos.length === 0) {
      process.stdout.write(`\nNada que subir: todo está ya publicado e idéntico.\n`);
      return;
    }
    if (!subir) {
      process.stdout.write(`\n${listos.length} fichero(s) listos. Repite con --subir.\n`);
      return;
    }

    if (!R2_ACCOUNT_ID || !accessKey || !secretKey || !R2_LIBS_BUCKET) {
      throw new Error(
        "faltan credenciales. Necesito R2_ACCOUNT_ID, R2_LIBS_BUCKET, y " +
          "R2_LIBS_ACCESS_KEY + R2_LIBS_SECRET_KEY (o, en su defecto, " +
          "R2_ACCESS_KEY + R2_SECRET_KEY).",
      );
    }
    process.stdout.write(
      `\nsubiendo a ${R2_LIBS_BUCKET} con ${R2_LIBS_ACCESS_KEY ? "el token propio de libs" : "las claves compartidas"}\n`,
    );
    const almacen = new R2Storage({
      accountId: R2_ACCOUNT_ID,
      accessKey,
      secretKey,
      bucket: R2_LIBS_BUCKET,
      publicUrlBase: base,
    });

    for (const { fichero, clave } of listos) {
      const r = await almacen.upload({
        key: clave,
        contentType: fichero.contentType,
        body: fichero.bytes,
      });
      process.stdout.write(`  ✓ ${r.url} (${r.size} B)\n`);
    }
    process.stdout.write(`\n${listos.length} subida(s).\n`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((e: unknown) => {
  process.stderr.write(`\n${e instanceof Error ? e.message : String(e)}\n`);
  process.exitCode = 1;
});
