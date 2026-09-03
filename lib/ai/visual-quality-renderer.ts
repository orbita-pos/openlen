import type { InlineImage } from "@/lib/ai-gateway";
import { installSubresourceSsrfGuard } from "@/lib/security/render-ssrf-guard";
import { cargarEnOrigenReal, origenDeMedida } from "@/lib/ai/origen-de-medida";
import { PULSAR_CONTROLES } from "@/lib/ai/press-controls";
import { decodificarPng, type PngCrudo } from "@/lib/ai/png-crudo";
import { juzgarContraste, type CandidatoDeContraste, type UnreadableTextFinding } from "@/lib/ai/contraste";

export const VISUAL_QUALITY_DESKTOP_VIEWPORT = { width: 1280, height: 720 } as const;
export const VISUAL_QUALITY_MOBILE_VIEWPORT = { width: 390, height: 844 } as const;
const MAX_VIEWPORT_BYTES = 1024 * 1024;
// These captures cross the same inline-image boundary as generated assets,
// which refuses anything over 4096px on an axis. A full-page mobile capture of
// a real landing page is several times that, so the critic was never shown a
// page at all — the request died before leaving the process.
const MAX_CAPTURE_HEIGHT = 4096;
const DETERMINISTIC_RENDER_RESET = "<style data-openlen-deterministic-render-reset>*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}}</style>";

// El tipo se mudó a `lib/ai/contraste.ts`, que es quien lo produce: este
// módulo importa `juzgarContraste` de allí, así que declararlo aquí crearía un
// ciclo. Se REEXPORTA para que quien lo importa de este módulo
// —lib/agent/verify.ts, lib/document/repair-unreadable-text.ts y sus pruebas—
// no tenga que cambiar ni una línea.
export type { UnreadableTextFinding } from "@/lib/ai/contraste";

/** Cuál de los tres defectos de jerarquía se midió, y con qué números. Sin
 *  esto el reparador recibe la palabra "typography" y tiene que adivinar si el
 *  titular es chico, si el cuerpo es ilegible, o si no se distinguen entre sí. */
export interface TypographyHierarchyFinding {
  readonly rule: "h1_missing" | "h1_not_rendered" | "h1_too_small" | "hero_body_too_small" | "h1_not_dominant";
  /** Nulo cuando no hubo titular medible. No es cero: es "no se midió". */
  readonly h1FontPx: number | null;
  readonly h1Count: number;
  readonly heroBodyFontPx: number | null;
}

export interface VisualQualityViewports {
  desktop: InlineImage;
  mobile: InlineImage;
  mobileOverflow?: boolean;
  weakTypographyHierarchy?: boolean;
  typographyHierarchy?: TypographyHierarchyFinding | null;
  squareComponentTreatment?: boolean;
  invalidGeometry?: boolean;
  unreadableText?: readonly UnreadableTextFinding[];
  /** El elemento MÁS PROFUNDO que se sale de la pantalla en móvil, y hasta
   *  dónde llega. Vacío cuando no hay desborde o no se pudo identificar.
   *  Ver la sonda: nombrar al ancestro manda a mirar donde no está la causa. */
  overflowCulprit?: string;
  overflowCulpritRight?: number;
  /** LO QUE LA PÁGINA GRITÓ — al cargar Y AL APRETAR SUS CONTROLES; excepciones
   *  no capturadas y errores de consola, deduplicados.
   *
   *  Este render se hace DOS veces por página al crearla y nunca preguntaba si
   *  el JavaScript reventaba. MEDIDO el 2026-08-21: el modelo escribió un
   *  `const` y luego lo reasignó, la captura salió perfecta y el juego estaba
   *  muerto antes del primer clic. Los ojos del Agente ya recogen esto tras
   *  editar (`lib/ai/inline-image.ts`); al NACER, nadie miraba.
   *
   *  Ausente cuando el llamador inyectó su propio `capture` (no hay página a la
   *  que escuchar) o cuando la página no dijo nada. */
  runtimeErrors?: readonly string[];
  /** LO QUE NOSOTROS CORTAMOS, no lo que la página hizo mal.
   *
   *  El guardia SSRF bloquea los recursos que apuntan a loopback o a redes
   *  internas —una página hostil podría apuntar un `<img>` a la app del propio
   *  servidor—, y eso deja un HUECO en la captura idéntico al de una imagen
   *  rota de verdad. El modelo con visión lo lee como «imagen rota» y el
   *  Agente lo arregla BORRÁNDOLA.
   *
   *  MEDIDO el 2026-08-27: Jesús adjuntó una foto, el Agente la colocó bien, y
   *  en el turno siguiente se la quitó explicándole que su URL «sólo existe en
   *  tu máquina». En dev toda subida propia sale con URL de localhost porque
   *  no hay R2 — así que el guardia convierte cada imagen que el usuario sube
   *  en una rota a ojos del verificador.
   *
   *  Ausente cuando no se cortó nada. */
  blockedSubresources?: readonly string[];
  /** Lo CRUDO que devolvió el guion declarado por el modelo, tal cual sale del
   *  navegador. Se deja sin tipar aquí a propósito: este módulo no sabe de
   *  specs, sólo ejecuta el programa que le dan y devuelve lo que salga. Quien
   *  lo pidió lo interpreta con `leerFallos`. Ausente si no se pidió guion. */
  behaviorResult?: unknown;
}

/** Opciones de PRODUCTO del render — distintas de `Internals`, que son puntos
 *  de inyección para las pruebas. */
export interface VisualQualityRenderOptions {
  /**
   * El guion que el modelo declaró para su propio JavaScript, ya compilado a
   * programa de navegador (`specProgram`). Cuando viene, se ejecuta EN LUGAR
   * del pulsado a ciegas: pulsar todo comprueba «¿explota?» y el guion
   * comprueba «¿hizo lo que prometió?», que es la pregunta que de verdad
   * separa una página entregada de una redactada.
   */
  readonly behaviorProgram?: string;
}

interface PageLike {
  setViewport(viewport: { width: number; height: number }): Promise<unknown>;
  setContent(html: string, options?: { waitUntil?: "load"; timeout?: number }): Promise<unknown>;
  /** Opcional por la misma razón que `on`: los dobles de prueba implementan
   *  esta interfaz a mano. Cuando existe se navega a un origen de verdad
   *  (origen-de-medida.ts) en vez de volcar el documento en `about:blank`,
   *  que es un origen OPACO donde `localStorage` lanza. */
  goto?(url: string, options?: { waitUntil?: "load"; timeout?: number }): Promise<unknown>;
  /** Opcional a propósito: los dobles de prueba implementan esta interfaz a
   *  mano y exigirlo los rompería a todos por una señal que no piden. */
  on?(event: string, handler: (payload: unknown) => void): unknown;
  /** Acepta también una CADENA: el programa de pulsar no puede ser una función
   *  (el ayudante `__name` de esbuild no existe en el navegador). */
  evaluate(pageFunction: (() => unknown) | string): Promise<unknown>;
  screenshot(options: {
    /** PNG para la captura de SONDEO —hay que leer píxeles exactos y JPEG
     *  destroza justo eso—; JPEG para las dos que se le entregan al modelo. */
    type: "jpeg" | "png";
    /** Sólo JPEG: puppeteer lanza si se le manda calidad con PNG. */
    quality?: number;
    captureBeyondViewport: boolean;
    clip: { x: number; y: number; width: number; height: number };
  }): Promise<Uint8Array>;
}

