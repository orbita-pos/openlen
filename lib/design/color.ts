// OKLCH → linear sRGB → relative luminance → WCAG contrast.
// All inputs assume L is 0..1 (not the 0..100 percentage form).
// Reference matrices from Björn Ottosson's OKLab spec.
//
// Ported from claude.ai design-foundations artifact (May 2026).

export interface OklchColor {
  L: number;
  C: number;
  H: number;
}

export function oklchToLinearRgb(L: number, C: number, H: number): [number, number, number] {
  const hRad = (H * Math.PI) / 180;
  const a = C * Math.cos(hRad);
  const b = C * Math.sin(hRad);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
  return [r, g, bl];
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

export function relativeLuminance(L: number, C: number, H: number): number {
  const [r, g, b] = oklchToLinearRgb(L, C, H).map(clamp01);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function wcagContrast(c1: OklchColor, c2: OklchColor): number {
  const L1 = relativeLuminance(c1.L, c1.C, c1.H);
  const L2 = relativeLuminance(c2.L, c2.C, c2.H);
  const a = Math.max(L1, L2);
  const b = Math.min(L1, L2);
  return (a + 0.05) / (b + 0.05);
}

// Parse our oklch() strings back into {L,C,H} for contrast math.
// Accepts forms like "oklch(58% 0.22 12)" and "oklch(85% 0.008 12 / 0.6)".
export function parseOklch(str: string): OklchColor | null {
  const m = str.match(/oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)/);
  if (!m) return null;
  return {
    L: parseFloat(m[1]) / 100,
    C: parseFloat(m[2]),
    H: parseFloat(m[3]),
  };
}
