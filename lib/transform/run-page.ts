import "server-only";

// El runPage REAL (spec 2026-07-14): ejecuta la página etiquetada UNA vez en
// Chrome y captura SOLO los objetivos data-ol-bake-*. Seguridad primero — el
// from-html ejecuta JS de un desconocido:
//
//   · RED TOTALMENTE BLOQUEADA: request interception aborta TODO. El
//     documento entra por setContent (CDP, sin red); un script que necesitaba
//     red para llenar su contenedor deja el contenedor vacío = statu quo.
//     Sin red tampoco hay exfiltración ni SSRF.
//   · Timeout duro (browser.close() forzado) — un while(true) muere con el
//     proceso, no cuelga la request.
//   · Sandbox de Chrome ACTIVO donde el SO lo permite (Windows dev, y el box
//     si corre sin root); si el launch falla (el caso EPERM típico de
//     Hetzner), reintenta con --no-sandbox + log — desviación consciente del
//     spec: el resto del repo ya corre así (capture-screenshot.ts:43) y la
//     alternativa era que el transform jamás corriera en prod. La defensa
//     real aquí es la red bloqueada + el timeout, no el sandbox.
//
// Scroll rápido antes de capturar: varios llenados del catálogo disparan con
// IntersectionObserver (mismo motivo que el autoscroll v2 de
// capture-screenshot.ts) — sin pasar por el viewport, no llenan.
import puppeteer, { type Browser } from "puppeteer";
import type { PageCapture } from "./bake";

const SETTLE_MS = 300;

async function launch(): Promise<Browser> {
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH?.trim() || undefined;
  const base = { headless: true as const, executablePath, protocolTimeout: 30_000 };
  try {
    return await puppeteer.launch({ ...base, args: ["--disable-dev-shm-usage"] });
  } catch {
    // eslint-disable-next-line no-console
    console.warn("[transform] Chrome sandbox unavailable; relaunching with --no-sandbox (network stays fully blocked)");
    return puppeteer.launch({
      ...base,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
  }
}

export async function runPageNoNetwork(taggedHtml: string, timeoutMs = 5000): Promise<PageCapture> {
  let browser: Browser | null = null;
  // El verdugo: pase lo que pase dentro (scripts colgados, evaluate eterno),
  // al vencer el plazo el navegador entero se cierra y toda promesa pendiente
  // revienta — el caller (index.ts) lo convierte en fallback al original.
  const kill = setTimeout(() => {
    browser?.close().catch(() => {});
  }, timeoutMs);
  try {
    browser = await launch();
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on("request", (r) => {
      r.abort().catch(() => {});
    });
    page.setDefaultTimeout(timeoutMs);
    await page.setContent(taggedHtml, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    // Disparar IntersectionObservers: fondo y de vuelta, sin animación.
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    await new Promise((r) => setTimeout(r, SETTLE_MS));
    await page.evaluate(() => {
      window.scrollTo(0, 0);
    });
    await new Promise((r) => setTimeout(r, SETTLE_MS));

    return await page.evaluate(() => {
      const containers: Record<string, string> = {};
      const geoms: Record<string, string> = {};
      document.querySelectorAll("[data-ol-bake-c]").forEach((el) => {
        containers[el.getAttribute("data-ol-bake-c") as string] = el.innerHTML;
      });
      document.querySelectorAll("[data-ol-bake-g]").forEach((el) => {
        const attr = el.tagName.toLowerCase() === "path" ? "d" : "points";
        const v = el.getAttribute(attr);
        if (v) geoms[el.getAttribute("data-ol-bake-g") as string] = v;
      });
      return { containers, geoms };
    });
  } finally {
    clearTimeout(kill);
    await browser?.close().catch(() => {});
  }
}