interface BrowserLike {
  newPage(): Promise<PageLike>;
  close(): Promise<unknown>;
}

export interface VisualQualityRendererInternals {
  capture?: (html: string, viewport: { width: number; height: number }) => Promise<InlineImage | null>;
  launchBrowser?: () => Promise<BrowserLike>;
  installGuard?: (page: PageLike, allowOrigin: string) => Promise<unknown>;
  settle?: () => Promise<unknown>;
}

function isBoundedJpeg(image: InlineImage | null): image is InlineImage {
  if (!image || image.mimeType !== "image/jpeg" || image.dataBase64.length === 0) return false;
  try {
    const bytes = Buffer.from(image.dataBase64, "base64");
    return bytes.length > 0 && bytes.length <= MAX_VIEWPORT_BYTES;
  } catch {
    return false;
  }
}

function injectDeterministicRenderReset(html: string): string {
  const openingHead = /<head\b[^>]*>/i.exec(html);
  if (openingHead?.index !== undefined) {
    const afterOpeningHead = openingHead.index + openingHead[0].length;
    return `${html.slice(0, afterOpeningHead)}${DETERMINISTIC_RENDER_RESET}${html.slice(afterOpeningHead)}`;
  }
  const openingBody = /<body\b/i.exec(html);
  if (openingBody?.index !== undefined) {
    return `${html.slice(0, openingBody.index)}<head>${DETERMINISTIC_RENDER_RESET}</head>${html.slice(openingBody.index)}`;
  }
  return `${DETERMINISTIC_RENDER_RESET}${html}`;
}

/** Returns the settled document height, or null when it cannot be measured —
 * the capture is bounded either way. */
async function awaitDeterministicLayout(page: PageLike): Promise<number | null> {
  const height = await page.evaluate(async () => {
    if ("fonts" in document) await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return Math.ceil(Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0));
  });
  return typeof height === "number" && Number.isFinite(height) && height > 0 ? height : null;
}

function hasDocumentHorizontalOverflow(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const geometry = value as Record<string, unknown>;
  const rootScrollWidth = geometry.rootScrollWidth;
  const bodyScrollWidth = geometry.bodyScrollWidth;
  const clientWidth = geometry.clientWidth;
  if (![rootScrollWidth, bodyScrollWidth, clientWidth].every((item) => typeof item === "number" && Number.isFinite(item) && item >= 0)) return false;
  return Math.max(Number(rootScrollWidth), Number(bodyScrollWidth)) > Number(clientWidth) + 1;
}

function hasValidDocumentGeometry(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const geometry = value as Record<string, unknown>;
  const measurements = [geometry.rootScrollWidth, geometry.bodyScrollWidth, geometry.clientWidth];
  return measurements.every((item) => typeof item === "number" && Number.isFinite(item) && item >= 0)
    && Number(geometry.clientWidth) > 0;
}

function overflowGeometrySamplesDisagree(first: unknown, second: unknown): boolean {
  const firstGeometry = first && typeof first === "object" && !Array.isArray(first)
    ? first as Record<string, unknown>
    : {};
  const secondGeometry = second && typeof second === "object" && !Array.isArray(second)
    ? second as Record<string, unknown>
    : {};
  return ["rootScrollWidth", "bodyScrollWidth", "clientWidth"]
    .some((key) => !Object.is(firstGeometry[key], secondGeometry[key]));
}

function readFiniteMeasurement(value: Record<string, unknown>, key: string): number | null {
  const measurement = value[key];
  return typeof measurement === "number" && Number.isFinite(measurement) && measurement >= 0
    ? measurement
    : null;
}

function readVisualDiagnostics(value: unknown): {
  weakTypographyHierarchy: boolean;
  typographyHierarchy: TypographyHierarchyFinding | null;
  squareComponentTreatment: boolean;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { weakTypographyHierarchy: false, typographyHierarchy: null, squareComponentTreatment: false };
  }
  const measurements = value as Record<string, unknown>;
  const h1FontPx = readFiniteMeasurement(measurements, "h1FontPx");
  const h1Count = readFiniteMeasurement(measurements, "h1Count");
  const heroBodyFontPx = readFiniteMeasurement(measurements, "heroBodyFontPx");
  const componentCount = readFiniteMeasurement(measurements, "componentCount");
  const roundedComponentCount = readFiniteMeasurement(measurements, "roundedComponentCount");

  // El orden nombra la causa: el primero que se cumple es el que se reporta.
  // Las dos primeras existen porque un titular ausente, o presente pero sin
  // caja, dejaba `h1FontPx` en nulo — y nulo se reportaba como página sana.
  // Medido: una baseline sin un solo <h1> pasaba el chequeo de jerarquía.
  const rule: TypographyHierarchyFinding["rule"] | null = h1Count === 0
    ? "h1_missing"
    : h1FontPx === null
    ? "h1_not_rendered"
    : h1FontPx < 24
      ? "h1_too_small"
      : heroBodyFontPx !== null && heroBodyFontPx < 12
        ? "hero_body_too_small"
        : heroBodyFontPx !== null && heroBodyFontPx > 0 && h1FontPx / heroBodyFontPx < 1.5
          ? "h1_not_dominant"
          : null;
  const weakTypographyHierarchy = rule !== null;
  const typographyHierarchy = rule === null
    ? null
    : { rule, h1FontPx, h1Count: h1Count ?? 0, heroBodyFontPx };
  const squareComponentTreatment = componentCount !== null
    && roundedComponentCount !== null
    && componentCount >= 3
    && roundedComponentCount / componentCount < 0.25;

  return { weakTypographyHierarchy, typographyHierarchy, squareComponentTreatment };
}

/** Valida lo que devolvió el navegador. Cruza un límite de confianza: lo de
 *  fuera es `unknown` hasta que se comprueba — igual que hacía
 *  `readUnreadableText`, el parser de hallazgos al que sustituye. Lo que se
 *  valida ahora son CANDIDATOS: hechos, no veredictos. */
function leerCandidatos(value: unknown): CandidatoDeContraste[] {
  if (!Array.isArray(value)) return [];
  const salida: CandidatoDeContraste[] = [];
  for (const fila of value) {
    if (!fila || typeof fila !== "object") continue;
    const r = fila as Record<string, unknown>;
    if (typeof r.color !== "string" || typeof r.etiqueta !== "string") continue;
    if (!Array.isArray(r.puntos)) continue;
    const puntos: (readonly [number, number])[] = [];
    for (const punto of r.puntos) {
      if (!Array.isArray(punto) || punto.length < 2) continue;
      const [x, y] = punto;
      if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) continue;
      puntos.push([x, y]);
    }
    if (puntos.length === 0) continue;
    const velos: number[][] = [];
    if (Array.isArray(r.velos)) {
      for (const velo of r.velos) {
        if (Array.isArray(velo) && velo.length >= 4 && velo.every((n) => typeof n === "number" && Number.isFinite(n))) {
          velos.push([velo[0], velo[1], velo[2], velo[3]]);
        }
      }
    }
    salida.push({
      texto: typeof r.texto === "string" ? r.texto : "",
      etiqueta: r.etiqueta,
      color: r.color,
      probe: typeof r.probe === "number" && Number.isInteger(r.probe) ? r.probe : -1,
      puntos,
      fondoCss: typeof r.fondoCss === "string" ? r.fondoCss : null,
      velos,
    });
  }
  return salida;
}

