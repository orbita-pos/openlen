// LA CAPTURA PARA EL AGENTE DE FUERA: el Chromium y el origen de los ojos de
// Len (como `lib/agent/design-screenshots.ts`), con la guarda SSRF. JPEG del
// viewport (~100 KB) y no la página entera por defecto: claude.ai corta en
// ~150k caracteres y OpenCode ha bloqueado sesiones con muchas imágenes.
// En paralelo, las medidas deterministas de siempre (contraste, desborde, JS).
import type { Browser } from "puppeteer";
import type { InlineImage } from "@/lib/ai-gateway";
import { describeMeasurements } from "@/lib/agent/verify";
import { esperarALaRed, origenDeMedida } from "@/lib/ai/origen-de-medida";
import { lanzarChromium, renderVisualQualityViewports } from "@/lib/ai/visual-quality-renderer";
import { carpetaDeLaVista, documentoMedible, type ContextoDeVista } from "@/lib/lienzo/documento";
import { installSubresourceSsrfGuard } from "@/lib/security/render-ssrf-guard";

export interface CaptureRequest {
  html: string;
  vista: ContextoDeVista;
  viewport: "desktop" | "mobile";
  fullPage: boolean;
}

export interface CaptureResult {
  image: InlineImage | null;
  measurements: string | null;
}

const VIEWPORTS = {
  desktop: { width: 1280, height: 800 },
  mobile: { width: 390, height: 844, isMobile: true, hasTouch: true },
} as const;
const MAX_FULL_HEIGHT = 4096;
/** Por debajo de los 60 s de Codex, con margen para el resto de la llamada. */
const PLAZO_MS = 40_000;

export async function captureProjectView(
  req: CaptureRequest,
  internals: {
    lanzar?: () => Promise<Browser>;
    medir?: typeof renderVisualQualityViewports;
    plazoMs?: number;
  } = {},
): Promise<CaptureResult> {
  const plazo = internals.plazoMs ?? PLAZO_MS;
  const lanzado = (internals.lanzar ?? lanzarChromium)();

  const shot = (async (): Promise<InlineImage | null> => {
    const browser = await lanzado;
    const origen = await origenDeMedida();
    const page = await browser.newPage();
    try {
      const v = VIEWPORTS[req.viewport];
      await page.setViewport(v);
      await installSubresourceSsrfGuard(page, { allowOrigins: [origen.origin] });
      const opciones = await carpetaDeLaVista(req.vista);
      const doc = origen.publicar(documentoMedible(req.html, req.vista), opciones);
      await page.goto(doc.url + (opciones?.hash ?? ""), { waitUntil: "load", timeout: 15_000 });
      await esperarALaRed(page, opciones);
      const clip = req.fullPage
        ? { x: 0, y: 0, width: v.width, height: (await page.evaluate(`Math.min(document.documentElement.scrollHeight, ${MAX_FULL_HEIGHT})`)) as number }
        : undefined;
      const b64 = (await page.screenshot({
        type: "jpeg",
        quality: 70,
        encoding: "base64",
        ...(clip ? { clip, captureBeyondViewport: true } : {}),
      })) as string;
      return { mimeType: "image/jpeg", dataBase64: b64 };
    } finally {
      await page.close().catch(() => undefined);
    }
  })().catch(() => null);

  const measured = (async (): Promise<string | null> => {
    const medir = internals.medir ?? renderVisualQualityViewports;
    const doc = documentoMedible(req.html, req.vista);
    const carpeta = await carpetaDeLaVista(req.vista);
    const m = await (carpeta ? medir(doc, {}, { carpeta }) : medir(doc));
    return m ? describeMeasurements(m) : null;
  })().catch(() => null);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((r) => {
    timer = setTimeout(() => r("timeout"), plazo);
  });
  try {
    const both = Promise.all([shot, measured]).then(([image, measurements]) => ({ image, measurements }));
    const r = await Promise.race([both, timeout]);
    return r === "timeout" ? { image: null, measurements: null } : r;
  } finally {
    if (timer) clearTimeout(timer);
    void lanzado.then((b) => b.close()).catch(() => undefined);
  }
}
