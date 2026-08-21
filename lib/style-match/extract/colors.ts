import type { ElementSnapshot } from "../types";
import { deltaE, isHighSaturation, isNearGrayscale, parseColor, type ParsedColor } from "./_color-utils";
import type { ColorEntry, ColorTokens } from "./types";

const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
const BODY_TAGS = new Set(["body", "html"]);
const COLOR_PROPS = ["color", "backgroundColor", "borderColor"] as const;
const CLUSTER_DELTA_E = 2.5;
/** Enlace sin estilizar y enlace visitado, tal como los pinta el navegador. */
const UA_LINK_COLORS = new Set(["#0000ee", "#551a8b"]);

interface ColorUsage {
  parsed: ParsedColor;
  weight: number;
  brandSignal: boolean;
}

interface Cluster {
  representative: ParsedColor;
  totalWeight: number;
  brandWeight: number;
  occurrences: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function collectUsages(
  elements: ElementSnapshot[],
  docArea: number,
): ColorUsage[] {
  const usages: ColorUsage[] = [];
  for (const el of elements) {
    const area = Math.max(1, el.rect.width * el.rect.height);
    const areaWeight = Math.sqrt(area / docArea);
    const elevationWeight = clamp(1 + el.zIndex / 10, 1, 5);

    const tag = el.tag;
    const role = el.role;
    const isButton = tag === "button" || role === "button";
    const isLink = tag === "a";
    const isHeading = HEADING_TAGS.has(tag);
    const isBody = BODY_TAGS.has(tag);

    let roleWeight = 1.0;
    if (isButton) roleWeight = 3.0;
    else if (isLink) roleWeight = 2.5;
    else if (isHeading) roleWeight = 2.0;
    else if (isBody) roleWeight = 0.3;

    const baseWeight = areaWeight * elevationWeight * roleWeight;

    for (const prop of COLOR_PROPS) {
      const value = el.styles[prop];
      const parsed = parseColor(value);
      if (!parsed) continue;
      // Lo que el NAVEGADOR pinta cuando nadie estilizó el enlace no es una
      // decisión de diseño de nadie, y aquí entraba con `brandSignal` puesto
      // —un enlace lo lleva por definición—, así que un sitio con los enlaces
      // sin estilizar podía declarar como color de MARCA el azul por defecto de
      // Chrome.
      //
      // Se descarta en `color` Y en `borderColor`, y las dos rutas se midieron
      // en stripe.com: 10 elementos lo traían en `color` (4 enlaces sin estilo
      // más 6 hijos que lo HEREDAN) y otros 8 en `borderColor`, porque el valor
      // inicial de `border-color` es `currentColor` — el mismo no-color, por la
      // puerta de al lado. Filtrar sólo `<a>`, o sólo `color`, deja pasar el
      // resto: se comprobó contra la web, no contra una suposición.
      //
      // `backgroundColor` NO se filtra: un fondo así hay que declararlo, y
      // declararlo es elegirlo.
      if (prop !== "backgroundColor" && UA_LINK_COLORS.has(parsed.hex.toLowerCase())) continue;

      let propBoost = 1.0;
      let brandSignal = false;

      if (prop === "backgroundColor") {
        if (isButton) {
          propBoost = 3.0;
          brandSignal = true;
        } else if (isLink) {
          propBoost = 2.5;
          brandSignal = true;
        }
      } else if (prop === "color") {
        if (isLink) {
          propBoost = 1.5;
          brandSignal = true;
        } else if (isHeading) {
          propBoost = 1.4;
        }
      } else if (prop === "borderColor") {
        if (isButton) {
          propBoost = 2.0;
          brandSignal = true;
        } else if (isLink) {
          propBoost = 1.5;
        }
      }

      usages.push({
        parsed,
        weight: baseWeight * propBoost,
        brandSignal,
      });
    }
  }
  return usages;
}

function clusterUsages(usages: ColorUsage[]): Cluster[] {
  const sorted = usages.slice().sort((a, b) => b.weight - a.weight);
  const clusters: Cluster[] = [];

  for (const usage of sorted) {
    let placed = false;
    for (const cluster of clusters) {
      if (deltaE(cluster.representative, usage.parsed) < CLUSTER_DELTA_E) {
        cluster.totalWeight += usage.weight;
        cluster.occurrences += 1;
        if (usage.brandSignal) cluster.brandWeight += usage.weight;
        placed = true;
        break;
      }
    }
    if (!placed) {
      clusters.push({
        representative: usage.parsed,
        totalWeight: usage.weight,
        brandWeight: usage.brandSignal ? usage.weight : 0,
        occurrences: 1,
      });
    }
  }
  return clusters;
}

function clusterToEntry(c: Cluster): ColorEntry {
  return {
    hex: c.representative.hex,
    oklch: c.representative.oklch,
    weight: c.totalWeight,
    occurrenceCount: c.occurrences,
  };
}

/**
 * La polaridad es una pregunta de ÁREA, y por eso NO puede salir de los pesos
 * del resto del módulo.
 *
 * `collectUsages` está afinado para encontrar la MARCA: comprime el área con una
 * raíz cuadrada, realza botones ×3 y enlaces ×2.5, y baja `body`/`html` a 0.3
 * precisamente para que un fondo enorme no tape el color de marca. Para la marca
 * está bien. Para el fondo es ruinoso, y se midió: en linear.app el `body` es
 * `rgb(8,9,10)` cubriendo 32,17 Mpx —ocho veces todo lo demás junto— y aun así
 * unas decenas de chips claros ganaban la votación. La página negra se declaraba
 * "clara", y eso viaja al brief como "Fondo claro".
 *
 * Aquí se cuenta el área de verdad: sin raíces, sin realces de rol.
 */
function detectPolarity(elements: ElementSnapshot[]): "light" | "dark" {
  let light = 0;
  let dark = 0;
  for (const el of elements) {
    const parsed = parseColor(el.styles.backgroundColor);
    // Un velo casi transparente —`rgba(255,255,255,0.02)` es literalmente el
    // cuarto fondo de linear.app— no es un fondo: deja ver lo de debajo.
    // Contarlo como blanco es como se invierte una página oscura.
    if (!parsed || parsed.alpha < 0.5) continue;
    const area = Math.max(1, el.rect.width * el.rect.height);
    if (parsed.oklch.l > 0.5) light += area;
    else dark += area;
  }
  return light >= dark ? "light" : "dark";
}

function pickNeutralRamp(clusters: Cluster[]): { step: string; entry: ColorEntry }[] {
  const grayscale = clusters.filter((c) => isNearGrayscale(c.representative));
  if (grayscale.length === 0) return [];

  const sorted = grayscale
    .slice()
    .sort((a, b) => b.representative.oklch.l - a.representative.oklch.l);

  const steps = ["50", "100", "200", "300", "500", "700", "800", "900"];
  const dedup: typeof sorted = [];
  for (const c of sorted) {
    const tooClose = dedup.some(
      (d) => Math.abs(d.representative.oklch.l - c.representative.oklch.l) < 0.04,
    );
    if (!tooClose) dedup.push(c);
  }

  const sliced = dedup.slice(0, steps.length);
  return sliced.map((c, i) => ({
    step: steps[i] ?? `${(i + 1) * 100}`,
    entry: clusterToEntry(c),
  }));
}

export function extractColors(
  elements: ElementSnapshot[],
  docHeight: number,
  docWidth: number,
): ColorTokens {
  const docArea = Math.max(1, docHeight * docWidth);
  const usages = collectUsages(elements, docArea);
  const clusters = clusterUsages(usages);

  const saturated = clusters.filter((c) => isHighSaturation(c.representative));
  saturated.sort((a, b) => {
    const aScore = a.brandWeight * 2 + a.totalWeight;
    const bScore = b.brandWeight * 2 + b.totalWeight;
    return bScore - aScore;
  });

  const primary = saturated.find((c) => c.brandWeight > 0);
  const accents = saturated
    .filter((c) => c !== primary)
    .slice(0, 3)
    .map(clusterToEntry);

  const neutrals = pickNeutralRamp(clusters);
  const polarity = detectPolarity(elements);
  const raw = clusters
    .slice()
    .sort((a, b) => b.totalWeight - a.totalWeight)
    .slice(0, 20)
    .map(clusterToEntry);

  return {
    primary: primary ? clusterToEntry(primary) : undefined,
    accents,
    neutrals,
    polarity,
    raw,
  };
}