async function defaultLaunchBrowser(): Promise<BrowserLike> {
  const puppeteer = (await import("puppeteer")).default;
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH?.trim() || undefined;
  return puppeteer.launch({
    headless: true,
    executablePath,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    env: { ...process.env, HOME: "/tmp" },
  }) as unknown as BrowserLike;
}

/**
 * EL CONTRASTE SE MIDE EN EL PÍXEL, NO SE PREDICE DESDE EL CSS.
 *
 * Chromium YA compuso la página: fotos, degradados, hermanos, velos,
 * `mix-blend-mode`, `filter`, `backdrop-filter`, pseudo-elementos y cadenas de
 * `opacity`. Deducir ese resultado leyendo CSS ha necesitado CINCO arreglos con
 * la misma causa entre el 19/08 y el 02/09, y el 02/09 seguía fallando en los
 * cinco caminos de arriba —cuatro callándose ante texto invisible, tres
 * inventando hallazgos sobre texto legible—. Así que en vez de deducirlo: se
 * apaga el texto, se hace una foto y se lee lo que hay debajo.
 *
 * Coste medido el 2026-09-02: 124 ms en una página de 1.560 px y 230 ms en el
 * tope de 4.096. El techo del encargo era ~1 s.
 *
 * NUNCA puede costar el informe. Cualquier fallo aquí deja `pixeles` en null y
 * `juzgarContraste` cae, candidato a candidato, a los dos paseos por CSS de
 * siempre — que por eso viajan dentro de cada candidato como `fondoCss`.
 */
