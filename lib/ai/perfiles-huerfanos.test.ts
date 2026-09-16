// @vitest-environment node
//
// EL BARREDOR DE PERFILES DE CHROMIUM.
//
// Corre sobre un directorio de mentira, nunca sobre el temporal de verdad: una
// prueba que borrase en `os.tmpdir()` podria llevarse por delante el perfil del
// navegador de OTRA prueba que corre en paralelo — y esta suite lanza ~60.
import { mkdtemp, mkdir, readdir, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { barrerPerfilesHuerfanos, EDAD_MINIMA_MS } from "./perfiles-huerfanos";

const AHORA = 1_800_000_000_000;

let dir = "";

/** Un perfil con la edad que se le diga, y con algo dentro: lo que se borra es
 *  un arbol, no un directorio vacio. */
async function perfil(nombre: string, edadMs: number): Promise<string> {
  const ruta = join(dir, nombre);
  await mkdir(join(ruta, "Default"), { recursive: true });
  await writeFile(join(ruta, "Default", "Preferences"), "{}");
  const t = new Date(AHORA - edadMs);
  await utimes(ruta, t, t);
  return ruta;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "prueba-barrido-"));
});

describe("barrerPerfilesHuerfanos", () => {
  it("🔴 se lleva los VIEJOS y deja los RECIENTES", async () => {
    await perfil("puppeteer_dev_chrome_profile-viejo1", EDAD_MINIMA_MS * 2);
    await perfil("puppeteer_dev_chrome_profile-viejo2", EDAD_MINIMA_MS + 60_000);
    // El de un navegador que esta renderizando AHORA MISMO. En Linux se puede
    // borrar —Windows lo protege con EPERM, pero produccion es Linux—, asi que
    // lo unico que lo salva es la edad. Esta es la fila que importa.
    await perfil("puppeteer_dev_chrome_profile-vivo", 5_000);

    const idos = await barrerPerfilesHuerfanos({ dir, ahora: AHORA });

    expect(idos).toBe(2);
    expect((await readdir(dir)).sort()).toEqual(["puppeteer_dev_chrome_profile-vivo"]);
  });

  it("🔴 NO toca nada que no sea un perfil de Puppeteer", async () => {
    // El temporal del sistema es de todo el mundo. Un barredor que se pase de
    // prefijo borra el trabajo de otro programa, y eso no se nota hasta tarde.
    await perfil("puppeteer_dev_chrome_profile-viejo", EDAD_MINIMA_MS * 2);
    await mkdir(join(dir, "algo-de-otro"), { recursive: true });
    await writeFile(join(dir, "algo-de-otro", "importante.txt"), "no me borres");
    await writeFile(join(dir, "puppeteer_dev_chrome_profile-pero-es-un-fichero"), "x");
    const viejo = new Date(AHORA - EDAD_MINIMA_MS * 2);
    await utimes(join(dir, "algo-de-otro"), viejo, viejo);
    await utimes(join(dir, "puppeteer_dev_chrome_profile-pero-es-un-fichero"), viejo, viejo);

    const idos = await barrerPerfilesHuerfanos({ dir, ahora: AHORA });

    expect(idos).toBe(1);
    expect((await readdir(dir)).sort()).toEqual([
      "algo-de-otro",
      "puppeteer_dev_chrome_profile-pero-es-un-fichero",
    ]);
  });

  it("BRAZO DE CONTROL: sin nada viejo no borra nada y devuelve 0", async () => {
    // Sin esto, un barredor que devolviera siempre 0 pasaria la primera prueba
    // si ademas fallara al borrar — y no se distinguiria de uno que funciona.
    await perfil("puppeteer_dev_chrome_profile-a", 1_000);
    await perfil("puppeteer_dev_chrome_profile-b", EDAD_MINIMA_MS - 1);
    expect(await barrerPerfilesHuerfanos({ dir, ahora: AHORA })).toBe(0);
    expect((await readdir(dir)).length).toBe(2);
  });

  it("falla blando: un directorio que no existe no lanza", async () => {
    // Es limpieza. No puede tumbar un render ni una corrida por no poder leer.
    expect(await barrerPerfilesHuerfanos({ dir: join(dir, "no-existe"), ahora: AHORA })).toBe(0);
  });

  it("una hora de margen sobre el uso legitimo mas largo", async () => {
    // La suite entera son ~6 minutos y el render mas lento unos segundos. Si
    // alguien baja esto a minutos, empieza a borrar perfiles vivos en Linux.
    expect(EDAD_MINIMA_MS).toBeGreaterThanOrEqual(30 * 60 * 1000);
  });
});
