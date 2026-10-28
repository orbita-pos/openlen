#!/usr/bin/env node
// Checks a chart palette: lightness and chroma of each color, how far apart neighbors are for normal
// vision and for the three color blindnesses, and contrast against the chart's surface.
//
//   node validate_palette.mjs "<hex,hex,...>" [--mode light|dark] [--surface <hex>] [--json]
//
// Exits 1 when a check FAILs, 2 when the input is not a palette. Colors are compared in the order
// given: put them in the order the chart uses them.
//
// Built from public definitions: sRGB to OKLab (Björn Ottosson, 2020), color-blindness simulation
// (Machado, Oliveira and Fernandes, 2009, severity 1.0, in linear RGB) and WCAG 2 relative luminance.
import { pathToFileURL } from "node:url";

const SURFACE = { light: "#ffffff", dark: "#111318" };
// OKLab lightness a series color should sit in, per surface, and the chroma under which it reads gray.
const BAND = { light: [0.4, 0.82], dark: [0.55, 0.92] };
const CHROMA_FLOOR = 0.08;
// Distance in OKLab ×100 between neighbors.
const NORMAL_FLOOR = 15;
const CVD_TARGET = 8;
const CVD_FLOOR = 6;
const CONTRAST_FLOOR = 3;

const MACHADO = {
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

/** @param {string} hex */
export function parseHex(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`not a hex color: ${hex}`);
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return `#${h.toLowerCase()}`;
}

/** @param {string} hex @returns {[number, number, number]} linear RGB, 0..1 */
function linear(hex) {
  const h = parseHex(hex);
  return /** @type {[number, number, number]} */ ([1, 3, 5].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }));
}

/** @param {[number, number, number]} rgb @returns {[number, number, number]} OKLab */
function oklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** @param {number[][]} matrix @param {[number, number, number]} rgb @returns {[number, number, number]} */
function simulate(matrix, rgb) {
  return /** @type {[number, number, number]} */ (
    matrix.map((row) => Math.min(1, Math.max(0, row[0] * rgb[0] + row[1] * rgb[1] + row[2] * rgb[2])))
  );
}

/** @param {[number, number, number]} p @param {[number, number, number]} q */
const distance = (p, q) => 100 * Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);

/** @param {string} hex */
const luminance = (hex) => {
  const [r, g, b] = linear(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** @param {string} a @param {string} b */
export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const f1 = (n) => n.toFixed(1);

/**
 * @param {string[]} hexes
 * @param {{ mode: "light" | "dark"; surface?: string }} o
 * @returns {{ checks: { name: string; status: "PASS" | "WARN" | "FAIL"; detail: string }[]; ok: boolean }}
 */
export function validatePalette(hexes, o) {
  const mode = o.mode === "dark" ? "dark" : "light";
  const colors = hexes.map(parseHex);
  if (colors.length === 0) throw new Error("the palette has no colors");
  const surface = parseHex(o.surface ?? SURFACE[mode]);
  const lin = colors.map(linear);
  const lab = lin.map(oklab);
  /** @type {{ name: string; status: "PASS" | "WARN" | "FAIL"; detail: string }[]} */
  const checks = [];

  const [lo, hi] = BAND[mode];
  const outOfBand = colors.filter((_, i) => lab[i][0] < lo || lab[i][0] > hi);
  checks.push({
    name: "lightness band",
    status: outOfBand.length ? "WARN" : "PASS",
    detail: outOfBand.length
      ? `${outOfBand.map((c) => `${c} L=${f1(lab[colors.indexOf(c)][0] * 100)}`).join(", ")}: outside ${Math.round(lo * 100)}–${Math.round(hi * 100)} for a ${mode} surface`
      : `every color between L ${Math.round(lo * 100)} and ${Math.round(hi * 100)}`,
  });

  const gray = colors.filter((_, i) => Math.hypot(lab[i][1], lab[i][2]) < CHROMA_FLOOR);
  checks.push({
    name: "chroma floor",
    status: gray.length ? "WARN" : "PASS",
    detail: gray.length ? `${gray.join(", ")}: reads as gray (chroma under ${CHROMA_FLOOR})` : `every color has chroma ≥ ${CHROMA_FLOOR}`,
  });

  /** @param {[number, number, number][]} points */
  const closest = (points) => {
    let best = { d: Infinity, pair: "" };
    for (let i = 0; i + 1 < points.length; i++) {
      const d = distance(points[i], points[i + 1]);
      if (d < best.d) best = { d, pair: `${colors[i]} / ${colors[i + 1]}` };
    }
    return best;
  };

  if (colors.length < 2) {
    for (const name of ["normal vision", ...Object.keys(MACHADO)]) checks.push({ name, status: "PASS", detail: "one color, nothing to tell apart" });
  } else {
    const n = closest(lab);
    checks.push({
      name: "normal vision",
      status: n.d < NORMAL_FLOOR ? "FAIL" : "PASS",
      detail: `closest neighbors ${n.pair}: ΔE ${f1(n.d)} (fail under ${NORMAL_FLOOR})`,
    });
    for (const [name, matrix] of Object.entries(MACHADO)) {
      const c = closest(lin.map((rgb) => oklab(simulate(matrix, rgb))));
      checks.push({
        name,
        status: c.d < CVD_FLOOR ? "FAIL" : c.d < CVD_TARGET ? "WARN" : "PASS",
        detail: `closest neighbors ${c.pair}: ΔE ${f1(c.d)} (target ${CVD_TARGET}; ${CVD_FLOOR}–${CVD_TARGET} only with a second encoding: labels, markers or dashes)`,
      });
    }
  }

  const faint = colors.filter((c) => contrast(c, surface) < CONTRAST_FLOOR);
  checks.push({
    name: "contrast",
    status: faint.length ? "WARN" : "PASS",
    detail: faint.length
      ? `${faint.map((c) => `${c} ${f1(contrast(c, surface))}:1`).join(", ")} on ${surface}: under ${CONTRAST_FLOOR}:1, so label those marks or give the data as a table`
      : `every color ≥ ${CONTRAST_FLOOR}:1 on ${surface}`,
  });

  return { checks, ok: checks.every((c) => c.status !== "FAIL") };
}

function main(argv) {
  const args = [...argv];
  const flag = (name) => {
    const i = args.indexOf(name);
    if (i < 0) return undefined;
    const [, value] = args.splice(i, 2);
    return value;
  };
  const json = args.includes("--json");
  if (json) args.splice(args.indexOf("--json"), 1);
  const mode = flag("--mode") ?? "light";
  const surface = flag("--surface");
  if (args.length !== 1 || (mode !== "light" && mode !== "dark")) {
    console.error('usage: node validate_palette.mjs "<hex,hex,...>" [--mode light|dark] [--surface <hex>] [--json]');
    return 2;
  }
  let result;
  try {
    result = validatePalette(args[0].split(",").filter((s) => s.trim()), { mode, surface });
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 2;
  }
  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    const width = Math.max(...result.checks.map((c) => c.name.length));
    for (const c of result.checks) console.log(`${c.status.padEnd(4)}  ${c.name.padEnd(width)}  ${c.detail}`);
  }
  return result.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main(process.argv.slice(2));
