// THE APP TAKES HER COLOR (spec local 2026-11-16-movil-es-tu-asistente, §5.2): Len móvil is her app, so Len's orange
// gives way to her color everywhere. The stylesheets keep the orange only as the fallback of `--her-*` variables
// (prototipo.css, app.css): set here on the root, the app is hers; taken off (no assistant, before signing in), it is
// Len's orange again. Her color is free, so every ink over it is computed (`tintOf`), never assumed.
import { mix } from "@/lib/figure/look";
import { contrast, tintOf } from "@/lib/figure/tint";

export const HER_VARS = [
  "--her-tint",
  "--her-tint-a",
  "--her-tint-c",
  "--her-ink",
  "--her-rgb",
  "--her-soft",
  "--her-soft-dark",
  "--her-paper",
  "--her-paper-dark",
  "--her-me",
  "--her-deep",
  "--her-light",
  "--her-sheet",
  "--her-on",
  "--her-on-rgb",
] as const;

export type HerVar = (typeof HER_VARS)[number];

/** The phone's dark panel, where her light accent text sits. */
const DARK_PANEL = "#1e140e";

/** `color` moved toward `toward` in 5 % steps until it reads at 4.5:1 on `ground`. */
function readableOn(color: string, ground: string, toward: "#000000" | "#ffffff"): string {
  let c = color;
  for (let step = 1; contrast(c, ground) < 4.5 && step <= 20; step++) c = mix(color, toward, step * 0.05);
  return c;
}

/** Her variables, or null when `color` is not a #rrggbb. */
export function herColorVars(color: string): Record<HerVar, string> | null {
  const t = tintOf(color);
  if (!t) return null;
  const rgb = [1, 3, 5].map((i) => parseInt(t.tint.slice(i, i + 2), 16)).join(",");
  return {
    "--her-tint": t.tint,
    "--her-tint-a": mix(t.tint, "#ffffff", 0.25),
    "--her-tint-c": mix(t.tint, "#000000", 0.12),
    "--her-ink": t.ink,
    "--her-rgb": rgb,
    "--her-soft": t.soft,
    "--her-soft-dark": t.softDark,
    "--her-paper": mix(color.toLowerCase(), "#ffffff", 0.95),
    "--her-paper-dark": mix(color.toLowerCase(), "#000000", 0.92),
    // Your own bubbles in the chat: her color, flat; the text over it is `--her-ink`.
    "--her-me": t.tint,
    // Accent text: on the light theme's white, and on the dark theme's panel.
    "--her-deep": readableOn(t.tint, "#ffffff", "#000000"),
    "--her-light": readableOn(t.tint, DARK_PANEL, "#ffffff"),
    // The brand sheet over your page (light theme): her color in full, and the ink on it — Len's sheet was orange
    // with white on it; with a free color the white may not read, so the ink is hers.
    "--her-sheet": `linear-gradient(180deg,${mix(t.tint, "#ffffff", 0.1)} 0%,${t.tint} 45%,${mix(t.tint, "#000000", 0.1)} 100%)`,
    "--her-on": t.ink,
    "--her-on-rgb": [1, 3, 5].map((i) => parseInt(t.ink.slice(i, i + 2), 16)).join(","),
  };
}

/** Paints the app her color, or (null) gives it back Len's orange. */
export function applyHerColor(color: string | null, root: HTMLElement = document.documentElement): void {
  const vars = color ? herColorVars(color) : null;
  for (const name of HER_VARS) {
    if (vars) root.style.setProperty(name, vars[name]);
    else root.style.removeProperty(name);
  }
}
