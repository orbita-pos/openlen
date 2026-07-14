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

// El CANDADO ESTRUCTURAL de red (hallazgo publish-safety, 2026-07-14): la
// interception por página NO cubre targets nuevos — un window.open() del JS
// del desconocido abría un popup con red VIVA (SSRF a metadata/loopback).
// Un proxy muerto a nivel NAVEGADOR mata el tráfico de TODOS los targets,
// popups incluidos; <-loopback> fuerza también a localhost a pasar por el
// proxy muerto (Chrome lo salta por default — sin esto, fetch al propio
// :3000 del app server seguía vivo). setContent entra por CDP, sin red.
const NETWORK_KILL_ARGS = [
  "--proxy-server=http://127.0.0.1:1",
  "--proxy-bypass-list=<-loopback>",
];

async function launch(): Promise<Browser> {
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH?.trim() || undefined;
  const base = { headless: true as const, executablePath, protocolTimeout: 30_000 };
  try {
    return await puppeteer.launch({ ...base, args: ["--disable-dev-shm-usage", ...NETWORK_KILL_ARGS] });
  } catch {
    // eslint-disable-next-line no-console
    console.warn("[transform] Chrome sandbox unavailable; relaunching with --no-sandbox (network stays fully blocked)");
    return puppeteer.launch({
      ...base,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", ...NETWORK_KILL_ARGS],
    });
  }
}

/** Tope por captura (hallazgo publish-safety #4): el JS del desconocido puede
 *  fabricar un innerHTML de cientos de MB — sin tope, OOM del Node o fila
 *  gigante en la DB. Más grande que esto = captura vacía (statu quo). */
const MAX_CAPTURE_CHARS = 500_000;

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
    // Capas encima del proxy muerto: TODO target de página que nazca DESPUÉS
    // de la nuestra (un window.open que se colara) se cierra al instante.
    // Ojo: el propio newPage() de arriba también emite targetcreated — por
    // eso el guardián se instala DESPUÉS y compara contra `page` (mi primera
    // versión mataba la página principal y el smoke lo cazó al instante).
    const mainTarget = page.target();
    browser.on("targetcreated", (t) => {
      if (t.type() !== "page" || t === mainTarget) return;
      t.page()
        .then((p) => p?.close().catch(() => {}))
        .catch(() => {});
    });
    await page.evaluateOnNewDocument(() => {
      window.open = () => null;
    });
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

    return await page.evaluate((maxChars: number) => {
      const containers: Record<string, string> = {};
      const geoms: Record<string, string> = {};
      // SECUESTRO DE SLOT (cazado por el fixture adversarial del gate,
      // 2026-07-14): el script de la página puede escribir NUESTRO marcador
      // dentro del contenedor. Entonces querySelectorAll matchea el
      // contenedor Y al impostor con el mismo índice — y el último ganaba,
      // así que el fragmento capturado era el del impostor y el contenido
      // legítimo SE PERDÍA. Dos defensas: (1) el PRIMERO gana (orden de
      // documento ⇒ el contenedor real siempre precede a cualquier hijo
      // impostor); (2) el fragmento se captura de un CLON con todo marcador
      // anidado ya removido, así ninguno vuelve al HTML guardado.
      const seen = new Set<string>();
      document.querySelectorAll("[data-ol-bake-c]").forEach((el) => {
        const k = el.getAttribute("data-ol-bake-c") as string;
        if (seen.has(k)) return;
        seen.add(k);
        const clone = el.cloneNode(true) as Element;
        clone.querySelectorAll("[data-ol-bake-c],[data-ol-bake-g]").forEach((n) => {
          n.removeAttribute("data-ol-bake-c");
          n.removeAttribute("data-ol-bake-g");
        });
        const frag = clone.innerHTML;
        if (frag.length > maxChars) return; // statu quo: mejor vacío que un OOM
        containers[k] = frag;
      });
      document.querySelectorAll("[data-ol-bake-g]").forEach((el) => {
        const attr = el.tagName.toLowerCase() === "path" ? "d" : "points";
        const v = el.getAttribute(attr);
        if (v) geoms[el.getAttribute("data-ol-bake-g") as string] = v;
      });
      return { containers, geoms };
    }, MAX_CAPTURE_CHARS);
  } finally {
    clearTimeout(kill);
    await browser?.close().catch(() => {});
  }
}
