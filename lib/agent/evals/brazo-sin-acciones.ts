// EL BRAZO SIN ACCIONES DE LA BATERÍA — ¿discrimina la promesa del turno?
//
// 🔴 POR QUÉ EXISTE (2026-09-22). Una promesa puede salir verde sin decir nada
// de lo que el modelo hizo: la afirmación ya se cumplía antes de actuar (un
// contador que llega solo, un panel que ya estaba visible) o la promesa no
// pide ninguna acción. El DSL lo medía porque conocía sus expectativas de
// antemano; un programa JS no las enseña hasta que corre, así que la forma de
// medirlo es la de un eval con brazo de control: correr la MISMA promesa sobre
// la MISMA página, sin el sujeto —sus acciones—, y ver qué se cumple igual.
//
// ES DE LA BATERÍA, NO DEL TURNO DEL USUARIO. Cuesta otra carga de la página y
// no cambia ningún veredicto: lo que devuelve se enseña en el informe y NO
// puntúa. Primero el número en corridas limpias; después, si acaso, la puerta.
//
// Aparte de `harness.ts` a propósito: aquel importa la base de datos al cargar,
// y esto tiene que poder probarse en un navegador sin tocarla.
import { cargarEnOrigenReal, origenDeMedida } from "@/lib/ai/origen-de-medida";
import { installSubresourceSsrfGuard } from "@/lib/security/render-ssrf-guard";
import { leerVacuas, programaSinAccionesJs, type FalloSpec } from "@/lib/agent/prueba-js";

/**
 * Corre `codigo` con sus acciones anuladas sobre `html` —el mismo documento que
 * midieron los ojos— y devuelve lo que se cumple también así.
 *
 * Vacío = todas sus afirmaciones dependen de las acciones: la promesa
 * discrimina. Lanza si no pudo medir; quien llama decide qué hacer con eso, y
 * en la batería es dejar la medida AUSENTE, que no es lo mismo que vacía.
 */
export async function brazoSinAcciones(html: string, codigo: string): Promise<readonly FalloSpec[]> {
  const puppeteer = (await import("puppeteer")).default;
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH?.trim() || undefined,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  try {
    const page = await browser.newPage();
    const origen = await origenDeMedida();
    await installSubresourceSsrfGuard(page, { allowOrigins: [origen.origin] });
    await cargarEnOrigenReal(page, html);
    return leerVacuas(await page.evaluate(programaSinAccionesJs(codigo)));
  } finally {
    await browser.close();
  }
}
