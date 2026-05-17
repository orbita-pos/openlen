// 6 hand-tuned typography systems, each with one intentional rule-break.
// Ported from claude.ai typography-systems artifact (May 2026).
//
// Each system defines a complete type stack: families, weights, tracking,
// leading, modular scale. The "ruleBreak" field describes the one
// intentional outlier that makes the system feel hand-designed rather than
// templated.

export interface TypographyScale {
  xs: number;
  sm: number;
  base: number;
  lg: number;
  xl: number;
  "2xl": number;
  "3xl": number;
  "4xl": number;
  "5xl": number;
}

export interface TypographySpec {
  id: string;
  name: string;
  /** CSS class to apply for this system (matches CSS preset below). */
  cls: string;
  displayFamily: string;
  bodyFamily: string;
  displayWeight: number;
  bodyWeight: number;
  displayTracking: string;
  bodyTracking: string;
  leading: number;
  scale: number;
  opticalSizing: boolean;
  /** Human-readable description of the one rule-break this system uses. */
  ruleBreak: string;
  /** Short personality blurb shown in the UI. */
  personality: string;
  sizes: TypographyScale;
}

export const TYPOGRAPHY_PRESETS: TypographySpec[] = [
  {
    id: "inter-tight",
    name: "Inter Tight",
    cls: "sys-inter",
    displayFamily: "'Inter Tight', sans-serif",
    bodyFamily: "'Inter', sans-serif",
    displayWeight: 600,
    bodyWeight: 400,
    displayTracking: "-0.025em",
    bodyTracking: "0em",
    leading: 1.5,
    scale: 1.25,
    opticalSizing: true,
    ruleBreak: "H1 tracks one notch tighter than the rest of display (-0.04em vs -0.025em).",
    personality: "Confident, technical, breath-tight. The default of careful Vercel/Linear-class product pages.",
    sizes: { xs: 12, sm: 15, base: 19, lg: 24, xl: 30, "2xl": 37.5, "3xl": 47, "4xl": 58, "5xl": 73 },
  },
  {
    id: "geist-editorial",
    name: "Geist Editorial",
    cls: "sys-geist",
    displayFamily: "'Geist', sans-serif",
    bodyFamily: "'Geist', sans-serif",
    displayWeight: 500,
    bodyWeight: 400,
    displayTracking: "-0.02em",
    bodyTracking: "0em",
    leading: 1.6,
    scale: 1.2,
    opticalSizing: false,
    ruleBreak: "H2s jump to weight 700 — one weight outlier in an otherwise 500-display hierarchy.",
    personality: "Modern, slightly editorial, dev-tool credible. Hierarchy from weight, not size.",
    sizes: { xs: 12, sm: 14.4, base: 17.3, lg: 20.7, xl: 24.9, "2xl": 29.9, "3xl": 35.8, "4xl": 43, "5xl": 51.6 },
  },
  {
    id: "sohne-warm",
    name: "Söhne Warm",
    cls: "sys-sohne",
    displayFamily: "'Inter', sans-serif",
    bodyFamily: "'Inter', sans-serif",
    displayWeight: 600,
    bodyWeight: 400,
    displayTracking: "-0.015em",
    bodyTracking: "0em",
    leading: 1.55,
    scale: 1.333,
    opticalSizing: true,
    ruleBreak: "One body element per section runs italic — a quote/aside outlier. Dramatic 1.333 scale.",
    personality: "Refined, editorial, premium. Stripe/Resend tone — big display, calm body.",
    sizes: { xs: 12, sm: 16, base: 21.3, lg: 28.4, xl: 37.9, "2xl": 50.5, "3xl": 67.3, "4xl": 89.7, "5xl": 96 },
  },
  {
    id: "jetbrains-accent",
    name: "JetBrains Mono Accent",
    cls: "sys-mono",
    displayFamily: "'JetBrains Mono', monospace",
    bodyFamily: "'Inter', sans-serif",
    displayWeight: 500,
    bodyWeight: 400,
    displayTracking: "-0.01em",
    bodyTracking: "0em",
    leading: 1.55,
    scale: 1.2,
    opticalSizing: false,
    ruleBreak: "Mono headlines on non-mono body. That IS the rule-break. Devtool signature.",
    personality: "Terminal-honest, developer-respect. Sub-30 audience knows what this means.",
    sizes: { xs: 12, sm: 14.4, base: 17.3, lg: 20.7, xl: 24.9, "2xl": 29.9, "3xl": 35.8, "4xl": 43, "5xl": 51.6 },
  },
  {
    id: "fraunces-editorial",
    name: "Fraunces Editorial",
    cls: "sys-fraunces",
    displayFamily: "'Fraunces', serif",
    bodyFamily: "'Inter', sans-serif",
    displayWeight: 500,
    bodyWeight: 400,
    displayTracking: "-0.02em",
    bodyTracking: "0em",
    leading: 1.6,
    scale: 1.25,
    opticalSizing: true,
    ruleBreak: "H2 tier runs italic — adds magazine feel without italicizing the whole display.",
    personality: "Editorial, slightly haute, magazine cover. opsz=144 on display sizes.",
    sizes: { xs: 12, sm: 15, base: 19, lg: 24, xl: 30, "2xl": 37.5, "3xl": 47, "4xl": 58, "5xl": 73 },
  },
  {
    id: "crimson-print",
    name: "Crimson Print",
    cls: "sys-crimson",
    displayFamily: "'Crimson Pro', serif",
    bodyFamily: "'Crimson Pro', serif",
    displayWeight: 600,
    bodyWeight: 400,
    displayTracking: "0em",
    bodyTracking: "+0.005em",
    leading: 1.7,
    scale: 1.2,
    opticalSizing: false,
    ruleBreak: "Body tracking +0.005em — opposite direction from the other five. Long-read setting.",
    personality: "Print-magazine, considered, long-read. Best on text-heavy launch essays, not SaaS marketing.",
    sizes: { xs: 12, sm: 14.4, base: 18.5, lg: 22.2, xl: 26.6, "2xl": 32, "3xl": 38.4, "4xl": 46, "5xl": 55.3 },
  },
];

