// scripts/librerias-comprobar.ts — ¿puede un NAVEGADOR cargar las librerías?
//
//   npm run librerias:comprobar
//
// LA CUARTA LISTA. Tres sitios deciden si una página puede usar Chart.js —el
// saneador, las ops de cabeza y el prompt— y `lib/ai/librerias-acuerdo.test.ts`
// los tiene de acuerdo. Los tres contestan a «¿sobrevive la etiqueta?».
//
// Ninguno contesta a «¿la ejecuta un navegador?», y el 2026-09-04 la respuesta
// era NO para las tres librerías: `libs.openlen.com` no manda
// `Access-Control-Allow-Origin`, mientras el prompt repartía la etiqueta con
// `integrity` + `crossorigin="anonymous"` — y cualquiera de esos dos atributos
// convierte la petición en CORS. El navegador BLOQUEABA el script en la página
// publicada igual que en el render que la mide, `Chart is not defined`, y crear
// acababa reescribiendo la página entera del usuario para nada.
//
// POR QUÉ NO BASTA CON `librerias:subir`. Ése comprueba la ruta con `fetch`
// desde Node, que no tiene origen y por tanto NO HACE CORS NUNCA: veía un 200
// perfecto sobre un fichero que ningún navegador iba a ejecutar. Aquí se manda
// `Origin:` a mano y se mira la cabecera de vuelta, que es lo que decide.
//
// CÓMO SE ARREGLA si sale que no. Al bucket de R2 (`R2_LIBS_BUCKET`) se le pone
// una política de CORS que permita `GET` desde cualquier origen — las páginas
// de los usuarios viven en subdominios distintos, así que el origen permitido
// es `*` — y sólo DESPUÉS se pasa `ORIGEN_MANDA_CORS` a `true` en
// `lib/librerias.ts` para que el SRI vuelva al prompt. En ese orden: al revés
// se rompen otra vez todas las páginas a la vez.

import { LIBRERIAS, ORIGEN_MANDA_CORS, type Libreria } from "../lib/librerias";

/** Un origen ajeno cualquiera, del mismo tipo que los reales: una página
 *  publicada (`<sub>.openlen.app`) y el render que la mide (127.0.0.1:<puerto>)
 *  son los dos ajenos a `libs.openlen.com`. */
const ORIGEN_DE_PRUEBA = "https://ejemplo.openlen.app";

interface Resultado {
  readonly url: string;
  readonly estado: number | null;
  readonly acao: string | null;
  readonly error?: string;
  /** La cabecera sólo aparece saltandose la cache: la politica ESTA puesta y lo
   *  que falta es purgar el borde. */
  readonly soloSinCache?: boolean;
}

async function pedir(url: string): Promise<Resultado> {
  try {
    const r = await fetch(url, {
      method: "GET",
      headers: { Origin: ORIGEN_DE_PRUEBA },
    });
    // El cuerpo no interesa, pero hay que cerrarlo para que el proceso termine.
    await r.arrayBuffer().catch(() => undefined);
    return {
      url,
      estado: r.status,
      acao: r.headers.get("access-control-allow-origin"),
    };
  } catch (err) {
    return { url, estado: null, acao: null, error: String(err) };
  }
}

/**
 * Cada URL DOS VECES: pelada y con un rompe-cachés.
 *
 * Es el discriminador que ya costó dos diagnósticos falsos en este mismo host.
 * Los ficheros salen con `max-age=31536000, immutable` y Cloudflare no varía
 * por `Origin`, así que después de ponerle CORS al bucket la respuesta VIEJA
 * —sin la cabecera— se puede seguir sirviendo desde el borde. Si la pelada no
 * trae ACAO y la del rompe-cachés sí, la política ya está puesta y lo que falta
 * es PURGAR; sin las dos peticiones eso se lee como «no funcionó».
 */