async function medirContrastePorPixel(
  page: PageLike,
  viewport: { width: number; height: number },
  documentHeight: number | null,
): Promise<UnreadableTextFinding[]> {
  let candidatos: CandidatoDeContraste[] = [];
  let pixeles: PngCrudo | null = null;
  let recogido = false;
  try {
    // ⚠️ Función ANÓNIMA en línea, como `readGeometry` justo arriba: es el
    // patrón probado de este fichero. Lo que NO puede haber aquí dentro es una
    // función CON NOMBRE — el empaquetador le pone `__name(...)`, ese ayudante
    // no existe en la página y la evaluación entera revienta.
    candidatos = leerCandidatos(await page.evaluate(() => {
      const RGB_RE = /^rgba?\(([^)]+)\)/i;
      const SEPARATOR_RE = /[\s,/]+/;
      const TEXT_TAGS = "h1,h2,h3,h4,h5,h6,p,a,span,li,button,strong,em,label,td,th,dt,dd,blockquote,figcaption,div";
      const salida: {
        texto: string;
        etiqueta: string;
        color: string;
        probe: number;
        puntos: [number, number][];
        fondoCss: string | null;
        velos: number[][];
      }[] = [];
      const body = document.body;
      for (const node of body ? body.querySelectorAll(TEXT_TAGS) : []) {
        // Tope de cordura: el muestreo es gratis (0,2 ms por 72 puntos) pero
        // esto cruza CDP, y una página patológica no puede hincharlo sin fin.
        if (salida.length >= 1500) break;
        if (!(node instanceof HTMLElement)) continue;
        // Sólo elementos que llevan texto PROPIO: el padre de un texto anidado
        // hereda un color que no es el que se pinta.
        let owns = false;
        for (const child of node.childNodes) {
          if (child.nodeType === 3 && (child.textContent ?? "").trim().length > 1) { owns = true; break; }
        }
        if (!owns) continue;
        const rect = node.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        const style = window.getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden") continue;
        if ((Number.parseFloat(style.opacity) || 0) < 0.5) continue;
        if ((Number.parseFloat(style.fontSize) || 0) < 6) continue;

        // ── NUEVE PUNTOS, EN COORDENADAS DE DOCUMENTO ────────────────────
        //
        // La captura de sondeo lleva `captureBeyondViewport`, así que sus
        // coordenadas son las del DOCUMENTO, no las del viewport.
        // `rect + scrollX/Y` da exactamente eso.
        //
        // 🔴 SE CALCULAN AQUÍ, ANTES DE LOS PASEOS, y no es cosmético: el paseo
        // por hermanos scrollea para que `elementsFromPoint` responda. Leyendo
        // `rect` y el scroll en el mismo instante, el resultado no depende de
        // dónde esté la página.
        //
        // Nueve y no uno porque un fondo puede tener variación —una foto, un
        // degradado—: con nueve lecturas gana la MÁS FAVORABLE, que es la
        // doctrina de los dos extremos del velo llevada al píxel. Si en algún
        // punto se lee, no podemos afirmar que sea invisible.
        const puntos: [number, number][] = [];
        for (const fx of [0.2, 0.5, 0.8]) {
          for (const fy of [0.25, 0.5, 0.75]) {
            puntos.push([
              Math.round(rect.left + window.scrollX + rect.width * fx),
              Math.round(rect.top + window.scrollY + rect.height * fy),
            ]);
          }
        }

        // ── EL RESPALDO ───────────────────────────────────────────────────
        //
        // Los dos paseos de aquí abajo DEJARON DE SER el camino principal el
        // 2026-09-02: ahora manda el píxel, y esto es lo que se usa cuando el
        // muestreo no puede determinar el fondo —la captura falló, o el texto
        // cae por debajo del tope de 4.096 px—. Fallar hacia lo de antes es la
        // propiedad que hace seguro el cambio.
        //
        // NO se borran y NO se simplifican: cada regla está medida caso por
        // caso (19/08, 23/08, 02/09) y sigue siendo la mejor respuesta
        // disponible cuando no hay píxel. Sus comentarios son la única memoria
        // de por qué existe cada una.
            // El primer fondo OPACO hacia arriba es el que de verdad lo pinta.
            // Una imagen o un velo translúcido en el camino significa que no
            // sabemos qué hay debajo, y una duda jamás debe convertirse en un
            // hallazgo. Nada opaco hasta la raíz es el lienzo blanco.
            let backgroundText = "rgb(255, 255, 255)";
            let uncertain = false;
            const veils: number[][] = [];
            for (let ancestor: HTMLElement | null = node; ancestor; ancestor = ancestor.parentElement) {
              const ancestorStyle = window.getComputedStyle(ancestor);
              // Una foto tapa lo que sea y no se puede juzgar desde el CSS. Un
              // degradado decorativo casi transparente NO tapa nada, y tratarlo
              // como incierto silenciaba el hero entero: medido aquí, un patrón
              // de puntos a 0.05 de alfa escondía un titular a 1.1:1.
              const ancestorImage = ancestorStyle.backgroundImage;
              if (ancestorImage && ancestorImage !== "none") {
                if (ancestorImage.indexOf("url(") !== -1) { uncertain = true; break; }
                let strongestStop = 0;
                let veilR = 0;
                let veilG = 0;
                let veilB = 0;
                for (const stop of ancestorImage.match(/rgba?\([^)]*\)/g) ?? []) {
                  const parts = (RGB_RE.exec(stop) ?? ["", ""])[1]
                    .split(SEPARATOR_RE).filter((piece) => piece.length > 0).map(Number);
                  const stopAlpha = parts.length > 3 && Number.isFinite(parts[3]) ? parts[3] : 1;
                  const readable = parts.length >= 3 && Number.isFinite(parts[0]) && Number.isFinite(parts[1]) && Number.isFinite(parts[2]);
                  if (stopAlpha > strongestStop && readable) {
                    strongestStop = stopAlpha;
                    veilR = parts[0];
                    veilG = parts[1];
                    veilB = parts[2];
                  }
                }
                // Sin paradas legibles (colores con nombre, `currentColor`) no
                // se puede afirmar que sea inocuo.
                if (strongestStop === 0) { uncertain = true; break; }
                // Un velo translúcido ya NO obliga a rendirse: se guarda y el
                // texto se mide contra los dos extremos. Medido el 2026-08-19:
                // un titular crema sobre crema a 1.04:1 se escapaba porque el
                // hero llevaba un degradado a 0.28 y el umbral de 0.15 lo
                // declaraba incierto. Rendirse ante la duda dejaba pasar lo
                // invisible.
                if (strongestStop > 0.15) veils.push([veilR, veilG, veilB, strongestStop]);
              }
              const painted = (RGB_RE.exec(ancestorStyle.backgroundColor) ?? ["", ""])[1]
                .split(SEPARATOR_RE).filter((piece) => piece.length > 0).map(Number);
              if (painted.length < 3) continue;
              const alpha = painted.length > 3 && Number.isFinite(painted[3]) ? painted[3] : 1;
              if (alpha <= 0.02) continue;
              if (alpha < 0.95) { uncertain = true; break; }
              backgroundText = ancestorStyle.backgroundColor;
              break;
            }

        // Sólo si los ancestros NO dudaron. Antes esto era un `continue` que
        // descartaba el elemento entero; ahora el elemento SIGUE siendo
        // candidato —el píxel puede medirlo aunque el CSS no supiera— y la duda
        // viaja como `fondoCss: null`.
        if (!uncertain) {
              // ── LO QUE HAY DEBAJO Y NO ES ANCESTRO ──────────────────────────
              //
              // 🔴 EL PUNTO CIEGO, medido en una página real el 2026-08-23: el
              // reloj de un pomodoro salía gris ilegible sobre un disco NEGRO y
              // esto reportaba contraste PERFECTO (#1f1e1b sobre #ffffff). Lo que
              // tapaba el texto no era un ancestro: era un `<svg>` HERMANO,
              // posicionado en absoluto y pintado detrás. El paseo de arriba no
              // puede verlo por construcción.
              //
              // Se pregunta al navegador QUÉ HAY de verdad bajo ese píxel
              // (`elementsFromPoint` devuelve la pila, de arriba abajo) y se
              // busca el primer elemento que PINTE algo opaco y que NO sea
              // ancestro del texto. Si existe, manda: está más cerca del píxel.
              //
              // Aditivo a propósito: la lógica de velos de arriba está medida
              // caso por caso y no se toca. Esto sólo corrige el fondo cuando hay
              // un pintor intermedio que aquélla no podía ver.
              //
              // En SVG el color de relleno es `fill`, no `backgroundColor` — y es
              // justo el caso que motivó esto: un `<circle>` sin `fill` se pinta
              // NEGRO por defecto.
              // 🔴 HAY QUE LLEVARLO A LA VENTANA PRIMERO. `elementsFromPoint`
              // sólo responde dentro del viewport, y el resto de esta medición es
              // independiente de él (lee CSS, no píxeles). Medido: el reloj del
              // pomodoro cae en y=1657 con una ventana de 900, así que la pila
              // volvía VACÍA — o sea que sin esto la comprobación no corría bajo
              // la línea de flotación, que es casi toda la página.
              const scrollPrevioX = window.scrollX;
              const scrollPrevioY = window.scrollY;
              node.scrollIntoView({ block: "center", inline: "center" });
              const rects = node.getClientRects();
              const rect0 = rects.length > 0 ? rects[0] : node.getBoundingClientRect();
              const px = rect0.left + rect0.width / 2;
              const py = rect0.top + rect0.height / 2;
              if (px >= 0 && py >= 0 && px <= window.innerWidth && py <= window.innerHeight) {
                const pila = document.elementsFromPoint(px, py);
                // LA REGLA: desde el texto hacia abajo, GANA EL PRIMER OPACO —
                // sea ancestro o no. Es la misma semántica del paseo de arriba
                // (que también empieza en el propio nodo), sólo que la pila
                // incluye además a los hermanos pintados detrás, que es lo que
                // aquél no puede ver.
                //
                // 🔴 Y por qué NO se saltan los ancestros, que fue mi primer
                // intento y era un generador de falsos positivos: el botón
                // «empezar ahora» lleva texto casi blanco sobre su propio fondo
                // acento. Saltando ancestros, el paseo se iba hasta el `<body>`
                // y medía blanco sobre crema — 1.03:1, un hallazgo INVENTADO.
                //
                // Lo que sí se salta es todo lo que está por ENCIMA del texto: si
                // algo opaco lo tapa, eso es OCLUSIÓN, otro defecto, y juzgarlo
                // aquí sería medir una cosa por otra. Cuando el texto ni siquiera
                // sale en la pila —lo cubre una cabecera fija— no se anula nada y
                // manda el paseo por ancestros: fallar hacia lo de antes es la
                // propiedad que hace esto seguro de añadir.
                let empezar = false;
                for (const capa of pila) {
                  if (!empezar) {
                    if (capa === node || capa.contains(node)) empezar = true;
                    else continue;
                  }
                  const cs = window.getComputedStyle(capa);
                  if (cs.visibility === "hidden" || (Number.parseFloat(cs.opacity) || 0) < 0.95) continue;
                  const tag = (capa.tagName || "").toLowerCase();
                  // UN PINTOR QUE EL CSS NO SABE LEER.
                  //
                  // 🔴 MEDIDO el 2026-09-02 en la portada de una inmobiliaria: un
                  // <img> pinta píxeles que `getComputedStyle` desconoce, igual
                  // que un `background-image: url(...)`, pero su
                  // `backgroundColor` es TRANSPARENTE — así que esto lo saltaba y
                  // seguía cayendo hasta el blanco del <body>. El titular blanco
                  // salía «#ffffff sobre #ffffff a 1.00:1», un hallazgo inventado
                  // que costó 17 ediciones y dejó la portada peor que antes.
                  //
                  // El paseo por ANCESTROS ya se rinde ante una foto. Éste no
                  // había heredado esa regla. `<svg>` NO entra en la lista: las
                  // formas de abajo (`esForma`) las juzga bien por `fill`, y
                  // rendirse aquí cegaría el caso del `<circle fill="none">` que
                  // tiene su propio brazo de control.
                  if (tag === "img" || tag === "video" || tag === "canvas") { uncertain = true; break; }
                  // Una foto no se puede juzgar desde el CSS: se abandona, igual
                  // que arriba. La duda nunca se convierte en un hallazgo.
                  if (cs.backgroundImage && cs.backgroundImage.indexOf("url(") !== -1) { uncertain = true; break; }
                  // UN VELO HERMANO ES UN VELO — la otra mitad del mismo defecto.
                  // El div del degradado del hero también tiene `backgroundColor`
                  // transparente, así que esto lo trataba como si no pintara nada.
                  //
                  // 🔴 Y NO se marca `uncertain`: eso reintroduciría aquí el
                  // defecto que el paseo por ancestros ya midió y descartó el
                  // 2026-08-19 —un patrón de puntos a 0.05 de alfa escondiendo un
                  // titular a 1.1:1—. Se compone contra los dos extremos, como
                  // allí. Tampoco se corta el paseo: si además hay un color
                  // opaco debajo en esta misma capa, manda él, igual que arriba.
                  //
                  // ⚠️ La lógica de paradas está DUPLICADA a propósito. Esto vive
                  // dentro de `page.evaluate` y una función nombrada arrastraría
                  // el helper `__name` de esbuild, que en la página no existe.
                  if (cs.backgroundImage && cs.backgroundImage !== "none") {
                    let strongestStop = 0;
                    let veilR = 0;
                    let veilG = 0;
                    let veilB = 0;
                    for (const stop of cs.backgroundImage.match(/rgba?\([^)]*\)/g) ?? []) {
                      const parts = (RGB_RE.exec(stop) ?? ["", ""])[1]
                        .split(SEPARATOR_RE).filter((piece) => piece.length > 0).map(Number);
                      const stopAlpha = parts.length > 3 && Number.isFinite(parts[3]) ? parts[3] : 1;
                      const readable = parts.length >= 3 && Number.isFinite(parts[0]) && Number.isFinite(parts[1]) && Number.isFinite(parts[2]);
                      if (stopAlpha > strongestStop && readable) {
                        strongestStop = stopAlpha;
                        veilR = parts[0];
                        veilG = parts[1];
                        veilB = parts[2];
                      }
                    }
                    // Sin paradas legibles (colores con nombre, `currentColor`)
                    // no se puede afirmar que sea inocuo. Misma regla que arriba.
                    if (strongestStop === 0) { uncertain = true; break; }
                    if (strongestStop > 0.15) veils.push([veilR, veilG, veilB, strongestStop]);
                  }
                  // SVG: `fill` es su color de superficie — pero SÓLO en las
                  // formas que de verdad rellenan.
                  //
                  // 🔴 `fill` es una propiedad HEREDADA cuyo valor inicial es
                  // NEGRO, así que `getComputedStyle` devuelve negro en CUALQUIER
                  // nodo SVG: el `<svg>` contenedor, un `<g>`, un `<defs>`. Sin
                  // esta lista, un `<circle fill="none">` correcto seguía dando
                  // "fondo negro" porque el `<svg>` de encima ya lo decía — un
                  // hallazgo inventado, cazado por el brazo de control de su
                  // prueba.
                  //
                  // `tag` se calcula ARRIBA: lo necesita también la comprobación
                  // del pintor no legible, que corre antes.
                  // ⚠️ Y esto SÓLO hace falta aquí, en el respaldo. El paseo por
                  // píxeles no necesita saber qué es `fill`: lee lo que
                  // Chromium pintó, y el disco negro le sale `#000000` sin
                  // ayuda ninguna. Medido el 2026-09-02.
                  const esForma = tag === "circle" || tag === "ellipse" || tag === "rect" || tag === "path" || tag === "polygon";
                  const bruto = esForma && cs.fill && cs.fill !== "none" ? cs.fill : cs.backgroundColor;
                  const canales = (RGB_RE.exec(bruto ?? "") ?? ["", ""])[1]
                    .split(SEPARATOR_RE).filter((piece) => piece.length > 0).map(Number);
                  if (canales.length < 3) continue;
                  const a = canales.length > 3 && Number.isFinite(canales[3]) ? canales[3] : 1;
                  const aFill = esForma ? Number.parseFloat(cs.fillOpacity || "1") : 1;
                  if (a * (Number.isFinite(aFill) ? aFill : 1) < 0.95) continue;
                  backgroundText = `rgb(${canales[0]}, ${canales[1]}, ${canales[2]})`;
                  break;
                }
              }
              // Se devuelve el scroll donde estaba: la captura se toma después y
              // una página medida a media altura saldría distinta de la que el
              // usuario recibe.
              window.scrollTo(scrollPrevioX, scrollPrevioY);
        }

        let texto = "";
        for (const hijo of Array.from(node.childNodes)) {
          if (hijo.nodeType === 3) texto += hijo.textContent || "";
        }
        const raw = node.getAttribute("data-ol-probe");
        const probeValue = raw === null ? -1 : Number(raw);
        node.setAttribute("data-ol-sonda", "1");
        salida.push({
          texto: texto.replace(/\s+/g, " ").trim().slice(0, 60),
          etiqueta: (node.tagName || "").toLowerCase(),
          color: style.color,
          probe: Number.isInteger(probeValue) && probeValue >= 0 ? probeValue : -1,
          puntos,
          fondoCss: uncertain ? null : backgroundText,
          velos: veils,
        });
      }

      // APAGAR EL TEXTO SIN MOVER NADA. `color: transparent` no reflowea;
      // `visibility` y `display` sí, y moverían el layout bajo nuestros propios
      // pies —los puntos ya están anotados—. VERIFICADO el 2026-09-02 sobre
      // doce documentos: `scrollHeight` no se movió en ninguno.
      const hoja = document.createElement("style");
      hoja.id = "ol-sonda-contraste";
      hoja.textContent = "[data-ol-sonda]{color:transparent!important;text-shadow:none!important;-webkit-text-fill-color:transparent!important}";
      document.head.appendChild(hoja);
      // El scroll a cero antes de la captura: los paseos de arriba scrollean, y
      // una captura tomada a media altura leería cada píxel de otro sitio.
      window.scrollTo(0, 0);
      return salida;
    }));
    recogido = true;
    if (candidatos.length > 0) {
      const sondeo = Buffer.from(await page.screenshot({
        // PNG y sin `quality`: hay que leer píxeles EXACTOS, y JPEG destroza
        // justo lo que venimos a medir. (puppeteer además lanza si se le manda
        // calidad con PNG.)
        type: "png",
        captureBeyondViewport: true,
        clip: { x: 0, y: 0, width: viewport.width, height: Math.min(documentHeight ?? MAX_CAPTURE_HEIGHT, MAX_CAPTURE_HEIGHT) },
      }));
      pixeles = decodificarPng(sondeo);
    }
  } catch (error) {
    pixeles = null;
    // ── DOS FALLOS DISTINTOS, Y SÓLO UNO ES BENIGNO ──────────────────────
    //
    // 🔴 Si lo que revienta es la RECOGIDA, no hay respaldo posible: los dos
    // paseos por CSS viven DENTRO de ese mismo programa, así que se van con
    // él. El informe saldría diciendo «ningún texto ilegible», que es
    // indistinguible de una página sana — y antes de medir por píxeles ese
    // fallo era RUIDOSO (subía hasta el catch de `captureWithBrowser` y salía
    // por consola). Convertirlo en una mentira muda es justo lo que la
    // doctrina de degradación de este repo prohíbe, así que se dice.
    //
    // No se relanza a propósito: eso costaría TAMBIÉN el desborde móvil, la
    // jerarquía y los errores de JavaScript, que son medidas independientes y
    // están perfectamente bien. Se degrada una medida, no el informe.
    const detalle = error instanceof Error ? error.message : String(error);
    console.warn(
      recogido
        // Aquí SÍ hay respaldo —cada candidato lleva su `fondoCss`—, así que el
        // informe sigue siendo válido. Pero si esto pasara siempre, el paseo
        // por píxeles estaría muerto y nadie se enteraría.
        ? `[visual-quality] el sondeo por píxeles falló; el contraste se mide por CSS (respaldo): ${detalle}`
        : `[visual-quality] la recogida de contraste falló: este informe sale SIN hallazgos de contraste, y eso NO significa que la página esté sana: ${detalle}`,
    );
    if (process.env.OPENLEN_RENDER_DEBUG === "1") console.error(error);
  } finally {
    // RESTAURAR SIEMPRE, pase lo que pase. Si la hoja que apaga el texto
    // sobreviviera, la captura que se le ENTREGA AL MODELO saldría en blanco y
    // le pediríamos que arreglase una página que no existe. Cuesta ~1 ms y
    // quita una clase entera de fallo catastrófico.
    try {
      await page.evaluate(() => {
        const hoja = document.getElementById("ol-sonda-contraste");
        if (hoja) hoja.remove();
        for (const nodo of document.querySelectorAll("[data-ol-sonda]")) nodo.removeAttribute("data-ol-sonda");
        return true;
      });
    } catch { /* la página ya no responde; no hay nada que salvar */ }
  }
  return juzgarContraste(candidatos, pixeles);
}

