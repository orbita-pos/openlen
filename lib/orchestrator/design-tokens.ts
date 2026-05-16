// ─────────────────────────────────────────────────────────────────────────────
// Design tokens — the hardcoded palette + type + spacing system the AI MUST
// use. The AI never picks a colour; it picks one of five palettes (or has
// one picked for it by `selectPalette`).
//
// Source of truth: INARI_DESIGN_ENGINE.md § 3. Values here are normative —
// changing them changes how every generated page looks.
// ─────────────────────────────────────────────────────────────────────────────

export type PaletteName =
  | "mono-dark"
  | "indigo-dark"
  | "emerald-dark"
  | "warm-dark"
  | "mono-light";

export type AestheticDirection =
  | "technical-minimal"
  | "refined-editorial"
  | "warm-humanist"
  | "editorial-maximalist"
  | "brutalist-technical";

export interface Palette {
  name: PaletteName;
  accent: string;
  accentHover: string;
  /** Foreground colour drawn on top of `accent`. */
  accentFg: string;
  bg: string;
  surface: string;
  surfaceElevated: string;
  border: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  textDim: string;
  /** Aesthetic directions this palette pairs well with (master prompt default). */
  aestheticDirections: AestheticDirection[];
}

export const PALETTES: Record<PaletteName, Palette> = {
  "mono-dark": {
    name: "mono-dark",
    accent: "#FFFFFF",
    accentHover: "#EAEAEA",
    accentFg: "#000000",
    bg: "#000000",
    surface: "#0A0A0A",
    surfaceElevated: "#171717",
    border: "#262626",
    borderStrong: "#404040",
    text: "#FAFAFA",
    textMuted: "#A1A1AA",
    textDim: "#52525B",
    aestheticDirections: ["technical-minimal", "brutalist-technical"],
  },
  "indigo-dark": {
    name: "indigo-dark",
    accent: "#5E6AD2",
    accentHover: "#7B85DC",
    accentFg: "#FFFFFF",
    bg: "#08090A",
    surface: "#101113",
    surfaceElevated: "#1A1B1F",
    border: "#222326",
    borderStrong: "#2E2F33",
    text: "#F4F5F8",
    textMuted: "#8A8F98",
    textDim: "#62666D",
    aestheticDirections: ["technical-minimal", "refined-editorial"],
  },
  "emerald-dark": {
    name: "emerald-dark",
    accent: "#3ECF8E",
    accentHover: "#3FB57B",
    accentFg: "#0F0F0F",
    bg: "#0F0F0F",
    surface: "#171717",
    surfaceElevated: "#1F1F1F",
    border: "#2E2E2E",
    borderStrong: "#393939",
    text: "#EDEDED",
    textMuted: "#A0A0A0",
    textDim: "#6B6B6B",
    aestheticDirections: ["technical-minimal", "brutalist-technical"],
  },
  "warm-dark": {
    name: "warm-dark",
    accent: "#F97316",
    accentHover: "#FB923C",
    accentFg: "#0A0A0A",
    bg: "#0A0A0A",
    surface: "#141414",
    surfaceElevated: "#1F1F1F",
    border: "#262626",
    borderStrong: "#3F3F46",
    text: "#FAFAF9",
    textMuted: "#A8A29E",
    textDim: "#78716C",
    aestheticDirections: ["refined-editorial", "warm-humanist"],
  },
  "mono-light": {
    name: "mono-light",
    accent: "#141414",
    accentHover: "#3F3F46",
    accentFg: "#FFFFFF",
    bg: "#FFFFFF",
    surface: "#FAFAFA",
    surfaceElevated: "#F4F4F5",
    border: "#E4E4E7",
    borderStrong: "#D4D4D8",
    text: "#0A0A0A",
    textMuted: "#52525B",
    textDim: "#A1A1AA",
    aestheticDirections: ["refined-editorial", "warm-humanist"],
  },
};

export const TYPOGRAPHY = {
  fontFamily: {
    sans: '"Inter Variable", "Geist Sans", ui-sans-serif, system-ui, sans-serif',
    display:
      '"Inter Display", "Inter Variable", "Geist Sans", system-ui, sans-serif',
    mono: '"Geist Mono", "JetBrains Mono", ui-monospace, monospace',
  },
  // Banned as PRIMARY fonts — the master prompt forbids picking these. Listed
  // here so callers can introspect (e.g. lint rules, future config UI).
  bannedFonts: [
    "Roboto",
    "Arial",
    "Open Sans",
    "Helvetica",
    "Space Grotesk",
    "Plus Jakarta Sans",
    "IBM Plex Sans",
    "system-ui (as primary)",
  ],
} as const;

