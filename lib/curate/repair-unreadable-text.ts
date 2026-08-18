// Texto que la página pinta y nadie puede leer.
//
// El modelo diseña una barra transparente flotando sobre el hero oscuro y le
// pone `color:#f6efe2` sin fondo propio. Pero la sección de la biblioteca que
// hay debajo sigue pintando `background:var(--bg)` crema, así que la barra no
// flota sobre nada: es crema sobre crema. Medido el 2026-08-17 en el hotel de
// la corrida — contraste 1.01:1, el menú entero invisible, y el crítico visual
// la aprobó.
//
// El arreglo NO puede salir de leer el CSS. Tres elementos más abajo, en el
// mismo documento, `[data-openlen-edit-id="ol-hero-2"] .hero-inner{color:#f6efe2}`
// es exactamente el mismo patrón y es CORRECTO: ahí sí hay una foto oscura
// detrás. Sólo el render sabe distinguirlos, así que se marca el documento, se
// mide, y se corrige el elemento que se midió — no la regla que lo pintó, que
// puede servir a diez elementos más que están bien.

import { parse } from "node-html-parser";

import type { UnreadableTextFinding } from "@/lib/ai/visual-quality-renderer";

const PROBE = "data-ol-probe";
const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
/** Marcar un documento absurdamente grande cuesta más de lo que vale; la señal
 *  del crítico sigue llegando por su cuenta. */
const MAX_PROBES = 6000;

export interface UnreadableTextRepair {
  readonly html: string;
  readonly repaired: number;
}

function lightness(hex: string): number | null {
  const match = HEX_RE.exec(hex.trim());
  if (!match) return null;
  const full = match[1].length === 3 ? match[1].split("").map((c) => c + c).join("") : match[1];
  const [r, g, b] = [0, 2, 4].map((at) => parseInt(full.slice(at, at + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * El polo legible sobre el fondo que se midió.
 *
 * Se usan `--ol-fg`/`--ol-bg` y no un literal por la misma razón que en
 * `repairInvertedSurfaces`: son siempre polos opuestos, así que sirven en los
 * dos sentidos y siguen a la paleta si el tema cambia después. Cuál de los dos
 * es el oscuro lo dice el fondo de la página.
 */
function legibleColor(background: string, pageLight: number | null): string | null {
  const measured = lightness(background);
  if (measured === null) return null;
  const wantsDarkText = measured >= 0.5;
  if (pageLight === null) return wantsDarkText ? "#111111" : "#ffffff";
  const darkPole = pageLight >= 0.5 ? "var(--ol-fg)" : "var(--ol-bg)";
  const lightPole = pageLight >= 0.5 ? "var(--ol-bg)" : "var(--ol-fg)";
  return wantsDarkText ? darkPole : lightPole;
}

function pageLightness(html: string): number | null {
  const openTag = html.match(/<html\b[^>]*>/i)?.[0];
  const background = openTag?.match(/--ol-bg:\s*([^;"]*)/i)?.[1];
  return background ? lightness(background) : null;
}

/**
 * Marca, mide y corrige. Cualquier fallo devuelve el documento intacto: un
 * arreglo cosmético no puede costar la página.
 *
 * El color se pone EN LÍNEA sobre el elemento medido. Gana a la regla del
 * modelo sin reescribirla, que es lo que mantiene el arreglo quirúrgico: la
 * misma regla puede estar pintando bien otros diez elementos.
 */
export async function repairUnreadableText(
  html: string,
  render: (html: string) => Promise<{ unreadableText?: readonly UnreadableTextFinding[] } | null>,
): Promise<UnreadableTextRepair> {
  const unchanged = { html, repaired: 0 };
  let document;
  try { document = parse(html); } catch { return unchanged; }
  const elements = document.querySelectorAll("*");
  if (elements.length === 0 || elements.length > MAX_PROBES) return unchanged;

  elements.forEach((element, index) => element.setAttribute(PROBE, String(index)));
  let findings: readonly UnreadableTextFinding[];
  try {
    findings = (await render(document.toString()))?.unreadableText ?? [];
  } catch {
    return unchanged;
  }

  const pageLight = pageLightness(html);
  let repaired = 0;
  for (const finding of findings) {
    if (!Number.isInteger(finding.probe) || finding.probe < 0 || finding.probe >= elements.length) continue;
    const color = legibleColor(finding.background, pageLight);
    if (color === null) continue;
    const element = elements[finding.probe];
    const style = (element.getAttribute("style") ?? "").trim();
    element.setAttribute("style", `${style}${style && !style.endsWith(";") ? ";" : ""}color:${color}`);
    repaired += 1;
  }
  if (repaired === 0) return unchanged;

  for (const element of elements) element.removeAttribute(PROBE);
  return { html: document.toString(), repaired };
}
