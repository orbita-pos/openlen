// EL CARRITO, PROBADO EN UN NAVEGADOR — no leído.
//
// El caso `carrito-con-base-de-datos` sólo miraba el TEXTO de la página: que
// hubiera un almacén `propio` y que apareciera `/api/d/`. El 2026-09-18 pasó
// esas dos cosas un carrito que en producción no guardaba nada (ver
// `lib/page-data/sustituto.ts`). Un texto correcto no es un carrito que
// funciona.
//
// Esto lo usa como lo usaría un visitante, contra el sustituto de /api/d —las
// mismas reglas que el servidor real—:
//   1. pulsa dos botones de «agregar»;
//   2. mira qué quedó guardado: tiene que haber dos unidades;
//   3. borra el localStorage y recarga: la página tiene que LEER su carrito de
//      la base, o la base es una copia que nadie usa;
//   4. y lo repite con el almacén LLENO, para ver si la página se entera de que
//      el servidor dijo que no o si le miente al visitante (ver abajo, «¿Y SI
//      EL SERVIDOR DICE QUE NO?»).
// Y cualquier llamada que el servidor habría rechazado es un fallo por sí sola.
//
// Es herramienta del eval, no del producto: no cobra y no toca la base.

import type { Browser } from "puppeteer";

import { origenDeMedida, type OrigenDeMedida } from "@/lib/ai/origen-de-medida";
import type { LlamadaADatos, Sustituto } from "@/lib/page-data/sustituto";
import { leerDeclaracion } from "@/lib/page-data/declaracion";
import { BYTES_POR_PLAN } from "@/lib/page-data/cuota";
import { installSubresourceSsrfGuard } from "@/lib/security/render-ssrf-guard";

export interface VeredictoDelCarrito {
  /** `null` si el carrito funciona. */
  readonly fallo: string | null;
  /** Una línea con lo medido, pase o no — para contar defectos entre corridas. */
  readonly detalle: string;
}

const TEXTO_DE_AGREGAR = /agregar|añadir|anadir|al carrito|add to cart|a[ñn]ade/i;
const CLAVES_DE_CANTIDAD = ["cantidad", "qty", "quantity", "cant", "unidades"];

/** Cuántas unidades representa lo guardado. Una lista cuenta sus elementos (o
 *  su `cantidad`); un documento suelto cuenta 1 (o su `cantidad`). */
export function unidadesGuardadas(docs: readonly { doc: Record<string, unknown> }[]): number {
  const cantidadDe = (x: unknown): number => {
    if (x && typeof x === "object" && !Array.isArray(x)) {
      for (const k of CLAVES_DE_CANTIDAD) {
        const v = (x as Record<string, unknown>)[k];
        if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
      }
    }
    return 1;
  };
  let total = 0;
  for (const { doc } of docs) {
    const listas = Object.values(doc).filter(Array.isArray) as unknown[][];
    if (listas.length > 0) {
      total += Math.max(...listas.map((l) => l.reduce<number>((n, x) => n + cantidadDe(x), 0)));
    } else {
      total += cantidadDe(doc);
    }
  }
  return total;
}

function resumirRechazos(llamadas: readonly LlamadaADatos[]): string {
  const cuenta = new Map<string, number>();
  for (const l of llamadas) {
    if (l.status < 400) continue;
    const clave = `${l.metodo} ${l.ruta} → ${l.status} ${l.error ?? ""}`.trim();
    cuenta.set(clave, (cuenta.get(clave) ?? 0) + 1);
  }
  return [...cuenta].map(([k, n]) => (n > 1 ? `${k} ×${n}` : k)).join("; ");
}

