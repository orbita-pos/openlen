import { lookFromAccent } from "@/lib/palette-gen";
import { deriveContractColors } from "@/lib/theme-derive";
import type { CreativeDirection } from "./creative-contracts";

type Palette = CreativeDirection["palette"];
type Mode = CreativeDirection["mode"];

/** Un acento que siempre parsea, para que una respuesta mala del modelo cueste
 *  un color y nunca la página. */
const FALLBACK_ACCENT = "#4B5563";
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * Las ocho entradas de la paleta, derivadas de UN acento y un modo.
 *
 * Existe porque la dirección creativa se elegía como el vecino más parecido
 * entre siete nichos fijos, así que una clínica dental heredaba la paleta de
 * terror. El reemplazo reparte el trabajo por lo que cada parte puede prometer:
 * el modelo elige el gusto (modo y un acento), y esto garantiza que los ocho
 * colores funcionen juntos.
 *
 * `lookFromAccent` clava las luminancias de fondo y texto, así que el cuerpo
 * de texto **clava AA por construcción** y el acento sale con contraste
 * garantizado contra su propio fondo. Después de un día entero persiguiendo
 * texto ilegible, esa es exactamente la garantía que queremos abajo del todo.
 */
export function paletteFromAccent(accent: string, mode: Mode): Palette {
  const seed = HEX.test(accent.trim()) ? accent.trim() : FALLBACK_ACCENT;
  const look = lookFromAccent(seed);
  const base = mode === "dark" ? look.dark : look.light;

  const bg = mode === "cream" ? warm(base["--ol-bg"]) : base["--ol-bg"];
  const surface = mode === "cream" ? warm(base["--ol-surface"]) : base["--ol-surface"];

  const c = deriveContractColors({
    bg,
    surface,
    fg: base["--ol-fg"],
    border: base["--ol-border"],
    accent: base["--ol-accent"],
  });

  return {
    background: c.bg,
    surface: c.surface,
    surfaceAlt: c["surface-2"],
    foreground: c.fg,
    foregroundMuted: c["fg-muted"],
    accent: c.accent,
    accentInk: c["accent-ink"],
    border: c.border,
  };
}

/**
 * Cream es un claro CÁLIDO, no otro nombre para claro — las paletas crema de la
 * cohorte son blancos rotos hacia el amarillo (#FFF8E8, #FFF8ED, #F6F3EE).
 *
 * El calentado es un desplazamiento chico y asimétrico: sube rojo, sube verde a
 * la mitad, baja azul. Sobre un casi-blanco eso mueve el tono sin mover la
 * luminancia de forma apreciable, así que el contraste que `lookFromAccent`
 * garantizó sigue en pie. Se recorta a 0..255 para que un fondo ya cálido no se
 * desborde.
 */
function warm(hex: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  const shifted = [clamp(r + 6), clamp(g + 3), clamp(b - 8)];
  return `#${shifted.map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}
