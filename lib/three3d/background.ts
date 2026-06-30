import type { SceneSpec, Look } from "./scene-spec";

const DEFAULT_ACCENT = "#7C5CFF";

// Light base palettes per look; the accent is mixed in as a low-alpha far stop.
const BASE: Record<Look, [string, string]> = {
  studio: ["#f7f8fb", "#eef1f6"],
  soft: ["#f7f1ea", "#efe6da"],
  neutral: ["#f2f3f6", "#e6e8ee"],
  dramatic: ["#121319", "#1b1d26"],
};

export function backgroundCss(spec: SceneSpec): string | null {
  if (spec.background === "transparent") return null;
  const accent = (spec.material.colors[0] ?? DEFAULT_ACCENT).replace("#", "");
  if (spec.background === "color") return `#${accent}14`;
  if (spec.material.kind === "emissive") {
    // neon/aurora glows over a dark indigo→magenta backdrop
    return `linear-gradient(125deg, #0a0a1f 0%, #1a0a2e 50%, #${accent}22 110%)`;
  }
  // Glass/iridescent transmit the background — dark backdrops read as opaque/dull.
  // Override dramatic→soft so glassy materials always render on a light field.
  const glassy = spec.material.kind === "glass" || spec.material.kind === "iridescent";
  const look = glassy && spec.look === "dramatic" ? "soft" : spec.look;
  const [a, b] = BASE[look];
  const accentAlpha = look === "dramatic" ? "33" : "1f";
  return `linear-gradient(120deg, ${a} 0%, ${b} 55%, #${accent}${accentAlpha} 120%)`;
}
