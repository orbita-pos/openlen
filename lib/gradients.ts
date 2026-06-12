// Simple 2-stop gradient model for the inspector's background editor.
// Deliberately minimal: linear (with angle) or radial, exactly two stops.
// Parsing accepts what getComputedStyle emits (rgb()/rgba()) as well as
// authored hex, and refuses anything it couldn't faithfully round-trip
// (3+ stops, keyword directions, conic, url()-bearing layer lists) — the
// editor then starts from defaults and applying overwrites.
// Client-safe: no node imports.

export interface SimpleGradient {
  type: "linear" | "radial";
  /** Degrees — linear only (radial ignores it). */
  angle: number;
  stops: [string, string]; // #rrggbb
}

export function buildLinearGradient(
  angle: number,
  stops: readonly [string, string],
): string {
  const a = ((Math.round(angle) % 360) + 360) % 360;
  return `linear-gradient(${a}deg, ${stops[0]}, ${stops[1]})`;
}

export function buildRadialGradient(stops: readonly [string, string]): string {
  return `radial-gradient(circle at center, ${stops[0]}, ${stops[1]})`;
}

function toHex(color: string): string | null {
  const c = color.trim();
  const hex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(c);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return ("#" + h).toLowerCase();
  }
  const rgb =
    /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+[\d.]+)?\s*\)$/.exec(c);
  if (!rgb) return null;
  const part = (v: string) =>
    Math.max(0, Math.min(255, parseInt(v, 10)))
      .toString(16)
      .padStart(2, "0");
  return ("#" + part(rgb[1]) + part(rgb[2]) + part(rgb[3])).toLowerCase();
}

export function parseSimpleGradient(value: string): SimpleGradient | null {
  const v = ("" + (value || "")).trim();
  if (!v || /url\(/i.test(v) || /conic-gradient/i.test(v)) return null;
  const m = /^(linear|radial)-gradient\((.*)\)$/i.exec(v);
  if (!m) return null;
  const type = m[1].toLowerCase() as "linear" | "radial";
  // Split args at top-level commas only (rgb() stops contain commas).
  const args: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of m[2]) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      args.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) args.push(cur.trim());
  if (depth !== 0) return null; // a second gradient layer leaked into args

  let angle = 180;
  let stopArgs = args;
  if (type === "linear") {
    const deg = /^(-?[\d.]+)deg$/.exec(args[0] || "");
    if (deg) {
      angle = ((Math.round(parseFloat(deg[1])) % 360) + 360) % 360;
      stopArgs = args.slice(1);
    } else if (/^to\s/i.test(args[0] || "")) {
      return null; // keyword directions don't round-trip into the angle slider
    }
  } else if (
    /^(circle|ellipse|closest-|farthest-)/i.test(args[0] || "") ||
    /\bat\b/i.test(args[0] || "")
  ) {
    stopArgs = args.slice(1);
  }
  if (stopArgs.length !== 2) return null;

  const stops: string[] = [];
  for (const s of stopArgs) {
    const colorPart = s.replace(/\s+[\d.]+%$/, "").trim();
    const hx = toHex(colorPart);
    if (!hx) return null;
    stops.push(hx);
  }
  return { type, angle, stops: [stops[0], stops[1]] };
}

/** WCAG relative luminance of a #rrggbb / rgb() color (0..1). */
export function hexLuminance(color: string): number {
  const h = toHex(color);
  if (!h) return 0.5;
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return (
    0.2126 * lin(parseInt(h.slice(1, 3), 16)) +
    0.7152 * lin(parseInt(h.slice(3, 5), 16)) +
    0.0722 * lin(parseInt(h.slice(5, 7), 16))
  );
}

const DARK_INK = "#111827";
const DARK_INK_LUM = 0.0123; // hexLuminance(DARK_INK), pinned

/**
 * Legibility plan for a gradient fill: average the stops' luminance and pick
 * whichever ink contrasts better (never a scrim — a scrim over a gradient
 * just muddies it). Shape matches sectionBgPlan so applyBg's legibility
 * contract is shared.
 */
export function gradientBgPlan(stops: readonly string[]): {
  ink: string;
  scrimColor: "";
  groundLum: number;
} {
  let sum = 0;
  for (const s of stops) sum += hexLuminance(s);
  const lum = stops.length ? sum / stops.length : 0.5;
  const whiteCr = 1.05 / (lum + 0.05);
  const darkCr = (lum + 0.05) / (DARK_INK_LUM + 0.05);
  return {
    ink: whiteCr >= darkCr ? "#ffffff" : DARK_INK,
    scrimColor: "",
    groundLum: lum,
  };
}
