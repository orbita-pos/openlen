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
const PLAZO_MS = 20_000;
const MARGEN = 8;

export async function captureDesignElements(
  p: { html: string; vista: ContextoDeVista; elements: readonly DesignElementRequest[]; limit: number },
  internals: { lanzar?: () => Promise<Browser>; plazoMs?: number } = {},
): Promise<InlineImage[]> {
  const pedidos = p.elements.filter((e) => e.primary >= 0).slice(0, Math.min(p.limit, DESIGN_LIMITS.screenshots));
  if (pedidos.length === 0) return [];
  const plazo = internals.plazoMs ?? PLAZO_MS;
  const browser = await (internals.lanzar ?? lanzarChromium)();
  const trabajo = (async () => {
    const out: InlineImage[] = [];
    const origen = await origenDeMedida();
    for (const el of pedidos) {
      const page = await browser.newPage();
      try {
        await page.setViewport({ width: 1280, height: 900 });
        await installSubresourceSsrfGuard(page, { allowOrigins: [origen.origin] });
        const vista = { ...p.vista, pantalla: el.screen };
        const opciones = await carpetaDeLaVista(vista);
        const doc = origen.publicar(documentoMedible(p.html, vista), opciones);
        await page.goto(doc.url + (opciones?.hash ?? ""), { waitUntil: "load", timeout: 15_000 });
        await esperarALaRed(page, opciones);
        const link = el.chain[el.primary]!;
        const caja = (await page.evaluate(
          `${FUNCIONES}\nboxOf(${JSON.stringify(link.path)}, ${link.line}, ${JSON.stringify(el.tag)}, ${DESIGN_LIMITS.chain})`,
        )) as { x: number; y: number; width: number; height: number } | null;
        if (!caja) continue;
        const x = Math.max(0, caja.x - MARGEN);
        const y = Math.max(0, caja.y - MARGEN);
        const clip = { x, y, width: Math.min(1280 - x, caja.width + 2 * MARGEN), height: Math.min(900 - y, caja.height + 2 * MARGEN) };
        if (clip.width < 2 || clip.height < 2) continue;
        const b64 = (await page.screenshot({ type: "png", clip, encoding: "base64" })) as string;
        out.push({ mimeType: "image/png", dataBase64: b64 });
      } catch {
        // Una captura que no sale no tumba el turno: Len tiene el texto.
      } finally {
        await page.close().catch(() => undefined);
      }
    }
    return out;
  })();
  try {
    return await Promise.race([trabajo, new Promise<InlineImage[]>((r) => setTimeout(() => r([]), plazo))]);
  } finally {
    await browser.close().catch(() => undefined);
  }
}
