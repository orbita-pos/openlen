import { type SealedArtifactInput } from "../../types";
import { ARTIFACT_CSP, datasetLabel } from "../dashboard/compile";
import { chartData, type SlideChart, type SlideDeck } from "./manifest";
const esc = (v: unknown) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const colors = ["75BDA0", "5C8DA6", "F0B66E", "9F89CA", "D88080", "9CA977"];
function chartSvg(chart: SlideChart, input: SealedArtifactInput) {
  const data = chartData(chart, input);
  const all = data.series.flatMap((s) => s.values), min = Math.min(0, ...all), max = Math.max(1, ...all);
  const width = chart.w, height = chart.h, left = 48, bottom = height - 40, top = data.series.length > 1 ? 64 : 32;
  const y = (value: number) => bottom - (value - min) / (max - min) * (bottom - top);
  const step = (width - left - 12) / data.labels.length;
  const bits = [`<line x1="${left}" y1="${y(0)}" x2="${width - 12}" y2="${y(0)}" stroke="currentColor"/>`];
  data.series.forEach((s, series) => {
    const fill = chart.colors?.[series % chart.colors.length] ?? colors[series % colors.length]!;
    if (chart.chartType === "line") bits.push(`<polyline fill="none" stroke="#${fill}" stroke-width="3" points="${s.values.map((v, i) => `${left + step * (i + .5)},${y(v)}`).join(" ")}"/>`);
    s.values.forEach((v, i) => {
      const groupWidth = (step - 16) / data.series.length;
      const x = left + step * i + 8 + series * groupWidth;
      const center = chart.chartType === "bar" ? x + Math.max(1, groupWidth - 4) / 2 : left + step * (i + .5);
      if (chart.chartType === "bar") bits.push(`<rect x="${x}" y="${Math.min(y(v), y(0))}" width="${Math.max(1, groupWidth - 4)}" height="${Math.abs(y(v) - y(0))}" fill="#${fill}"/>`);
      else bits.push(`<circle cx="${center}" cy="${y(v)}" r="4" fill="#${fill}"/>`);
      bits.push(`<text x="${center}" data-series-value="${esc(s.name)}" y="${Math.max(top - 14, y(v) + (v < 0 ? 20 : -8))}" fill="currentColor" text-anchor="middle" font-size="16">${v}</text>`);
    });
    if (data.series.length > 1) {
      const legendX = left + series * (width - left) / data.series.length;
      bits.push(`<rect x="${legendX}" y="8" width="12" height="12" fill="#${fill}"/><text x="${legendX + 18}" y="19" data-series-legend="${esc(s.name)}" fill="currentColor" font-size="14">${esc(s.name)}</text>`);
    }
  });
  data.labels.forEach((label, i) => bits.push(`<text x="${left + step * (i + .5)}" y="${height - 14}" text-anchor="middle" fill="currentColor" font-size="14">${esc(label)}</text>`));
  return `<svg role="img" aria-label="${esc(chart.valueColumns.join(", "))}" width="100%" height="100%" viewBox="0 0 ${width} ${height}">${bits.join("")}</svg>`;
}
export function slideDeckHtml(deck: SlideDeck, input: SealedArtifactInput): string {
  const slides = deck.slides.map((s) => {
    const labels = new Set<string>();
    const elements = s.elements.map((e) => {
      const base = `position:absolute;left:${e.x}px;top:${e.y}px;width:${e.w}px;height:${e.h}px;box-sizing:border-box;`;
      if (e.type === "text") return `<div class="slide-text" data-element-id="${e.id}" style="${base}font-size:${e.fontSize}px;font-weight:${e.bold ? 700 : 400};color:#${e.color ?? deck.color};text-align:${e.align};white-space:pre-wrap;line-height:1.15">${esc(e.text)}</div>`;
      if (e.type === "image") { const a = input.assets.find((a) => a.id === e.assetId)!; return `<img data-element-id="${e.id}" style="${base}object-fit:${e.fit}" src="data:${a.mime};base64,${Buffer.from(a.bytes).toString("base64")}" alt="">`; }
      if (e.type === "shape") return `<div data-element-id="${e.id}" style="${base}background:${e.fill ? `#${e.fill}` : "transparent"};border:${e.strokeWidth}px solid ${e.stroke ? `#${e.stroke}` : "transparent"};${e.shape === "ellipse" ? "border-radius:50%;" : ""}${e.shape === "line" ? `height:0;border:0;border-top:${e.strokeWidth}px solid #${e.stroke ?? deck.color};` : ""}"></div>`;
      labels.add(datasetLabel(chartData(e, input).dataset));
      return `<div data-element-id="${e.id}" style="${base}">${chartSvg(e, input)}</div>`;
    }).join("");
    return `<section class="slide" data-slide-id="${s.id}" style="background:#${s.background ?? deck.background}">${elements}${labels.size ? `<footer style="position:absolute;bottom:12px;left:32px;font-size:14px">${esc([...labels].join(" · "))}</footer>` : ""}</section>`;
  }).join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${ARTIFACT_CSP}"><title>${esc(deck.title)}</title><style>@page{size:${deck.width}px ${deck.height}px;margin:0}*{box-sizing:border-box}body{margin:0;color:#${deck.color};font-family:'${deck.fontFamily}',sans-serif}.slide{position:relative;width:${deck.width}px;height:${deck.height}px;overflow:hidden;break-after:page;page-break-after:always}.slide:last-child{break-after:auto;page-break-after:auto}img{display:block}svg{overflow:visible}</style></head><body>${slides}</body></html>`;
}