async function captureWithPage(
  page: PageLike,
  html: string,
  internals: VisualQualityRendererInternals,
  opts: VisualQualityRenderOptions = {},
): Promise<VisualQualityViewports | null> {
  // Antes de `setContent`, o los errores del arranque se pierden.
  const gritos: string[] = [];
  const bloqueadas: string[] = [];
  buzonBloqueadas = bloqueadas;
  page.on?.("pageerror", (e) => {
    gritos.push(String(e instanceof Error ? e.message : e).slice(0, 300));
  });
  page.on?.("console", (m) => {
    const mensaje = m as { type?: () => string; text?: () => string };
    if (typeof mensaje.type !== "function" || mensaje.type() !== "error") return;
    const texto = String(mensaje.text?.() ?? "");
    // UN RECURSO QUE NO CARGA NO ES «EL JAVASCRIPT FALLA».
    //
    // Estos gritos se le entregan al modelo bajo esa frase literal, así que
    // meter aquí un fallo de red es mandarle a revisar el código que sí
    // funciona — y encima cuenta como rotura, que es lo que dispara reescribir
    // la página entera. Es un hecho distinto y hoy no lo medimos; decir que es
    // JavaScript sería mentir sobre lo que sabemos.
    if (/^Failed to load resource/i.test(texto)) return;
    gritos.push(`consola: ${texto.slice(0, 300)}`);
  });

  await page.setViewport(VISUAL_QUALITY_DESKTOP_VIEWPORT);
  await cargarEnOrigenReal(page, injectDeterministicRenderReset(html));

  const images: InlineImage[] = [];
  let mobileOverflow = false;
  let weakTypographyHierarchy = false;
  let typographyHierarchy: TypographyHierarchyFinding | null = null;
  let squareComponentTreatment = false;
  let invalidGeometry = false;
  let unreadableText: UnreadableTextFinding[] = [];
  let overflowCulprit = "";
  let overflowCulpritRight = 0;
  for (const viewport of [VISUAL_QUALITY_DESKTOP_VIEWPORT, VISUAL_QUALITY_MOBILE_VIEWPORT]) {
    if (viewport !== VISUAL_QUALITY_DESKTOP_VIEWPORT) await page.setViewport(viewport);
    const documentHeight = await awaitDeterministicLayout(page);
    await (internals.settle ?? (() => new Promise((resolve) => setTimeout(resolve, 400))))();
    if (viewport === VISUAL_QUALITY_MOBILE_VIEWPORT) {
      const readGeometry = () => page.evaluate(() => {
          const root = document.documentElement;
          const body = document.body;
          const h1All = document.querySelectorAll("h1");
          const h1Count = h1All.length;
          const h1 = h1All[0] ?? null;
          let h1FontPx: number | null = null;
          if (h1 instanceof HTMLElement) {
            const style = window.getComputedStyle(h1);
            const rect = h1.getBoundingClientRect();
            const value = Number.parseFloat(style.fontSize);
            if (rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && Number.isFinite(value) && value >= 0) {
              h1FontPx = value;
            }
          }
          // El primer <p> del documento suele ser el kicker o el eyebrow -- una
          // etiqueta corta que DEBE ser chica, y que la propia guía de diseño
          // pide escribir. Medirla como si fuera el cuerpo reprobaba páginas
          // sanas. El cuerpo es el párrafo con más texto de los primeros.
          let heroBodyFontPx: number | null = null;
          let longestParagraphChars = 0;
          const candidates = document.querySelectorAll("[data-openlen-role='hero'] p, main p, body p");
          for (let index = 0; index < candidates.length && index < 8; index += 1) {
            const paragraph = candidates[index];
            if (!(paragraph instanceof HTMLElement)) continue;
            const style = window.getComputedStyle(paragraph);
            const rect = paragraph.getBoundingClientRect();
            const value = Number.parseFloat(style.fontSize);
            if (rect.width <= 0 || rect.height <= 0 || style.display === "none" || style.visibility === "hidden") continue;
            if (!Number.isFinite(value) || value < 0) continue;
            const chars = (paragraph.textContent ?? "").trim().length;
            if (chars <= longestParagraphChars) continue;
            longestParagraphChars = chars;
            heroBodyFontPx = value;
          }
          let componentCount = 0;
          let roundedComponentCount = 0;
          for (const component of document.querySelectorAll("button,[role='button'],article")) {
            if (!(component instanceof HTMLElement)) continue;
            const style = window.getComputedStyle(component);
            const rect = component.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0 || style.display === "none" || style.visibility === "hidden") continue;
            componentCount += 1;
            if (Math.max(
              Number.parseFloat(style.borderTopLeftRadius) || 0,
              Number.parseFloat(style.borderTopRightRadius) || 0,
              Number.parseFloat(style.borderBottomRightRadius) || 0,
              Number.parseFloat(style.borderBottomLeftRadius) || 0,
            ) >= 8) roundedComponentCount += 1;
          }

          // QUIÉN se sale. Decir «la página se desborda» es una categoría, y
          // este repo ya midió lo que pasa con las categorías: al reparador se
          // le mandaba la palabra "typography" y no tocaba nada, porque una
          // categoría no dice QUÉ cambiar. Aquí igual — MEDIDO el 2026-08-22:
          // con el aviso genérico el modelo arreglaba el desborde 1 de 3 veces.
          //
          // Se busca el elemento MÁS PROFUNDO que se sale: un ancestro se
          // desborda porque su hijo lo hace, y nombrar al ancestro manda a
          // mirar donde no está la causa.
          const ancho = Math.max(window.innerWidth, root.clientWidth);
          let culpable = "";
          let culpableAncho = 0;
          let culpableProfundidad = -1;
          for (const nodo of body ? body.querySelectorAll("*") : []) {
            if (!(nodo instanceof HTMLElement)) continue;
            const r = nodo.getBoundingClientRect();
            if (r.width <= 0 || r.right <= ancho + 1) continue;
            const st = window.getComputedStyle(nodo);
            if (st.display === "none" || st.visibility === "hidden") continue;
            // Un contenedor que YA scrollea por dentro no es el problema: es la
            // solución correcta para una tabla ancha.
            if (st.overflowX === "auto" || st.overflowX === "scroll") continue;
            let prof = 0;
            for (let a: HTMLElement | null = nodo; a; a = a.parentElement) prof += 1;
            if (prof > culpableProfundidad) {
              culpableProfundidad = prof;
              culpableAncho = Math.round(r.right);
              const id = nodo.id ? `#${nodo.id}` : "";
              const cls = nodo.className && typeof nodo.className === "string"
                ? `.${nodo.className.trim().split(/\s+/).slice(0, 2).join(".")}`
                : "";
              culpable = `${nodo.tagName.toLowerCase()}${id}${cls}`;
            }
          }

          return {
            rootScrollWidth: root.scrollWidth,
            bodyScrollWidth: body?.scrollWidth ?? 0,
            clientWidth: Math.max(window.innerWidth, root.clientWidth),
            overflowCulprit: culpable,
            overflowCulpritRight: culpableAncho,
            h1FontPx,
            h1Count,
            heroBodyFontPx,
            componentCount,
            roundedComponentCount,
          };
      });
      const firstGeometry = await readGeometry();
      const secondGeometry = await readGeometry();
      invalidGeometry = !hasValidDocumentGeometry(firstGeometry) || !hasValidDocumentGeometry(secondGeometry);
      mobileOverflow = overflowGeometrySamplesDisagree(firstGeometry, secondGeometry)
        || hasDocumentHorizontalOverflow(firstGeometry)
        || hasDocumentHorizontalOverflow(secondGeometry);
      ({ weakTypographyHierarchy, typographyHierarchy, squareComponentTreatment } = readVisualDiagnostics(firstGeometry));
      unreadableText = await medirContrastePorPixel(page, viewport, documentHeight);
      const g = firstGeometry as Record<string, unknown> | null;
      overflowCulprit = typeof g?.overflowCulprit === "string" ? g.overflowCulprit : "";
      overflowCulpritRight = typeof g?.overflowCulpritRight === "number" ? g.overflowCulpritRight : 0;
    }
    const bytes = Buffer.from(await page.screenshot({
      type: "jpeg",
      quality: 75,
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: viewport.width, height: Math.min(documentHeight ?? MAX_CAPTURE_HEIGHT, MAX_CAPTURE_HEIGHT) },
    }));
    const image = { mimeType: "image/jpeg", dataBase64: bytes.toString("base64") };
    if (!isBoundedJpeg(image)) return null;
    images.push(image);
  }

  // ── APRETAR LOS BOTONES ────────────────────────────────────────────────
  //
  // DESPUÉS de las dos capturas, nunca antes: un clic puede mover el DOM y las
  // fotos tienen que enseñar la página tal como se recibe.
  //
  // Esto es lo que separaba crear de editar. Los ojos del Agente pulsan desde
  // el 2026-08-22; una página recién creada nunca veía un clic — nacía, se
  // fotografiaba y se entregaba. El modo de fallo que sólo se ve así: un
  // manejador que revienta en la SEGUNDA jugada carga limpio, sale perfecto en
  // la captura y no dice una palabra en consola.
  //
  // Los errores caen solos en `gritos`: los escuchas de `pageerror` y `console`
  // llevan puestos desde el principio de esta función. Nunca puede costar la
  // medición — un fallo aquí deja el resto del informe intacto.
  //
  // Y si el modelo DECLARÓ qué debe pasar, se comprueba ESO en vez de pulsar a
  // ciegas. Es la misma elección que hacen los ojos del Agente
  // (`lib/agent/verify.ts`): con guion se prueba la promesa, sin guion se pulsa
  // todo. Aquí ocupa el mismo hueco, en el mismo navegador y tras las mismas
  // capturas — cero arranques nuevos.
  let behaviorResult: unknown;
  try {
    if (opts.behaviorProgram) {
      behaviorResult = await page.evaluate(opts.behaviorProgram);
    } else {
      await page.evaluate(PULSAR_CONTROLES);
    }
    // Un manejador puede programar trabajo (un `setTimeout`, una animación) que
    // revienta después del clic. Sin esta espera, el error llega tarde y se
    // pierde al cerrar la página.
    await (internals.settle ?? (() => new Promise((resolve) => setTimeout(resolve, 400))))();
  } catch {
    /* pulsar es diagnóstico, no puerta */
  }

  return {
    desktop: images[0]!,
    mobile: images[1]!,
    mobileOverflow,
    weakTypographyHierarchy,
    typographyHierarchy,
    squareComponentTreatment,
    invalidGeometry,
    unreadableText,
    ...(overflowCulprit ? { overflowCulprit, overflowCulpritRight } : {}),
    // Ausente —no vacío— cuando la página no gritó: así el resto del objeto
    // queda idéntico al de antes de que esto existiera.
    ...(gritos.length > 0 ? { runtimeErrors: [...new Set(gritos)] } : {}),
    // Lo que NOSOTROS cortamos. Ausente cuando no se cortó nada, como los
    // gritos: un render limpio tiene que leerse igual que antes de que esto
    // existiera.
    ...(bloqueadas.length > 0 ? { blockedSubresources: [...new Set(bloqueadas)] } : {}),
    ...(behaviorResult !== undefined ? { behaviorResult } : {}),
  };
}

