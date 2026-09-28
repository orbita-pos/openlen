// lib/len-bench/navegador.ts — el Chromium con el que califica Len-Bench.
//
// 🔴 NO PUEDE NI RESOLVER PRODUCCIÓN. Los graders actúan sobre la publicada
// —envían su formulario, cargan su JavaScript—, y cualquier URL absoluta a la
// app que se hornee mal (el `action` de un formulario, la base del widget) o
// que escriba el modelo acabaría escribiendo en la base de producción. El
// entorno ya apunta todo a local (entorno.ts); esto es la segunda puerta, la
// que no depende de que alguien haya cargado el entorno bien.
//
// ⚠️ Salvo los hosts ESTÁTICOS de imágenes (2026-09-23). Antes aquí decía
// «precio conocido: las imágenes de plantillas tampoco cargan; los graders
// miden desborde y formularios, no imágenes». Dejó de valer con el primer
// grader que mide texto SOBRE una foto (`texto-sobre-la-foto`): el visitante
// sí carga `images.openlen.com` (un fondo CSS no se hornea a /assets/), así que
// el grader tiene que verla. Son buckets de R2 que sólo sirven ficheros; la
// app y las páginas publicadas siguen sin resolver.

import puppeteer, { type Browser, type Page } from "puppeteer";
import { OPENLEN_PAGE_HOSTS, OPENLEN_STATIC_HOSTS } from "@/lib/publish/base-host";

/** `--host-resolver-rules` de Chromium: cada dominio de OpenLen y todos sus
 *  subdominios responden «no existe», menos los estáticos de imágenes (las
 *  exclusiones mandan sobre los MAP). Salen de las listas únicas de dominios. */
export const REGLAS_SIN_PRODUCCION = [
  ...OPENLEN_STATIC_HOSTS.map((h) => `EXCLUDE ${h}`),
  ...OPENLEN_PAGE_HOSTS.flatMap((h) => [`MAP ${h} ~NOTFOUND`, `MAP *.${h} ~NOTFOUND`]),
].join(", ");

/**
 * Cierra una pestaña SIN colgarse. Con puppeteer 25, `page.close()` no vuelve
 * nunca si la pestaña se quedó en una navegación fallida (la página de error
 * de Chrome) o a medio enviar un formulario con la intercepción del guardia
 * puesta. Medido el 2026-09-23: 10 s y seguía; pasando antes por
 * `about:blank`, 71 ms. El tope final es el último recurso: una pestaña
 * perdida se va con el navegador, una corrida colgada no se va nunca.
 * ⚠️ Corregido el 2026-09-23 (lote 4 de la Parte C): el tope va en CADA paso.
 * `setRequestInterception(false)` tampoco volvía tras enviar el formulario de
 * una página PUBLICADA (plantilla `savia`, su script de formularios con el
 * guardia puesto), y la validación se quedó girando 20 minutos.
 */
export async function cerrarPestana(page: Page, tope = 5_000): Promise<void> {
  const conTope = (p: Promise<unknown>) => Promise.race([p.catch(() => {}), new Promise((r) => setTimeout(r, tope))]);
  await conTope(page.setRequestInterception(false));
  await conTope(page.goto("about:blank", { timeout: tope }));
  await conTope(page.close());
}

export async function lanzarNavegador(): Promise<Browser> {
  return puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH?.trim() || undefined,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      `--host-resolver-rules=${REGLAS_SIN_PRODUCCION}`,
    ],
  });
}
