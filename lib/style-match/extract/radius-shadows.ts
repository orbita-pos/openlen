import type { ElementSnapshot } from "../types";
import type { RadiusTokens, ShadowEntry, ShadowTokens } from "./types";

const PX_RE = /(-?\d+(?:\.\d+)?)px/g;

function avgPxIn(value: string): number | null {
  if (!value) return null;
  const out: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = PX_RE.exec(value)) !== null) {
    const n = parseFloat(match[1]);
    if (n >= 0 && n <= 99999) out.push(n);
  }
  PX_RE.lastIndex = 0;
  if (out.length === 0) return null;
  return out.reduce((a, b) => a + b, 0) / out.length;
}

export function extractRadius(elements: ElementSnapshot[]): RadiusTokens {
  const counts = new Map<number, number>();
  for (const el of elements) {
    const v = avgPxIn(el.styles.borderRadius);
    if (v === null) continue;
    const rounded = v >= 9990 ? 9999 : Math.round(v);
    counts.set(rounded, (counts.get(rounded) ?? 0) + 1);
  }

  if (counts.size === 0) {
    return { personality: "sharp", scale: {}, distinctValues: [] };
  }

  const buckets: Record<RadiusTokens["personality"], number> = {
    sharp: 0,
    soft: 0,
    rounded: 0,
    pill: 0,
  };
  for (const [v, c] of counts.entries()) {
    if (v === 0) continue;
    if (v <= 2) buckets.sharp += c;
    else if (v <= 12) buckets.soft += c;
    else if (v <= 32) buckets.rounded += c;
    else buckets.pill += c;
  }

  const totalNonZero = buckets.sharp + buckets.soft + buckets.rounded + buckets.pill;
  const personality: RadiusTokens["personality"] =
    totalNonZero === 0
      ? "sharp"
      : (Object.keys(buckets) as RadiusTokens["personality"][]).reduce(
          (best, key) => (buckets[key] > buckets[best] ? key : best),
          "sharp" as RadiusTokens["personality"],
        );

  const distinct = [...counts.keys()].sort((a, b) => a - b);
  const scale: Record<string, number> = {};
  const softValues = distinct.filter((v) => v > 0 && v <= 12);
  const roundedValues = distinct.filter((v) => v > 12 && v < 9990);
  if (softValues.length) {
    if (softValues[0]) scale.sm = softValues[0];
    if (softValues.length > 1) scale.md = softValues[Math.floor(softValues.length / 2)];
    if (softValues[softValues.length - 1]) scale.lg = softValues[softValues.length - 1];
  }
  if (roundedValues.length) {
    scale.xl = roundedValues[Math.floor(roundedValues.length / 2)];
  }
  if (distinct.some((v) => v >= 9990)) scale.pill = 9999;

  return { personality, scale, distinctValues: distinct };
}

function parseShadow(raw: string): ShadowEntry | null {
  if (!raw || raw === "none") return null;
  const layers = splitTopLevelCommas(raw);
  let maxBlur = 0;
  let hasColored = false;
  for (const layer of layers) {
    const pxValues: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = PX_RE.exec(layer)) !== null) {
      pxValues.push(parseFloat(m[1]));
    }
    PX_RE.lastIndex = 0;
    if (pxValues.length >= 3) {
      const blur = pxValues[2];
      if (blur > maxBlur) maxBlur = blur;
    }
    const colorMatch = /(rgba?\([^)]+\)|#[0-9a-f]{3,8}|hsla?\([^)]+\))/i.exec(layer);
    if (colorMatch) {
      const c = colorMatch[1];
      if (!/^(rgb|rgba|hsl|hsla)\(\s*0\s*,\s*0\s*,\s*0/i.test(c) && !/^#0{3,6}/i.test(c)) {
        const rgbMatch = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(c);
        if (rgbMatch) {
          const [r, g, b] = [Number(rgbMatch[1]), Number(rgbMatch[2]), Number(rgbMatch[3])];
          const spread = Math.max(r, g, b) - Math.min(r, g, b);
          if (spread > 25) hasColored = true;
        }
      }
    }
  }
  return {
    raw,
    layerCount: layers.length,
    maxBlur,
    hasColored,
  };
}

function splitTopLevelCommas(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let buf = "";
  for (const ch of value) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(buf.trim());
      buf = "";
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

export function extractShadows(elements: ElementSnapshot[]): ShadowTokens {
  const seen = new Map<string, ShadowEntry>();
  for (const el of elements) {
    const entry = parseShadow(el.styles.boxShadow);
    if (!entry) continue;
    if (!seen.has(entry.raw)) seen.set(entry.raw, entry);
  }
  const distinct = [...seen.values()];

  if (distinct.length === 0) {
    return { personality: "none", distinct: [] };
  }

  const counts: Record<Exclude<ShadowTokens["personality"], "none">, number> = {
    soft: 0,
    layered: 0,
    dramatic: 0,
    colored: 0,
  };
  for (const d of distinct) {
    if (d.hasColored) counts.colored += 1;
    else if (d.maxBlur >= 24) counts.dramatic += 1;
    else if (d.layerCount >= 2) counts.layered += 1;
    else counts.soft += 1;
  }
  const personality = (Object.keys(counts) as Array<keyof typeof counts>).reduce(
    (best, key) => (counts[key] > counts[best] ? key : best),
    "soft" as keyof typeof counts,
  );
  return { personality, distinct };
}
