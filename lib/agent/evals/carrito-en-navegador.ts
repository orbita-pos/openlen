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
//      la base, o la base es una copia que nadie usa.
// Y cualquier llamada que el servidor habría rechazado es un fallo por sí sola.
//
// Es herramienta del eval, no del producto: no cobra y no toca la base.

import { origenDeMedida } from "@/lib/ai/origen-de-medida";
import type { LlamadaADatos, Sustituto } from "@/lib/page-data/sustituto";
import { leerDeclaracion } from "@/lib/page-data/declaracion";
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

export async function comprobarCarritoEnNavegador(
  html: string,
  opciones: { readonly sub: string | null },
): Promise<VeredictoDelCarrito> {
  const almacenes = Object.entries(leerDeclaracion(html)).filter(([, a]) => a.modo === "propio");
  if (almacenes.length === 0) {
    return { fallo: "no hay almacén `propio` que probar", detalle: "sin almacén propio" };
  }

  const origen = await origenDeMedida();
  const doc = origen.publicar(html, { sub: opciones.sub });
  const puppeteer = (await import("puppeteer")).default;
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH?.trim() || undefined,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
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
    await browser.close();
  }
}
