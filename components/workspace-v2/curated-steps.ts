// Pasos curados del inspector — cada paso escribe var(--ol-*) con fallback
// literal (páginas legacy sin bloques :root), así los elementos siguen
// obedeciendo los diales globales. Llaves de tokens: type_pass.rs emite
// --ol-text-<key>/--ol-lh-<key> (llaves Tailwind), space.rs emite
// --ol-space-<key> ('.'→'_'), radius.rs emite --ol-r-sm…--ol-r-3xl.

export const TYPE_LADDER = [
  { key: "xs", size: "0.75rem", lh: "1rem", px: 12 },
  { key: "sm", size: "0.875rem", lh: "1.25rem", px: 14 },
  { key: "base", size: "1rem", lh: "1.5rem", px: 16 },
  { key: "lg", size: "1.125rem", lh: "1.75rem", px: 18 },
  { key: "xl", size: "1.25rem", lh: "1.75rem", px: 20 },
  { key: "2xl", size: "1.5rem", lh: "2rem", px: 24 },
  { key: "3xl", size: "1.875rem", lh: "2.25rem", px: 30 },
  { key: "4xl", size: "2.25rem", lh: "2.5rem", px: 36 },
  { key: "5xl", size: "3rem", lh: "1.1", px: 48 },
  { key: "6xl", size: "3.75rem", lh: "1.1", px: 60 },
  { key: "7xl", size: "4.5rem", lh: "1.05", px: 72 },
] as const;

export function nearestTypeIndex(px: number): number {
  let best = 0;
  for (let i = 1; i < TYPE_LADDER.length; i++) {
    if (Math.abs(TYPE_LADDER[i].px - px) < Math.abs(TYPE_LADDER[best].px - px)) best = i;
  }
  return best;
}

export function typeStepValue(i: number): { fontSize: string; lineHeight: string } {
  const s = TYPE_LADDER[Math.max(0, Math.min(TYPE_LADDER.length - 1, i))];
  return {
    fontSize: `var(--ol-text-${s.key}, ${s.size})`,
    lineHeight: `var(--ol-lh-${s.key}, ${s.lh})`,
  };
}

export interface Step {
  label: string;
  value: string;
  px: number;
}

export const PAD_STEPS: Step[] = [
  { label: "S", value: "var(--ol-space-3, 0.75rem)", px: 12 },
  { label: "M", value: "var(--ol-space-6, 1.5rem)", px: 24 },
  { label: "L", value: "var(--ol-space-10, 2.5rem)", px: 40 },
  { label: "XL", value: "var(--ol-space-16, 4rem)", px: 64 },
];

export const GAP_STEPS: Step[] = [
  { label: "S", value: "var(--ol-space-2, 0.5rem)", px: 8 },
  { label: "M", value: "var(--ol-space-4, 1rem)", px: 16 },
  { label: "L", value: "var(--ol-space-8, 2rem)", px: 32 },
  { label: "XL", value: "var(--ol-space-12, 3rem)", px: 48 },
];

// Densidad de banda — padding VERTICAL de la sección (top+bottom).
export const DENSITY_STEPS: Step[] = [
  { label: "compact", value: "var(--ol-space-12, 3rem)", px: 48 },
  { label: "normal", value: "var(--ol-space-20, 5rem)", px: 80 },
  { label: "airy", value: "var(--ol-space-28, 7rem)", px: 112 },
];

export const RADIUS_STEPS: Step[] = [
  { label: "square", value: "0", px: 0 },
  { label: "soft", value: "var(--ol-r-lg, 0.5rem)", px: 8 },
  { label: "round", value: "var(--ol-r-3xl, 1.5rem)", px: 24 },
];

export const LINE_HEIGHT_STEPS = [
  { label: "compact", value: "1.25" },
  { label: "normal", value: "1.5" },
  { label: "airy", value: "1.8" },
] as const;

export const WEIGHT_STEPS = [
  { label: "normal", value: "400" },
  { label: "medium", value: "500" },
  { label: "bold", value: "700" },
] as const;

// Roles de color — el elemento queda CONECTADO al tema (obedece Looks futuros).
export const COLOR_ROLES = [
  { id: "ink", value: "var(--ol-fg)" },
  { id: "soft", value: "var(--ol-fg-muted, color-mix(in srgb, var(--ol-fg) 70%, transparent))" },
  { id: "accent", value: "var(--ol-accent)" },
] as const;

export function nearestStep(px: number, steps: Step[]): Step {
  let best = steps[0];
  for (const s of steps) if (Math.abs(s.px - px) < Math.abs(best.px - px)) best = s;
  return best;
}