async function esperar(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function abrirNavegador(): Promise<Browser> {
  const puppeteer = (await import("puppeteer")).default;
  return puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH?.trim() || undefined,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
}

export async function comprobarCarritoEnNavegador(
  html: string,
  opciones: { readonly sub: string | null },
): Promise<VeredictoDelCarrito> {
  const almacenes = Object.entries(leerDeclaracion(html)).filter(([, a]) => a.modo === "propio");
  if (almacenes.length === 0) {
    return { fallo: "no hay almacén `propio` que probar", detalle: "sin almacén propio" };
  }

  const origen = await origenDeMedida();
  const browser = await abrirNavegador();
  try {
    const carrito = await probarElCarrito(browser, origen, html, opciones);
    // EL AVISO SÓLO SE PREGUNTA SI EL CARRITO FUNCIONA. Preguntarle «¿avisas
    // cuando el servidor rechaza?» a uno que no guarda ni cuando acepta es
    // medir ruido, y taparía el fallo de verdad con un segundo fallo.
    if (carrito.fallo) return carrito;
    const aviso = await comprobarAvisoConNavegador(browser, origen, html, opciones);
    const detalle = `${carrito.detalle} · avisa al visitante: ${aviso.detalle}`;
    return { fallo: aviso.fallo, detalle };
  } finally {
    await browser.close();
  }
}

async function probarElCarrito(
  browser: Browser,
  origen: OrigenDeMedida,
  html: string,
  opciones: { readonly sub: string | null },
): Promise<VeredictoDelCarrito> {
  const almacenes = Object.entries(leerDeclaracion(html)).filter(([, a]) => a.modo === "propio");
  const doc = origen.publicar(html, { sub: opciones.sub });
  try {
    const page = await browser.newPage();
    page.on("dialog", (d) => void d.dismiss().catch(() => {}));
    await installSubresourceSsrfGuard(page, { allowOrigins: [origen.origin] });
    await page.goto(doc.url, { waitUntil: "load", timeout: 20_000 });
    await esperar(600);

    // 1. Dos «agregar». Distintos si hay, el mismo dos veces si sólo hay uno:
    //    el carrito correcto guarda 2 unidades en los dos casos.
    const pulsados = await page.evaluate((fuente: string) => {
      const re = new RegExp(fuente, "i");
      const candidatos = Array.from(
        document.querySelectorAll<HTMLElement>("button, a, [role=button], input[type=button], input[type=submit]"),
      ).filter((el) => re.test((el.textContent ?? "") + " " + (el.getAttribute("aria-label") ?? "") + " " + ((el as HTMLInputElement).value ?? "")));
      const elegidos = candidatos.length >= 2 ? candidatos.slice(0, 2) : candidatos.slice(0, 1).concat(candidatos.slice(0, 1));
      for (const el of elegidos) el.click();
      return { candidatos: candidatos.length, pulsados: elegidos.length };
    }, TEXTO_DE_AGREGAR.source);
    await esperar(1200);

    if (pulsados.pulsados === 0) {
      return { fallo: "no encontré ningún botón de agregar", detalle: "0 botones de agregar" };
    }

    const datos: Sustituto = doc.datos;
    const unidades = Math.max(...almacenes.map(([nombre]) => unidadesGuardadas(datos.documentos(nombre))));
    const antesDeRecargar = datos.llamadas().length;

    // 3. Sin localStorage, ¿lee su carrito de la base?
    await page.evaluate(() => {
      try { localStorage.clear(); sessionStorage.clear(); } catch { /* sin almacén local */ }
    });
    await page.goto(doc.url, { waitUntil: "load", timeout: 20_000 });
    await esperar(1000);
    const trasRecargar = datos.llamadas().slice(antesDeRecargar);
    const leyoDeLaBase = trasRecargar.some((l) => l.metodo === "GET" && l.status === 200);

    const llamadas = datos.llamadas();
    const rechazos = resumirRechazos(llamadas);
    const rutas = [...new Set(llamadas.map((l) => `${l.metodo} ${l.ruta}`))].join(", ") || "ninguna";
    const detalle =
      `llamadas: ${rutas} · rechazadas: ${rechazos || "0"} · unidades guardadas tras 2 clics: ${unidades}` +
      ` · lee al recargar: ${leyoDeLaBase ? "sí" : "no"} · botones de agregar: ${pulsados.candidatos}`;

    if (llamadas.length === 0) return { fallo: "la página no llamó nunca a /api/d al usarla", detalle };
    if (rechazos) return { fallo: `el servidor habría rechazado: ${rechazos}`, detalle };
    if (unidades < 2) return { fallo: `tras agregar 2 veces, la base guarda ${unidades}`, detalle };
    if (!leyoDeLaBase) return { fallo: "al recargar sin localStorage no lee su carrito de la base", detalle };
    return { fallo: null, detalle };
  } finally {
    doc.soltar();
  }
}

// ———————————————————————————————————————————————————————————————————————
// ¿Y SI EL SERVIDOR DICE QUE NO?
//
// 🔴 EL HUECO (2026-09-19). Todo lo de arriba mide el camino feliz: almacén
// vacío, el servidor acepta, el carrito guarda. Pero `/api/d` tiene noes de
// verdad —413 documento grande, 507 cuota llena, 403 origen— y el que llega
// SOLO es el 507: le pasa a la página a la que le VA BIEN, cuando sus
// visitantes han llenado el megabyte del plan gratuito.
//
// De ese momento se enteran el dueño (panel de Datos) y Len
// (`avisoDeCuotaParaElModelo`). El visitante no: pulsa «Añadir», ve crecer el
// carrito —porque la página lo pinta ANTES de preguntar—, recarga, y no hay
// nada. Nadie le mintió a propósito; el `fetch` sencillamente no se miraba.
//
// CÓMO SE MIDE, sin leer el código ni preguntarle al modelo: se corre la MISMA
// página dos veces con el mismo clic, una con el almacén sano y otra con el
// almacén lleno, y se compara lo que el visitante PERCIBE —el texto que
// aparece y los diálogos del navegador—:
//
//   · reacciona IGUAL en los dos casos → miente: le dijo que lo añadió;
//   · reacciona DISTINTO               → se enteró del no y lo trató.
//
// Es el brazo de control de siempre, y es ciego al idioma, al modelo y a cómo
// esté escrita la página: no busca la palabra «error» en ningún sitio.

/** El almacén lleno: el tope del plan gratuito, gastado. No es un número
 *  inventado para fabricar un fallo — es el estado al que llega sola cualquier
 *  página que funcione. */
const ALMACEN_LLENO = BYTES_POR_PLAN.free;

/** Lo que el visitante percibe al pulsar una vez. */
interface Reaccion {
  /** Texto que APARECE, más lo que el navegador le enseñe en un diálogo — que
   *  no sale en el texto y es una forma legítima (fea, pero legítima) de
   *  decírselo. */
  readonly nuevo: readonly string[];
  readonly botones: number;
  readonly hubo507: boolean;
}

function lineasVisibles(texto: string): string[] {
  return texto.split("\n").map((l) => l.trim()).filter(Boolean);
}

/** Lo que hay en `despues` y no estaba en `antes`, CONTANDO REPETICIONES: un
 *  segundo «Chiapas» idéntico al primero es algo nuevo para quien mira. */
export function loNuevo(antes: readonly string[], despues: readonly string[]): string[] {
  const quedan = new Map<string, number>();
  for (const l of antes) quedan.set(l, (quedan.get(l) ?? 0) + 1);
  const nuevo: string[] = [];
  for (const l of despues) {
    const n = quedan.get(l) ?? 0;
    if (n > 0) quedan.set(l, n - 1);
    else nuevo.push(l);
  }
  return nuevo;
}

async function pulsarYMirar(
  browser: Browser,
  origen: OrigenDeMedida,
  html: string,
  opciones: { readonly sub: string | null; readonly bytesYaUsados?: number },
): Promise<Reaccion> {
  const doc = origen.publicar(html, opciones);
  const page = await browser.newPage();
  const dialogos: string[] = [];
  page.on("dialog", (d) => {
    dialogos.push(d.message());
    void d.dismiss().catch(() => {});
  });
  try {
    await installSubresourceSsrfGuard(page, { allowOrigins: [origen.origin] });
    await page.goto(doc.url, { waitUntil: "load", timeout: 20_000 });
    await esperar(600);
    const antes = lineasVisibles(await page.evaluate(() => document.body.innerText));
    const botones = await page.evaluate((fuente: string) => {
      const re = new RegExp(fuente, "i");
      const candidatos = Array.from(
        document.querySelectorAll<HTMLElement>("button, a, [role=button], input[type=button], input[type=submit]"),
      ).filter((el) => re.test((el.textContent ?? "") + " " + (el.getAttribute("aria-label") ?? "") + " " + ((el as HTMLInputElement).value ?? "")));
      candidatos[0]?.click();
      return candidatos.length;
    }, TEXTO_DE_AGREGAR.source);
    await esperar(1500);
    const despues = lineasVisibles(await page.evaluate(() => document.body.innerText));
    return {
      nuevo: [...loNuevo(antes, despues), ...dialogos.map((m) => `[diálogo] ${m}`)],
      botones,
      hubo507: doc.datos.llamadas().some((l) => l.status === 507),
    };
  } finally {
    doc.soltar();
    await page.close();
  }
}

const recortar = (partes: readonly string[], n: number): string => {
  const junto = partes.join(" / ");
  return junto.length > n ? `${junto.slice(0, n)}…` : junto;
};

async function comprobarAvisoConNavegador(
  browser: Browser,
  origen: OrigenDeMedida,
  html: string,
  opciones: { readonly sub: string | null },
): Promise<VeredictoDelCarrito> {
  const sano = await pulsarYMirar(browser, origen, html, opciones);
  if (sano.botones === 0) {
    return { fallo: null, detalle: "no se puede juzgar (0 botones de agregar)" };
  }

  const lleno = await pulsarYMirar(browser, origen, html, { ...opciones, bytesYaUsados: ALMACEN_LLENO });

  // CONTRA-PRUEBA DEL PROPIO MÉTODO. Si con el almacén lleno el servidor no
  // llegó a rechazar nada, la página no intentó guardar y el «no» no se ha
  // medido: aquí un verde sería VACÍO, que es peor que un rojo porque se lee
  // igual que uno de verdad.
  if (!lleno.hubo507) {
    return { fallo: null, detalle: "no se puede juzgar (con el almacén lleno la página no llegó a intentar guardar)" };
  }
  if (sano.nuevo.length === 0) {
    return { fallo: null, detalle: "no se puede juzgar (no cambia nada visible ni cuando el guardado funciona)" };
  }

  if (JSON.stringify(sano.nuevo) === JSON.stringify(lleno.nuevo)) {
    return {
      fallo:
        `la página reacciona IGUAL guarde o no: con el almacén lleno el servidor contestó 507 y aun así le enseñó ` +
        `«${recortar(sano.nuevo, 120)}». Lo que el visitante añada se pierde al recargar, y nadie se lo dice`,
      detalle: `no — misma reacción con 507 que sin él: ${recortar(sano.nuevo, 60)}`,
    };
  }
  return {
    fallo: null,
    detalle:
      lleno.nuevo.length === 0
        ? "no miente (con el 507 no pinta nada), pero tampoco le dice qué pasó"
        : `sí — con el 507 enseña «${recortar(lleno.nuevo, 60)}»`,
  };
}

/** La comprobación del aviso, sola — para medirla sin el carrito entero. */
export async function comprobarAvisoAlVisitante(
  html: string,
  opciones: { readonly sub: string | null },
): Promise<VeredictoDelCarrito> {
  const origen = await origenDeMedida();
  const browser = await abrirNavegador();
  try {
    return await comprobarAvisoConNavegador(browser, origen, html, opciones);
  } finally {
    await browser.close();
  }
}
