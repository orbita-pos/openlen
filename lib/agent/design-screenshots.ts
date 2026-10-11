// LAS CAPTURAS DEL MODO DISEÑO, como las que v0 manda con «Apply»: cada
// elemento recortado en su pantalla, tal como está GUARDADO (los cambios van
// en el texto). Con el Chromium y el origen de los ojos (`usar-pagina.ts`), y
// el elemento se encuentra por su origen con las mismas funciones que el
// lienzo (`lib/apps/design/canvas-functions.ts`). Una que falla no tumba nada.
import type { Browser } from "puppeteer";
import type { InlineImage } from "@/lib/ai-gateway";
import { esperarALaRed, origenDeMedida } from "@/lib/ai/origen-de-medida";
import { lanzarChromium } from "@/lib/ai/visual-quality-renderer";
import { boxOf, primaryOf, sourceChainOf, targetsOf } from "@/lib/apps/design/canvas-functions";
import { DESIGN_LIMITS, type DesignElementRequest } from "@/lib/apps/design/types";
import { carpetaDeLaVista, documentoMedible, type ContextoDeVista } from "@/lib/lienzo/documento";
import { installSubresourceSsrfGuard } from "@/lib/security/render-ssrf-guard";
import { decl } from "@/components/workspace-v2/serializar-al-iframe";

const FUNCIONES = [decl("sourceChainOf", sourceChainOf), decl("primaryOf", primaryOf), decl("targetsOf", targetsOf), decl("boxOf", boxOf)].join("\n");
// Las capturas van antes de que Len empiece: a la vez, con un plazo corto, y se
// cortan si el dueño cancela el turno (`signal`).
const PLAZO_MS = 12_000;
const MARGEN = 8;

export async function captureDesignElements(
  p: { html: string; vista: ContextoDeVista; elements: readonly DesignElementRequest[]; limit: number; signal?: AbortSignal },
  internals: { lanzar?: () => Promise<Browser>; plazoMs?: number } = {},
): Promise<InlineImage[]> {
  const pedidos = p.elements.filter((e) => e.primary >= 0).slice(0, Math.min(p.limit, DESIGN_LIMITS.screenshots));
  if (pedidos.length === 0 || p.signal?.aborted) return [];
  const plazo = internals.plazoMs ?? PLAZO_MS;
  let cancelar: () => void = () => {};
  const cancelado = new Promise<InlineImage[]>((r) => {
    cancelar = () => r([]);
    p.signal?.addEventListener("abort", cancelar, { once: true });
  });
  const lanzado = (internals.lanzar ?? lanzarChromium)();
  const trabajo = (async () => {
    const browser = await lanzado;
    if (p.signal?.aborted) return [];
    const origen = await origenDeMedida();
    const una = async (el: DesignElementRequest): Promise<InlineImage | null> => {
      const page = await browser.newPage();
      try {
        await page.setViewport({ width: 1280, height: 900 });
        await installSubresourceSsrfGuard(page, { allowOrigins: [origen.origin] });
        const vista = { ...p.vista, pantalla: el.screen };
        const opciones = await carpetaDeLaVista(vista);
        const doc = origen.publicar(documentoMedible(p.html, vista), opciones);
        await page.goto(doc.url + (opciones?.hash ?? ""), { waitUntil: "load", timeout: 10_000 });
        await esperarALaRed(page, opciones);
        const link = el.chain[el.primary]!;
        const caja = (await page.evaluate(
          `${FUNCIONES}
boxOf(${JSON.stringify(link.path)}, ${link.line}, ${JSON.stringify(el.tag)}, ${DESIGN_LIMITS.chain})`,
        )) as { x: number; y: number; width: number; height: number } | null;
        if (!caja) return null;
        const x = Math.max(0, caja.x - MARGEN);
        const y = Math.max(0, caja.y - MARGEN);
        const clip = { x, y, width: Math.min(1280 - x, caja.width + 2 * MARGEN), height: Math.min(900 - y, caja.height + 2 * MARGEN) };
        if (clip.width < 2 || clip.height < 2) return null;
        const b64 = (await page.screenshot({ type: "png", clip, encoding: "base64" })) as string;
        return { mimeType: "image/png", dataBase64: b64 };
      } catch {
        // Una captura que no sale no tumba el turno: Len tiene el texto.
        return null;
      } finally {
        await page.close().catch(() => undefined);
      }
    };
    // A la vez, y en el orden de los elementos.
    const hechas = await Promise.all(pedidos.map(una));
    return hechas.filter((x): x is InlineImage => x !== null);
  })();
  try {
    return await Promise.race([trabajo, cancelado, new Promise<InlineImage[]>((r) => setTimeout(() => r([]), plazo))]);
  } finally {
    p.signal?.removeEventListener("abort", cancelar);
    void lanzado.then((b) => b.close()).catch(() => undefined);
  }
}