async function createBrowserWorker(internals: VisualQualityRendererInternals) {
  const browser = await (internals.launchBrowser ?? defaultLaunchBrowser)();
  try {
    const page = await browser.newPage();
    // El guardia fija su lista de orígenes AL INSTALARSE y esta página se
    // reutiliza en todos los renders del pool, así que el origen de medida
    // tiene que ser el mismo durante todo el proceso — por eso es un servidor
    // del proceso y no uno por render. Ver origen-de-medida.ts.
    const { origin } = await origenDeMedida();
    const guard = internals.installGuard ?? ((candidate: PageLike, allowOrigin: string) =>
      installSubresourceSsrfGuard(
        candidate as Parameters<typeof installSubresourceSsrfGuard>[0],
        {
          allowOrigins: [allowOrigin],
          // Lo que el guardia corta deja un hueco en la captura, y un hueco lo
          // lee el modelo con visión como «imagen rota». Que el juicio sepa
          // cuáles fueron cosa NUESTRA.
          onBlocked: (url) => {
            if (buzonBloqueadas && buzonBloqueadas.length < 40) buzonBloqueadas.push(url);
          },
        },
      ));
    await guard(page, origin);
    return { browser, page };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

async function captureWithBrowser(
  html: string,
  internals: VisualQualityRendererInternals,
  opts: VisualQualityRenderOptions = {},
): Promise<VisualQualityViewports | null> {
  const worker = await createBrowserWorker(internals);
  try {
    return await captureWithPage(worker.page, html, internals, opts);
  } finally {
    await worker.browser.close();
  }
}

/**
 * DÓNDE CAEN LAS URLS QUE EL GUARDIA SSRF BLOQUEA.
 *
 * El guardia se instala UNA vez por página, y la página se reutiliza en todos
 * los renders del pool — así que no puede escribir en «el resultado de este
 * render» porque cuando se instala ese resultado no existe. Cada render se
 * apunta aquí antes de cargar y se borra al terminar.
 *
 * De un proceso a otro no hay solape: el pool corre un render por página a la
 * vez, y `medirEnPagina` es quien pone y quita el buzón.
 */
let buzonBloqueadas: string[] | null = null;

export interface VisualQualityRendererPool {
  render(html: string): Promise<VisualQualityViewports | null>;
  close(): Promise<void>;
}

export interface VisualCandidateContactSheetFragment {
  candidateId: string;
  ordinal: number;
  role: string;
  html: string;
}

function escapeContactSheetLabel(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#39;");
}

function escapeContactSheetSrcdoc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#39;");
}

function contactSheetHtml(fragments: readonly VisualCandidateContactSheetFragment[]): string {
  const cells = fragments.map((fragment) => `<figure class="openlen-candidate">
    <figcaption>${fragment.ordinal} · ${escapeContactSheetLabel(fragment.role)} · ${escapeContactSheetLabel(fragment.candidateId)}</figcaption>
    <iframe sandbox="" title="Candidate ${fragment.ordinal}" srcdoc="${escapeContactSheetSrcdoc(fragment.html)}"></iframe>
  </figure>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;width:1280px;height:720px;overflow:hidden;background:#111;color:#fff;font-family:Arial,sans-serif}
    .openlen-contact-sheet{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));grid-auto-rows:234px;gap:8px;padding:8px;box-sizing:border-box}
    .openlen-candidate{position:relative;margin:0;overflow:hidden;border:1px solid #555;background:#fff;color:#111}
    .openlen-candidate figcaption{position:absolute;z-index:2147483647;top:0;left:0;right:0;padding:5px 7px;background:rgba(0,0,0,.86);color:#fff;font:700 11px/1.2 Arial,sans-serif}
    .openlen-candidate iframe{position:absolute;inset:25px 0 0;width:100%;height:calc(100% - 25px);border:0;background:#fff}
  </style></head><body><main class="openlen-contact-sheet">${cells}</main></body></html>`;
}

/** Uses the calibrated renderer pool so browser reuse and deterministic settling stay unchanged. */
export async function renderVisualCandidateContactSheet(
  fragments: readonly VisualCandidateContactSheetFragment[],
  pool: VisualQualityRendererPool,
): Promise<InlineImage | null> {
  if (fragments.length > 12) return null;
  const ids = fragments.map((fragment) => fragment.candidateId);
  if (new Set(ids).size !== ids.length || fragments.some((fragment) =>
    !Number.isInteger(fragment.ordinal)
    || fragment.ordinal < 0
    || fragment.ordinal > 31
    || !fragment.candidateId
    || /<!doctype\b|<html\b|<head\b|<body\b/i.test(fragment.html))) return null;
  try {
    const rendered = await pool.render(contactSheetHtml(fragments));
    return rendered && isBoundedJpeg(rendered.desktop) ? rendered.desktop : null;
  } catch {
    return null;
  }
}

export async function createVisualQualityRendererPool(
  size: number,
  internals: VisualQualityRendererInternals = {},
): Promise<VisualQualityRendererPool> {
  if (!Number.isInteger(size) || size < 1 || size > 4) throw new Error("invalid_visual_renderer_pool_size");
  const workers: Awaited<ReturnType<typeof createBrowserWorker>>[] = [];
  try {
    for (let index = 0; index < size; index += 1) workers.push(await createBrowserWorker(internals));
  } catch (error) {
    await Promise.allSettled(workers.map((worker) => worker.browser.close()));
    throw error;
  }
  const tails: Promise<unknown>[] = workers.map(() => Promise.resolve());
  let cursor = 0;
  let closed = false;
  return {
    render(html) {
      if (closed) return Promise.resolve(null);
      const index = cursor % workers.length;
      cursor += 1;
      const task = tails[index].then(() => captureWithPage(workers[index].page, html, internals)).catch(() => null);
      tails[index] = task;
      return task;
    },
    async close() {
      if (closed) return;
      closed = true;
      await Promise.allSettled(tails);
      await Promise.allSettled(workers.map((worker) => worker.browser.close()));
    },
  };
}

export async function renderVisualQualityViewports(
  html: string,
  internals: VisualQualityRendererInternals = {},
  opts: VisualQualityRenderOptions = {},
): Promise<VisualQualityViewports | null> {
  try {
    if (!internals.capture) return await captureWithBrowser(html, internals, opts);
    const desktop = await internals.capture(html, VISUAL_QUALITY_DESKTOP_VIEWPORT);
    if (!isBoundedJpeg(desktop)) return null;
    const mobile = await internals.capture(html, VISUAL_QUALITY_MOBILE_VIEWPORT);
    if (!isBoundedJpeg(mobile)) return null;
    return { desktop, mobile };
  } catch (error) {
    // LA CAUSA SE IMPRIME SIEMPRE desde el 2026-09-01. Estaba detrás de
    // `OPENLEN_RENDER_DEBUG === "1"`, y eso convertía el único fallo que deja
    // CIEGOS a los ojos del Agente en algo que sólo se ve redesplegando con una
    // variable puesta. Aguas arriba, `logFallback("render failed — no
    // screenshot")` ya dice QUE falló; sin esto no hay forma de saber POR QUÉ,
    // y en este box Chrome ya ha mordido dos veces (el .deb, el HOME=/tmp).
    // Un fallo de Chrome no es ruido de depuración.
    //
    // Acotado a una línea: el stack entero por cada turno sí sería ruido.
    // eslint-disable-next-line no-console
    console.warn(
      `[visual-quality] render falló: ${error instanceof Error ? error.message : String(error)}`,
    );
    if (process.env.OPENLEN_RENDER_DEBUG === "1") console.error(error);
    return null;
  }
}
