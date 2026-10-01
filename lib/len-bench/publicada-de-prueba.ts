// lib/len-bench/publicada-de-prueba.ts — una release escrita a mano, servida
// como la sirve Caddy, para probar los graders SIN publicar ni llamar a nadie.
//
// Sólo la importan las pruebas. Las páginas son las del caso
// `taqueria-menu-whatsapp` en pequeño: la partida, y la solución con el menú y
// el botón de WhatsApp.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Browser } from "puppeteer";
import type { ProjectData } from "@/lib/projects/types";
import { servirPublicada } from "./servidor-publicada";
import type { Ficha, Grader, Intercambio } from "./tipos";

export const FICHA_TAQUERIA: Ficha = {
  negocio: "Taquería de barrio en Guadalajara, abierta de noche",
  datos: {
    plato_1: "Taco al pastor",
    precio_1: "$25",
    plato_2: "Taco de suadero",
    precio_2: "$25",
    plato_3: "Gringa",
    precio_3: "$70",
    plato_4: "Agua de horchata",
    precio_4: "$30",
    whatsapp: "+52 33 1234 5678",
  },
};

export const INICIO_TAQUERIA = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Taquería El Farol</title>
<style>
  *,*::before,*::after{box-sizing:border-box}
  body{margin:0;font-family:system-ui,sans-serif;background:#fffaf2;color:#2b1d0e}
  header,section,footer{padding:32px 20px;max-width:960px;margin:0 auto}
  nav a{margin-right:16px;color:#2b1d0e}
</style>
</head>
<body>
<header>
  <nav><a href="#inicio">Inicio</a><a href="#nosotros">Nosotros</a></nav>
</header>
<section id="inicio">
  <h1>Taquería El Farol</h1>
  <p>Tacos al carbón desde el barrio, como los de antes.</p>
</section>
<section id="nosotros">
  <h2>Nosotros</h2>
  <p>Somos una taquería familiar. Abrimos todas las noches.</p>
</section>
<footer><p>© 2026 Taquería El Farol</p></footer>
</body>
</html>`;

export const MENU_TAQUERIA = `<section id="menu">
  <h2>Menú</h2>
  <ul>
    <li>Taco al pastor — $25</li>
    <li>Taco de suadero — $25</li>
    <li>Gringa — $70</li>
    <li>Agua de horchata — $30</li>
  </ul>
  <a href="https://wa.me/523312345678" style="display:inline-block;padding:12px 18px;background:#1f7a3a;color:#fff;border-radius:8px;text-decoration:none">Pide por WhatsApp</a>
</section>`;

export const SOLUCION_TAQUERIA = INICIO_TAQUERIA.replace(
  '<a href="#nosotros">Nosotros</a>',
  '<a href="#nosotros">Nosotros</a><a href="#menu">Menú</a>',
).replace("<footer>", `${MENU_TAQUERIA}\n<footer>`);

/** Escribe `datos` como la release viva de `demo`, la sirve y califica. */
export async function calificarCon(
  grader: Grader,
  datos: ProjectData,
  o: {
    readonly inicio?: ProjectData;
    readonly ficha?: Ficha;
    readonly navegador?: Browser;
    /** El Next al que la publicada manda `/api/f/` y compañía. */
    readonly next?: string;
    readonly leerEnvios?: () => Promise<readonly Record<string, string>[]>;
    readonly publicadaPorLen?: boolean;
    readonly conversacion?: readonly Intercambio[];
    /** Califica n veces sobre el MISMO origen y devuelve la última: lo que una corrida deja en el navegador, ¿lo ve la siguiente? */
    readonly repetir?: number;
  } = {},
): Promise<{ paso: boolean; explicacion: string }> {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "lb-grader-"));
  const rel = path.join(raiz, "demo", "current");
  fs.mkdirSync(rel, { recursive: true });
  fs.writeFileSync(path.join(rel, "index.html"), datos.html);
  for (const [slug, p] of Object.entries(datos.pages ?? {})) {
    fs.mkdirSync(path.join(rel, slug), { recursive: true });
    fs.writeFileSync(path.join(rel, slug, "index.html"), p.html);
  }
  const next = o.next ?? "http://127.0.0.1:9";
  const s = await servirPublicada({ raiz, sub: "demo", next, hostPublicado: "demo.openlen.app" });
  try {
    for (let i = 1; i < (o.repetir ?? 1); i++) await calificarAqui();
    return await calificarAqui();
  } finally {
    await s.cerrar();
    fs.rmSync(raiz, { recursive: true, force: true });
  }

  function calificarAqui() {
    return grader.calificar({
      url: s.url,
      next,
      sub: "demo",
      projectId: "p-demo",
      ficha: o.ficha ?? FICHA_TAQUERIA,
      datos,
      inicio: o.inicio ?? { html: INICIO_TAQUERIA },
      publicadaPorLen: o.publicadaPorLen ?? false,
      conversacion: o.conversacion ?? [],
      // Los de resultados (plans/len-resultados/) y la traza del juez: ningún grader de página los lee.
      traza: [],
      herramientas: [],
      tarjetas: [],
      zona: "America/Mexico_City",
      // Los graders que no abren Chromium no lo tocan; los que sí, lo reciben.
      navegador: o.navegador ?? (null as unknown as Browser),
      leerEnvios: o.leerEnvios ?? (async () => []),
    });
  }
}