export const TYPE_SCALE = {
  "display-xl": {
    size: "96px",
    lineHeight: "1.0",
    letterSpacing: "-0.04em",
    fontWeight: 600,
  },
  "display-lg": {
    size: "72px",
    lineHeight: "1.05",
    letterSpacing: "-0.035em",
    fontWeight: 600,
  },
  "display-md": {
    size: "56px",
    lineHeight: "1.1",
    letterSpacing: "-0.03em",
    fontWeight: 600,
  },
  h1: {
    size: "48px",
    lineHeight: "1.15",
    letterSpacing: "-0.025em",
    fontWeight: 600,
  },
  h2: {
    size: "36px",
    lineHeight: "1.2",
    letterSpacing: "-0.02em",
    fontWeight: 600,
  },
  h3: {
    size: "24px",
    lineHeight: "1.3",
    letterSpacing: "-0.015em",
    fontWeight: 600,
  },
  h4: {
    size: "20px",
    lineHeight: "1.4",
    letterSpacing: "-0.01em",
    fontWeight: 500,
  },
  "body-lg": {
    size: "18px",
    lineHeight: "1.55",
    letterSpacing: "-0.005em",
    fontWeight: 400,
  },
  body: {
    size: "16px",
    lineHeight: "1.6",
    letterSpacing: "0",
    fontWeight: 400,
  },
  "body-sm": {
    size: "14px",
    lineHeight: "1.55",
    letterSpacing: "0",
    fontWeight: 400,
  },
  caption: {
    size: "13px",
    lineHeight: "1.5",
    letterSpacing: "0.005em",
    fontWeight: 500,
  },
  label: {
    size: "12px",
    lineHeight: "1.4",
    letterSpacing: "0.04em",
    fontWeight: 500,
    textTransform: "uppercase" as const,
  },
} as const;

export const SPACING = {
  sectionYSm: "64px",
  sectionY: "96px",
  sectionYLg: "128px",
  sectionYXl: "160px",
  contentMaxWidth: "1280px",
  heroCopyMaxWidth: "720px",
  sectionCopyMaxWidth: "640px",
} as const;

export const SHADOWS = {
  xs: "0 1px 2px 0 rgba(0,0,0,0.04)",
  sm: "0 1px 3px 0 rgba(0,0,0,0.06), 0 1px 2px 0 rgba(0,0,0,0.04)",
  md: "0 4px 8px -2px rgba(0,0,0,0.08), 0 2px 4px -2px rgba(0,0,0,0.04)",
  lg: "0 12px 24px -4px rgba(0,0,0,0.12), 0 4px 8px -2px rgba(0,0,0,0.06)",
  xl: "0 24px 48px -8px rgba(0,0,0,0.16), 0 8px 16px -4px rgba(0,0,0,0.08)",
  mockupDark:
    "0 32px 64px -16px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.08)",
  mockupLight:
    "0 32px 64px -16px rgba(0,0,0,0.18), 0 0 0 1px rgba(0,0,0,0.06)",
} as const;

export const RADIUS = {
  none: "0",
  sm: "4px",
  default: "6px",
  md: "8px",
  lg: "10px",
  xl: "12px",
  full: "9999px",
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Palette selection — given an Intent's loose signals (industry / audience /
// tone / free-form goals), pick the palette that fits best.
//
// Order matters: more specific signals fire first. The "default" branch is
// mono-dark (Vercel-class, the safest universal choice).
// ─────────────────────────────────────────────────────────────────────────────

export interface PaletteSignal {
  industry?: string;
  audience?: string;
  tone?: string;
  signals?: string[];
}

export function selectPalette(intent: PaletteSignal): PaletteName {
  const combined = [
    intent.industry ?? "",
    intent.audience ?? "",
    intent.tone ?? "",
    ...(intent.signals ?? []),
  ]
    .join(" ")
    .toLowerCase();

  if (/dev\s?tool|api|sdk|cli|developer|infrastructure|database|backend/.test(combined)) {
    return "emerald-dark";
  }
  if (/creative|editorial|blog|magazine|publication|media|newsletter|writing|content/.test(combined)) {
    return "warm-dark";
  }
  if (/scheduling|calendar|productivity|task|notes|todo|minimal|simple/.test(combined)) {
    return "mono-light";
  }
  if (/design\s?tool|whiteboard|collab|planning|project\s?management|kanban/.test(combined)) {
    return "indigo-dark";
  }
  return "mono-dark";
}
