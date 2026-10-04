// lib/len-bench/capturas.ts — la página final de cada corrida, en escritorio y
// en móvil: para enseñarla antes que los números (memoria
// `show-the-page-before-measuring`) y para los pares a ciegas de Jesús
// (condición 4 de la puerta, `plans/len-2/diseno.md` §6). Hasta el 26/09 el
// banco borraba cada proyecto al acabar y sólo quedaba lo que cupiera en los
// 10 subdominios de la cuenta de eval: de E no se conservó ni una página.
//
// Se captura ANTES de los graders y en un contexto de navegador limpio: es la
// primera visita de un cliente. Después, los `flujo` ya han pulsado —un carrito
// con cosas, una caja con ventas— y el `localStorage` de un puerto reusado
// podría traer lo de otra corrida.
import fs from "node:fs";
import path from "node:path";
import type { Browser, Page } from "puppeteer";
import { installSubresourceSsrfGuard } from "@/lib/security/render-ssrf-guard";
import { cerrarPestana } from "./navegador";

export const VISTAS = [
  ["escritorio", 1280, 900],
  ["movil", 390, 844],
] as const;

/** El nombre de una captura: el sub (único por corrida), la página y la vista. */
export function nombreDeCaptura(sub: string, ruta: string, vista: string): string {
  const pagina = ruta.replace(/^\/+|\/+$/g, "").replace(/[^a-z0-9-]/gi, "-");
  return `${sub}${pagina ? `-${pagina}` : ""}-${vista}.webp`;
}

/** Bajar por la página como un visitante antes de la foto: las secciones que
 *  aparecen al entrar en pantalla (IntersectionObserver) salían en blanco en una
 *  captura de página entera — medido en `lb-calculadora-del-taller-fc68a9`, dos
 *  tercios de la página vacíos. */
export async function bajarComoUnVisitante(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const paso = Math.max(200, Math.floor(window.innerHeight / 2));
    for (let y = 0; y < document.documentElement.scrollHeight; y += paso) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 150));
    }
    window.scrollTo(0, 0);
  });
  await new Promise((r) => setTimeout(r, 800));
}

/** Captura cada ruta en cada vista y devuelve los ficheros escritos. */
export async function capturarPublicada(o: {
  readonly navegador: Browser;
  /** Donde se sirve la publicada. */
  readonly url: string;
  /** El Next al que la página llama (formularios, backend): como en `abrir` de los graders. */
  readonly next: string;
  readonly sub: string;
  readonly rutas: readonly string[];
  readonly destino: string;
}): Promise<string[]> {
  fs.mkdirSync(o.destino, { recursive: true });
  const contexto = await o.navegador.createBrowserContext();
  const hechas: string[] = [];
  try {
    for (const ruta of o.rutas) {
      for (const [vista, ancho, alto] of VISTAS) {
        const page = await contexto.newPage();
        try {
          await page.setViewport({ width: ancho, height: alto });
          await installSubresourceSsrfGuard(page, { allowOrigins: [new URL(o.url).host, new URL(o.next).host] });
          // Una página que nunca llega a «networkidle0» (un sondeo, un vídeo) se
          // fotografía igual: lo que pintó hasta ahí es lo que vería el cliente.
          await page.goto(new URL(ruta, o.url).toString(), { waitUntil: "networkidle0", timeout: 30_000 }).catch(() => undefined);
          await bajarComoUnVisitante(page);
          const fichero = path.join(o.destino, nombreDeCaptura(o.sub, ruta, vista));
          fs.writeFileSync(fichero, await page.screenshot({ type: "webp", quality: 70, fullPage: true }));
          hechas.push(fichero);
        } finally {
          await cerrarPestana(page);
        }
      }
    }
  } finally {
    await contexto.close();
  }
  return hechas;
}