async function mirar(url: string): Promise<Resultado> {
  const pelada = await pedir(url);
  if (pelada.acao !== null || pelada.estado !== 200) return pelada;
  const fresca = await pedir(`${url}?cb=${Date.now()}`);
  if (fresca.acao === null) return pelada;
  return { ...pelada, acao: fresca.acao, soloSinCache: true };
}

function urlsDe(l: Libreria): string[] {
  return [...l.scripts.map((s) => s.url), ...(l.css !== null ? [l.css] : [])];
}

async function main(): Promise<void> {
  process.stdout.write(`Origen de prueba: ${ORIGEN_DE_PRUEBA}\n`);
  process.stdout.write(
    `lib/librerias.ts dice ORIGEN_MANDA_CORS = ${ORIGEN_MANDA_CORS}\n\n`,
  );

  const filas: Resultado[] = [];
  for (const l of LIBRERIAS) {
    for (const url of urlsDe(l)) filas.push(await mirar(url));
  }

  let noAlcanzables = 0;
  let sinCors = 0;
  let cacheVieja = 0;
  for (const f of filas) {
    const ruta = f.url.replace(/^https:\/\/[^/]+\//, "");
    if (f.estado !== 200) {
      noAlcanzables += 1;
      process.stdout.write(`  ✗ ${ruta} — ${f.error ?? `HTTP ${f.estado}`}\n`);
      continue;
    }
    if (f.acao === null) {
      sinCors += 1;
      process.stdout.write(`  ✗ ${ruta} — 200, pero SIN Access-Control-Allow-Origin\n`);
      continue;
    }
    if (f.soloSinCache === true) {
      cacheVieja += 1;
      process.stdout.write(
        `  ⚠ ${ruta} — la política ESTÁ puesta; el borde sirve la vieja. PURGAR.\n`,
      );
      continue;
    }
    process.stdout.write(`  ✓ ${ruta} — 200, ACAO: ${f.acao}\n`);
  }

  const mandaCors = noAlcanzables === 0 && sinCors === 0 && cacheVieja === 0;
  process.stdout.write("\n");

  if (noAlcanzables > 0) {
    process.stdout.write(
      `${noAlcanzables} fichero(s) no se pueden ni bajar: la ruta no existe en el bucket.\n` +
        "Súbelas con `npm run librerias:subir -- --subir` antes de mirar el CORS.\n",
    );
    process.exitCode = 1;
    return;
  }

  if (cacheVieja > 0) {
    process.stdout.write(
      `${cacheVieja} fichero(s) ya tienen CORS en el bucket pero Cloudflare sirve la\n` +
        "respuesta VIEJA desde el borde. Purga esas URLs (caché → purgar por URL) y\n" +
        "vuelve a correr esto. NO es un problema de configuración.\n",
    );
    process.exitCode = 1;
    return;
  }

  if (!mandaCors && ORIGEN_MANDA_CORS) {
    process.stdout.write(
      "ROTO. `ORIGEN_MANDA_CORS` dice true y el origen no manda la cabecera, así que\n" +
        "el prompt está repartiendo una etiqueta que ningún navegador ejecuta.\n" +
        "Ponle CORS al bucket, o pasa la constante a false.\n",
    );
    process.exitCode = 1;
    return;
  }

  if (!mandaCors) {
    process.stdout.write(
      "El origen NO manda CORS — que es justo lo que `ORIGEN_MANDA_CORS = false`\n" +
        "ya asume, así que las páginas cargan bien (sin SRI, que es el precio).\n" +
        "Para recuperar el SRI: política de CORS en el bucket permitiendo GET desde\n" +
        "cualquier origen, volver a correr esto, y ENTONCES la constante a true.\n",
    );
    return;
  }

  process.stdout.write(
    ORIGEN_MANDA_CORS
      ? "Todo en su sitio: el origen manda CORS y el prompt reparte el SRI.\n"
      : "El origen YA manda CORS. Se puede poner `ORIGEN_MANDA_CORS = true` en\n" +
          "lib/librerias.ts y el SRI vuelve al prompt.\n",
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
