// LOS PERFILES DE CHROMIUM QUE NADIE BORRA.
//
// POR QUÉ EXISTE, medido el 2026-09-16. En la máquina de desarrollo había
// **242 directorios** `puppeteer_dev_chrome_profile-*` en `%TEMP%`, 876 MB, con
// el disco al 90%. En producción es peor por dónde caen: `defaultLaunchBrowser`
// lanza con `HOME: "/tmp"` sobre una CX22 de 40 GB.
//
// 🔴 Y NO ES FALTA DE DISCIPLINA EN LAS LLAMADAS. Se comprobó: un `launch()`
// seguido de `close()` limpia su perfil, siempre. Lo que se acumula son los
// lanzamientos que NUNCA LLEGAN a `close()` — un timeout de vitest, un
// `taskkill` al dev, un Ctrl+C, un Chromium que muere. En esos casos no corre
// ningún `finally`, así que auditar los ~30 sitios que lanzan no lo arregla:
// el proceso ya no está para ejecutar la limpieza. La única forma de cerrarlo
// es barrer los huérfanos después.
//
// POR ANTIGÜEDAD, Y NO POR SUERTE DEL SISTEMA. En Windows se midió que borrar
// un perfil VIVO falla con `EPERM`, así que ahí el sistema ya protege. **En
// Linux no**, y producción es Linux: un `rm -rf` sobre el perfil de un Chromium
// que está renderizando se lo lleva por delante. Por eso la condición es la
// EDAD y no «inténtalo y a ver»: la red de Windows es un extra, no el diseño.
//
// Una hora es holgadísima contra lo que dura un uso legítimo: un render son
// 2-5 s, el fichero de pruebas más lento ~30 s, y la suite entera 6 minutos.
import { readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PREFIJO = "puppeteer_dev_chrome_profile-";

/** Una hora. Ver la cabecera: es el margen sobre el uso legítimo más largo. */
export const EDAD_MINIMA_MS = 60 * 60 * 1000;

export interface BarridoOpts {
  /** Dónde mirar. Por defecto el temporal del sistema — el mismo sitio donde
   *  Puppeteer los crea cuando no se le da `userDataDir`. */
  readonly dir?: string;
  readonly edadMinimaMs?: number;
  readonly ahora?: number;
}

/**
 * Borra los perfiles huérfanos y devuelve cuántos se fueron.
 *
 * FALLA BLANDO EN TODO. Es una tarea de limpieza: no puede tumbar ni un render
 * ni una corrida de pruebas por no poder leer un directorio. Un `EPERM` sobre
 * un perfil vivo en Windows es el caso NORMAL aquí, no un error.
 */
export async function barrerPerfilesHuerfanos(opts: BarridoOpts = {}): Promise<number> {
  const dir = opts.dir ?? tmpdir();
  const edad = opts.edadMinimaMs ?? EDAD_MINIMA_MS;
  const ahora = opts.ahora ?? Date.now();
  let entradas: string[];
  try {
    entradas = await readdir(dir);
  } catch {
    return 0;
  }
  let idos = 0;
  for (const nombre of entradas) {
    if (!nombre.startsWith(PREFIJO)) continue;
    const ruta = join(dir, nombre);
    try {
      const s = await stat(ruta);
      if (!s.isDirectory()) continue;
      if (ahora - s.mtimeMs < edad) continue;
      await rm(ruta, { recursive: true, force: true });
      idos += 1;
    } catch {
      // Vivo, bloqueado, o ya no está. Ninguno es asunto nuestro.
    }
  }
  return idos;
}

let barrido: Promise<number> | null = null;

/**
 * UNA VEZ POR PROCESO, y sin bloquear a quien llama.
 *
 * Va colgado del arranque del navegador porque es el único sitio por el que
 * pasan TODOS los que crean perfiles: el servidor, la batería de evals y los
 * scripts sueltos. Colgarlo de `instrumentation.ts` habría dejado fuera a los
 * scripts, que es justo donde más se acumulaban.
 *
 * No se espera a propósito: el que lanza un navegador quiere su navegador, no
 * una limpieza. Si tarda, tarda en segundo plano.
 */
export function barrerUnaVezPorProceso(): void {
  if (barrido) return;
  barrido = barrerPerfilesHuerfanos()
    .then((n) => {
      if (n > 0) {
        // SE DICE. Una limpieza silenciosa es indistinguible de una que no
        // ocurre — y ésta existe precisamente porque nadie se enteró de que
        // llevaba meses sin ocurrir.
        // eslint-disable-next-line no-console
        console.info(`[chromium] ${n} perfil(es) huérfano(s) barrido(s) del temporal`);
      }
      return n;
    })
    .catch(() => 0);
}

/** SÓLO PRUEBAS. */
export function olvidarBarridoParaPruebas(): void {
  barrido = null;
}
