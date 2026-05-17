/**
 * Inline SVG icon components for blocks. Mirrors a subset of lucide-react's
 * surface but ships zero dependency — important because the orchestrator
 * renders blocks server-side via `renderToStaticMarkup` and lucide-react's
 * Icon module is marked `"use client"`, which would cause Next.js to wrap it
 * in a server-side proxy that throws on invocation. The path data below is
 * lifted verbatim from lucide-react v1.16.0 (ISC license); see
 * /LICENSES/lucide.ISC.txt if added, or the upstream repo
 * https://github.com/lucide-icons/lucide for the source of each icon.
 *
 * Why this file exists separately from lucide imports elsewhere in the repo:
 * client-side components (slot-editor, header, modals, etc.) keep using
 * lucide-react directly — that's fine because the "use client" boundary is
 * honored on the client. The constraint applies only to the SSR rendering
 * path: blocks → this file → SVG, nothing more.
 *
 * Each icon accepts the standard SVG props plus an optional `size` shortcut
 * (number or CSS dimension). Defaults match lucide: 24×24, currentColor,
 * stroke-width 2, round caps + joins.
 */
import type { ComponentType, ReactElement, SVGProps } from "react";
import type { IconName } from "./types";

export type LucideIcon = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string }>;

type IconNode = readonly [tag: "path" | "circle" | "rect", attrs: Record<string, string | number>];

// Default lucide v1 viewBox + stroke styling. Held in one place so every
// icon matches the upstream rendering pixel-for-pixel.
function makeIcon(displayName: string, nodes: readonly IconNode[]): LucideIcon {
  const Icon: LucideIcon = ({ size = 24, className, ...rest }) => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...rest}
    >
      {nodes.map(([tag, attrs], i): ReactElement => {
        // React's typing doesn't accept a `tag` string union directly into
        // createElement-shaped JSX, but the runtime accepts it fine. Cast keeps
        // tsc happy without losing type safety on `tag`.
        const Tag = tag as unknown as "path";
        return <Tag key={i} {...attrs} />;
      })}
    </svg>
  );
  Icon.displayName = displayName;
  return Icon;
}

export const Sparkles = makeIcon("Sparkles", [
  ["path", { d: "M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z" }],
  ["path", { d: "M20 2v4" }],
  ["path", { d: "M22 4h-4" }],
  ["circle", { cx: 4, cy: 20, r: 2 }],
]);

export const Code = makeIcon("Code", [
  ["path", { d: "m16 18 6-6-6-6" }],
  ["path", { d: "m8 6-6 6 6 6" }],
]);

export const Zap = makeIcon("Zap", [
  ["path", { d: "M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" }],
]);

export const Shield = makeIcon("Shield", [
  ["path", { d: "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" }],
]);

export const Rocket = makeIcon("Rocket", [
  ["path", { d: "M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" }],
  ["path", { d: "M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09" }],
  ["path", { d: "M9 12a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.4 22.4 0 0 1-4 2z" }],
  ["path", { d: "M9 12H4s.55-3.03 2-4c1.62-1.08 5 .05 5 .05" }],
]);

export const Globe = makeIcon("Globe", [
  ["circle", { cx: 12, cy: 12, r: 10 }],
  ["path", { d: "M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" }],
  ["path", { d: "M2 12h20" }],
]);

export const Layers = makeIcon("Layers", [
  ["path", { d: "M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z" }],
  ["path", { d: "M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12" }],
  ["path", { d: "M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17" }],
]);

export const Wand = makeIcon("Wand", [
  ["path", { d: "M15 4V2" }],
  ["path", { d: "M15 16v-2" }],
  ["path", { d: "M8 9h2" }],
  ["path", { d: "M20 9h2" }],
  ["path", { d: "M17.8 11.8 19 13" }],
  ["path", { d: "M15 9h.01" }],
  ["path", { d: "M17.8 6.2 19 5" }],
  ["path", { d: "m3 21 9-9" }],
  ["path", { d: "M12.2 6.2 11 5" }],
]);

export const Gauge = makeIcon("Gauge", [
  ["path", { d: "m12 14 4-4" }],
  ["path", { d: "M3.34 19a10 10 0 1 1 17.32 0" }],
]);

export const Check = makeIcon("Check", [
  ["path", { d: "M20 6 9 17l-5-5" }],
]);

export const Star = makeIcon("Star", [
  ["path", { d: "M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z" }],
]);

export const CircuitBoard = makeIcon("CircuitBoard", [
  ["rect", { width: 18, height: 18, x: 3, y: 3, rx: 2 }],
  ["path", { d: "M11 9h4a2 2 0 0 0 2-2V3" }],
  ["circle", { cx: 9, cy: 9, r: 2 }],
  ["path", { d: "M7 21v-4a2 2 0 0 1 2-2h4" }],
  ["circle", { cx: 15, cy: 15, r: 2 }],
]);

export const Cloud = makeIcon("Cloud", [
  ["path", { d: "M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" }],
]);

export const Lock = makeIcon("Lock", [
  ["rect", { width: 18, height: 11, x: 3, y: 11, rx: 2, ry: 2 }],
  ["path", { d: "M7 11V7a5 5 0 0 1 10 0v4" }],
]);

export const Compass = makeIcon("Compass", [
  ["circle", { cx: 12, cy: 12, r: 10 }],
  ["path", { d: "m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z" }],
]);

export const Plus = makeIcon("Plus", [
  ["path", { d: "M5 12h14" }],
  ["path", { d: "M12 5v14" }],
]);

const ICON_MAP: Record<IconName, LucideIcon> = {
  sparkles: Sparkles,
  code: Code,
  zap: Zap,
  shield: Shield,
  rocket: Rocket,
  globe: Globe,
  layers: Layers,
  wand: Wand,
  gauge: Gauge,
  check: Check,
  star: Star,
  circuit: CircuitBoard,
  cloud: Cloud,
  lock: Lock,
  compass: Compass,
};

/**
 * Returns the inline-SVG icon component for the given icon name. Falls back to
 * `Sparkles` for unknown names so block rendering can never crash on bad slot
 * data — but `slotsSchema` should already have caught that at fill time.
 */
export function getIcon(name: IconName | string): LucideIcon {
  return (ICON_MAP as Record<string, LucideIcon>)[name] ?? Sparkles;
}
