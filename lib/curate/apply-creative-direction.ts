import { applyThemeTokensToHtml } from "@/lib/agent/theme-apply";
import type { CreativeDirection } from "@/lib/generation/creative-contracts";
import { deriveContractColors } from "@/lib/theme-derive";

const MODES = ["light", "dark", "cream"] as const;
const MARKER = /(<style\b[^>]*\bdata-openlen-visual-engine="creative-direction\/1\.0"[^>]*>)([\s\S]*?)(<\/style>)/i;

/**
 * Repinta una página ya compuesta con la dirección elegida.
 *
 * SÓLO color y modo. La tipografía y la geometría de la dirección se quedan
 * fuera a propósito: la baseline ya pasó su prueba de render —desborde y
 * geometría— con las fuentes y los radios con los que se compuso, y cambiarlos
 * después invalidaría ese veredicto sin volver a renderizar. El color no mueve
 * una caja.
 *
 * El marcador se reescribe junto con `<html>`: la puerta de entrega exige
 * exactamente un marcador de dirección creativa, y dejarlo con la paleta vieja
 * sería una página que dice una cosa y se ve otra.
 */
export function applyCreativeDirection(html: string, direction: CreativeDirection): string {
  const c = deriveContractColors({
    bg: direction.palette.background,
    surface: direction.palette.surface,
    fg: direction.palette.foreground,
    border: direction.palette.border,
    accent: direction.palette.accent,
  });
  const themed = applyThemeTokensToHtml(html, {
    "--ol-bg": c.bg,
    "--ol-surface": c.surface,
    "--ol-surface-2": c["surface-2"],
    "--ol-fg": c.fg,
    "--ol-fg-muted": c["fg-muted"],
    "--ol-fg-faint": c["fg-faint"],
    "--ol-border": c.border,
    "--ol-border-strong": c["border-strong"],
    // `--ol-accent-r` sale solo de aquí: el aplicador deriva el triplete.
    "--ol-accent": c.accent,
    "--ol-accent-ink": c["accent-ink"],
  });
  return withMarkerPalette(withMode(themed, direction.mode), direction);
}

/** El modo vive como clase en `<html>`, que es donde lo puso el ensamblador. */
function withMode(html: string, mode: CreativeDirection["mode"]): string {
  const tag = /<html\b[^>]*>/i.exec(html);
  if (!tag) return html;
  const classAttr = /\sclass="([^"]*)"/i.exec(tag[0]);
  const kept = (classAttr?.[1] ?? "")
    .split(/\s+/)
    .filter((name) => name && !MODES.includes(name as (typeof MODES)[number]));
  const value = [mode, ...kept].join(" ");
  const replaced = classAttr
    ? tag[0].slice(0, classAttr.index) + ` class="${value}"` + tag[0].slice(classAttr.index + classAttr[0].length)
    : tag[0].replace(/^<html\b/i, (m) => `${m} class="${value}"`);
  return html.slice(0, tag.index) + replaced + html.slice(tag.index + tag[0].length);
}

function withMarkerPalette(html: string, direction: CreativeDirection): string {
  const tokens = Object.entries(direction.palette)
    .filter(([, value]) => typeof value === "string" && /^#[0-9a-f]{3,8}$/i.test(value))
    .map(([name, value]) => `--ol-${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}:${value}`)
    .join(";");
  return html.replace(MARKER, (_all, open: string, _body: string, close: string) => `${open}:root{${tokens}}${close}`);
}
