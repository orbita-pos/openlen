import type { ElementSnapshot } from "../types";
import type { TypographyTokens } from "./types";

const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
const MONO_TAGS = new Set(["code", "pre", "kbd", "samp", "var"]);

const CANONICAL_RATIOS: Array<{
  value: number;
  match: TypographyTokens["size"]["ratioMatch"];
}> = [
  { value: 1.067, match: "minor-second" },
  { value: 1.125, match: "major-second" },
  { value: 1.2, match: "minor-third" },
  { value: 1.25, match: "major-third" },
  { value: 1.333, match: "perfect-fourth" },
  { value: 1.414, match: "augmented-fourth" },
  { value: 1.5, match: "perfect-fifth" },
  { value: 1.618, match: "golden-ratio" },
];

function parsePx(value: string): number | null {
  if (!value) return null;
  const match = /^(-?\d+(?:\.\d+)?)px$/.exec(value.trim());
  if (!match) return null;
  return parseFloat(match[1]);
}

function parseStack(family: string): string[] {
  return family
    .split(",")
    .map((s) => s.trim().replace(/^["']|["']$/g, ""))
    .filter((s) => s.length > 0);
}

function pickFontFamily(
  elements: ElementSnapshot[],
): { primary: string; display?: string; mono?: string; declared: { stack: string; usage: number }[] } {
  const stackCounts = new Map<string, number>();
  const primaryFirstCounts = new Map<string, number>();
  const displayFirstCounts = new Map<string, number>();
  const monoFirstCounts = new Map<string, number>();

  for (const el of elements) {
    const fam = el.styles.fontFamily;
    if (!fam) continue;

    const stack = fam.trim();
    stackCounts.set(stack, (stackCounts.get(stack) ?? 0) + 1);

    const parts = parseStack(fam);
    if (parts.length === 0) continue;
    const first = parts[0];

    if (MONO_TAGS.has(el.tag)) {
      monoFirstCounts.set(first, (monoFirstCounts.get(first) ?? 0) + 1);
    } else if (HEADING_TAGS.has(el.tag)) {
      displayFirstCounts.set(first, (displayFirstCounts.get(first) ?? 0) + 1);
    } else {
      primaryFirstCounts.set(first, (primaryFirstCounts.get(first) ?? 0) + 1);
    }
  }

  function topOf(m: Map<string, number>): string | undefined {
    const e = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
    return e?.[0];
  }

  const primary = topOf(primaryFirstCounts) ?? topOf(displayFirstCounts) ?? "sans-serif";
  const display = topOf(displayFirstCounts);
  const mono = topOf(monoFirstCounts);

  const declared = [...stackCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([stack, usage]) => ({ stack, usage }));

  return {
    primary,
    display: display && display !== primary ? display : undefined,
    mono,
    declared,
  };
}

function detectTypeScale(
  elements: ElementSnapshot[],
): { detected: number[]; scale: Record<string, number>; ratio: number | null; ratioMatch: TypographyTokens["size"]["ratioMatch"] } {
  const sizeCounts = new Map<number, number>();
  for (const el of elements) {
    const size = parsePx(el.styles.fontSize);
    if (size === null || size < 8 || size > 200) continue;
    const rounded = Math.round(size);
    sizeCounts.set(rounded, (sizeCounts.get(rounded) ?? 0) + 1);
  }

  const sortedDesc = [...sizeCounts.keys()].sort((a, b) => b - a);

  const merged: number[] = [];
  for (const s of sortedDesc) {
    const last = merged[merged.length - 1];
    if (last !== undefined && (last - s) / last < 0.04) continue;
    merged.push(s);
  }
  merged.reverse();

  if (merged.length < 3) {
    return {
      detected: merged,
      scale: {},
      ratio: null,
      ratioMatch: "custom",
    };
  }

  const ratios: number[] = [];
  for (let i = 1; i < merged.length; i++) {
    if (merged[i - 1] === 0) continue;
    ratios.push(merged[i] / merged[i - 1]);
  }

  const sortedR = ratios.slice().sort((a, b) => a - b);
  const median = sortedR[Math.floor(sortedR.length / 2)];

  let bestMatch: TypographyTokens["size"]["ratioMatch"] = "custom";
  let bestDelta = Infinity;
  for (const canonical of CANONICAL_RATIOS) {
    const d = Math.abs(canonical.value - median);
    if (d < bestDelta) {
      bestDelta = d;
      bestMatch = canonical.match;
    }
  }
  if (bestDelta > 0.05) bestMatch = "custom";

  const sigma = Math.sqrt(
    ratios.reduce((acc, r) => acc + (r - median) ** 2, 0) / ratios.length,
  );
  if (sigma > 0.08) bestMatch = "custom";

  const scale: Record<string, number> = {};
  const labels = ["xs", "sm", "base", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl"];
  for (let i = 0; i < merged.length && i < labels.length; i++) {
    scale[labels[i]] = merged[i];
  }

  return { detected: merged, scale, ratio: median, ratioMatch: bestMatch };
}

function detectWeights(elements: ElementSnapshot[]): { value: number; label: string }[] {
  const weightCounts = new Map<number, number>();
  for (const el of elements) {
    const w = parseInt(el.styles.fontWeight, 10);
    if (Number.isNaN(w) || w < 100 || w > 900) continue;
    weightCounts.set(w, (weightCounts.get(w) ?? 0) + 1);
  }
  const labelFor = (w: number): string => {
    if (w <= 200) return "thin";
    if (w <= 300) return "light";
    if (w <= 400) return "regular";
    if (w <= 500) return "medium";
    if (w <= 600) return "semibold";
    if (w <= 700) return "bold";
    if (w <= 800) return "extra-bold";
    return "black";
  };
  return [...weightCounts.keys()]
    .sort((a, b) => a - b)
    .map((value) => ({ value, label: labelFor(value) }));
}

export function extractTypography(elements: ElementSnapshot[]): TypographyTokens {
  const family = pickFontFamily(elements);
  const size = detectTypeScale(elements);
  const weights = detectWeights(elements);
  return {
    family: { primary: family.primary, display: family.display, mono: family.mono },
    declaredFamilies: family.declared,
    size,
    weights,
  };
}