export function getTypography(id: string): TypographySpec | undefined {
  return TYPOGRAPHY_PRESETS.find(t => t.id === id);
}

// CSS preamble: emits all 6 system class definitions as a single <style> block.
// Used by the preview route + the workspace iframe to switch typography by
// toggling a class on a wrapper div.
export function buildTypographyStylesheet(): string {
  return TYPOGRAPHY_PRESETS.map(s => {
    const sizes = s.sizes;
    const opsz = s.opticalSizing ? "font-optical-sizing: auto;" : "";
    return `
.${s.cls} {
  --display-family: ${s.displayFamily};
  --body-family:    ${s.bodyFamily};
  --display-weight: ${s.displayWeight};
  --body-weight:    ${s.bodyWeight};
  --display-tracking: ${s.displayTracking};
  --body-tracking:    ${s.bodyTracking};
  --leading:          ${s.leading};
  --text-xs:   ${sizes.xs}px;
  --text-sm:   ${sizes.sm}px;
  --text-base: ${sizes.base}px;
  --text-lg:   ${sizes.lg}px;
  --text-xl:   ${sizes.xl}px;
  --text-2xl:  ${sizes["2xl"]}px;
  --text-3xl:  ${sizes["3xl"]}px;
  --text-4xl:  ${sizes["4xl"]}px;
  --text-5xl:  ${sizes["5xl"]}px;
  ${opsz}
  font-family: var(--body-family);
  font-weight: var(--body-weight);
  letter-spacing: var(--body-tracking);
  line-height: var(--leading);
}
${ruleBreakCSS(s)}
`.trim();
  }).join("\n\n");
}

// Per-system rule-break CSS — applied via the system class.
function ruleBreakCSS(s: TypographySpec): string {
  switch (s.id) {
    case "inter-tight":
      return `.${s.cls} h1, .${s.cls} .s-h1 { letter-spacing: -0.04em; }`;
    case "geist-editorial":
      return `.${s.cls} h2, .${s.cls} .s-h2 { font-weight: 700; letter-spacing: -0.025em; }`;
    case "sohne-warm":
      return `.${s.cls} .s-aside { font-style: italic; }`;
    case "jetbrains-accent":
      return `.${s.cls} h1, .${s.cls} .s-h1 { letter-spacing: -0.04em; line-height: 1.0; }
.${s.cls} h2, .${s.cls} .s-h2 { letter-spacing: -0.02em; }`;
    case "fraunces-editorial":
      return `.${s.cls} h1, .${s.cls} h2, .${s.cls} .s-h1, .${s.cls} .s-h2 {
  font-variation-settings: "opsz" 144, "SOFT" 30;
  font-optical-sizing: auto;
}
.${s.cls} h2, .${s.cls} .s-h2 {
  font-style: italic;
  font-weight: 400;
  letter-spacing: -0.025em;
}`;
    default:
      return "";
  }
}
