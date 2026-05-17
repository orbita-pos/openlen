// Mock landing-page HTML generator. The workspace v2 preview iframe renders
// the output of this function via srcdoc — design panel knobs feed in and
// the iframe re-paints. Mirrors the artifact's buildPreviewDoc.

import type {
  DensityValue,
  DesignState,
  Palette,
  RadiusValue,
  Section,
  TypeSystem,
} from "./mock-data";
import { PALETTE_PRESETS, generatePalette } from "@/lib/design/presets/palettes";

interface BuildArgs {
  sections: Section[];
  design: DesignState;
  palette: Palette;
  type: TypeSystem;
  inlineEdit: boolean;
  /** Pre-rendered HTML of a single primitive variant. When set, the iframe
   *  shows this instead of the mock Acme landing. Comes from /api/render-layout
   *  (server-side renderToStaticMarkup of the real primitive components). */
  layoutHtml?: string | null;
}

const RADIUS_MAP: Record<RadiusValue, string> = {
  sharp: "4px",
  soft: "10px",
  pill: "999px",
};

const DENSITY_MAP: Record<DensityValue, string> = {
  compact: "56px",
  standard: "96px",
  spacious: "144px",
};

function escapeHtml(s: unknown): string {
  return String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c] ?? c,
  );
}

// Each bg preset has an intrinsic mode (dark/light) that overrides the
// palette's mode for text contrast within the iframe. MeshGrain etc. are
// always dark; NoiseOverlay etc. are always light. The text-color CSS in
// the iframe must adapt to this, not to the palette.
const DARK_BG_PRESETS = new Set([
  "mesh-grain",
  "conic-sweep",
  "blob-burst",
  "animated-mesh",
]);

export function bgModeFor(bgId: string): "dark" | "light" {
  return DARK_BG_PRESETS.has(bgId) ? "dark" : "light";
}

// Iframe BG CSS mirroring the real lib/design/presets/backgrounds components.
// The thumb in the design panel renders the actual React component; this is
// the CSS approximation that runs inside the srcdoc iframe. Visually close
// enough that switching from thumb → preview feels continuous. Keys match
// BACKGROUND_PRESETS[i].id from lib/design/presets/backgrounds.tsx.
function bgCss(design: DesignState): string {
  const h = design.hue;
  switch (design.bg) {
    case "mesh-grain":
      return `radial-gradient(60% 50% at 18% 30%, oklch(58% 0.22 ${h}) 0%, transparent 60%), radial-gradient(50% 45% at 82% 24%, oklch(55% 0.20 ${(h + 40) % 360}) 0%, transparent 60%), radial-gradient(55% 60% at 70% 80%, oklch(50% 0.18 ${(h + 320) % 360}) 0%, transparent 60%), radial-gradient(40% 35% at 30% 75%, oklch(45% 0.16 ${(h + 180) % 360}) 0%, transparent 60%), oklch(11% 0.015 ${h})`;
    case "conic-sweep":
      return `conic-gradient(from 200deg at 50% 50%, oklch(11% 0.01 ${h}), oklch(60% 0.22 ${h}), oklch(55% 0.20 ${(h + 90) % 360}), oklch(50% 0.18 ${(h + 200) % 360}), oklch(60% 0.22 ${h}), oklch(11% 0.01 ${h}))`;
    case "blob-burst":
      return `radial-gradient(60% 60% at 30% 30%, oklch(62% 0.24 ${h} / 0.6), transparent 70%), radial-gradient(50% 50% at 80% 90%, oklch(55% 0.20 ${(h + 60) % 360} / 0.55), transparent 70%), radial-gradient(40% 40% at 60% 50%, oklch(50% 0.18 ${(h + 280) % 360} / 0.5), transparent 70%), oklch(11% 0.01 ${h})`;
    case "noise-overlay":
      return `oklch(96% 0.025 ${h})`;
    case "animated-mesh":
      return `radial-gradient(45% 40% at 30% 30%, oklch(60% 0.22 ${h}) 0%, transparent 60%), radial-gradient(50% 45% at 70% 30%, oklch(55% 0.20 ${(h + 50) % 360}) 0%, transparent 60%), radial-gradient(55% 50% at 50% 75%, oklch(50% 0.18 ${(h + 280) % 360}) 0%, transparent 60%), oklch(11% 0.015 ${h})`;
    case "brand-pattern":
      return `oklch(98% 0.005 ${h})`;
    case "minimal-solid":
    default:
      return `oklch(98% 0.005 ${h})`;
  }
}

function decorationCss(design: DesignState): string {
  if (design.decoration === "minimal") return "";
  const h = design.hue;
  if (design.decoration === "balanced") {
    return `background: radial-gradient(40% 40% at 80% 12%, oklch(80% 0.16 ${(h + 50) % 360} / 0.18), transparent 70%);`;
  }
  return `background: radial-gradient(40% 40% at 80% 12%, oklch(80% 0.16 ${(h + 50) % 360} / 0.32), transparent 70%), radial-gradient(40% 40% at 12% 88%, oklch(75% 0.18 ${h} / 0.28), transparent 70%);`;
}

interface SectionFields {
  [k: string]: unknown;
}

function fieldStr(fields: SectionFields, key: string): string {
  const v = fields[key];
  return typeof v === "string" ? v : "";
}

function fieldArray<T>(fields: SectionFields, key: string): T[] {
  const v = fields[key];
  return Array.isArray(v) ? (v as T[]) : [];
}

export function buildPreviewDoc({
  sections,
  design,
  palette,
  type,
  inlineEdit,
  layoutHtml,
}: BuildArgs): string {
  const radiusVal = RADIUS_MAP[design.radius];
  const densityPad = DENSITY_MAP[design.density];
  const padPx = Number.parseInt(densityPad, 10);
  const editAttr = inlineEdit ? `class="inline-edit-target"` : "";

  // When a layout is selected (one of the 17 primitive variants), the iframe
  // shows that primitive standalone, rendered server-side via
  // /api/render-layout. The primitive components consume the canonical design
  // tokens (--color-bg, --color-fg, --color-accent, etc.) so we derive them
  // from the active palette + typography + radius + density here.
  const useLayout = Boolean(layoutHtml);
  const paletteSpec = PALETTE_PRESETS.find((p) => p.id === design.paletteId);
  const fullPalette = paletteSpec
    ? generatePalette(paletteSpec.brandHue, paletteSpec.mode)
    : generatePalette(design.hue, "light");
  const primitiveTokens = useLayout
    ? `
    --color-bg:                ${fullPalette.bg};
    --color-fg:                ${fullPalette.fg};
    --color-text-muted:        ${fullPalette.fgMuted};
    --color-text-dim:          ${fullPalette.fgDim};
    --color-surface:           ${fullPalette.surface};
    --color-surface-elevated:  ${fullPalette.surfaceElevated};
    --color-border:            ${fullPalette.border};
    --color-border-strong:     ${fullPalette.borderStrong};
    --color-accent:            ${fullPalette.accent};
    --color-accent-strong:     ${fullPalette.accent};
    --color-accent-soft:       ${fullPalette.surfaceElevated};
    --color-accent-fg:         ${fullPalette.accentFg};
    --font-display:            ${type.family};
    --font-body:               ${type.family};
    --space-section:           ${densityPad};
    --radius:                  ${radiusVal};
    `
    : "";

  const hero = sections.find((s) => s.id === "hero");
  const logobar = sections.find((s) => s.id === "logobar");
  const features = sections.find((s) => s.id === "features");
  const pricing = sections.find((s) => s.id === "pricing");
  const faq = sections.find((s) => s.id === "faq");

  const isDarkBg = bgModeFor(design.bg) === "dark";
  const h = design.hue;

  // Text + surface tokens adapt to whether the chosen bg preset is dark or
  // light. Without this, dark bgs (MeshGrain, ConicSweep, HalftoneDots,
  // BlobBurst, AnimatedMesh) render dark text on dark bg = invisible.
  const styleVars = `
    --brand: ${palette.brand};
    --accent: ${palette.accent};
    --neutral: ${palette.neutral};
    --text-strong: ${isDarkBg ? `oklch(96% 0.005 ${h})` : `oklch(18% 0.012 ${h})`};
    --text-muted:  ${isDarkBg ? `oklch(78% 0.015 ${h})` : `oklch(42% 0.012 ${h})`};
    --text-dim:    ${isDarkBg ? `oklch(60% 0.018 ${h})` : `oklch(58% 0.012 ${h})`};
    --on-accent:   ${isDarkBg ? `oklch(15% 0.012 ${h})` : `oklch(99% 0.005 ${h})`};
    --surface:     ${isDarkBg ? `oklch(18% 0.018 ${h} / 0.45)` : `oklch(99% 0.005 ${h} / 0.55)`};
    --surface-elev:${isDarkBg ? `oklch(22% 0.022 ${h})` : `oklch(99% 0.005 ${h})`};
    --border:      ${isDarkBg ? `oklch(32% 0.018 ${h})` : `oklch(86% 0.01 ${h})`};
    --border-soft: ${isDarkBg ? `oklch(28% 0.014 ${h})` : `oklch(88% 0.01 ${h})`};
    --radius: ${radiusVal};
    --pad: ${densityPad};
    --font: ${type.family};
    --tracking: ${type.tracking};
  `;

  const heroHeading = hero
    ? fieldStr(hero.fields, "heading").replace(
        / in one /,
        ' in <span class="accent">one</span> ',
      )
    : "";

  const logobarLogos = logobar ? fieldArray<string>(logobar.fields, "logos") : [];
  const featuresItems = features
    ? fieldArray<{ title: string; body: string }>(features.fields, "items")
    : [];
  const pricingTiers = pricing
    ? fieldArray<{ name: string; price: string; blurb: string; featured?: boolean }>(
        pricing.fields,
        "tiers",
      )
    : [];
  const faqItems = faq
    ? fieldArray<{ q: string; a: string }>(faq.fields, "items")
    : [];

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=1280">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter+Tight:ital,wght@0,400..700;1,400..700&family=Inter:wght@400;500;600;700&family=Geist:wght@400;500;600;700&family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;500;600&family=Fraunces:opsz,wght@9..144,400;9..144,600&family=Crimson+Pro:wght@400;600&display=swap" rel="stylesheet">
${useLayout ? '<script src="https://cdn.tailwindcss.com"></script>' : ""}
<style>
  *,*::before,*::after { box-sizing: border-box; }
  html,body { margin: 0; padding: 0; }
  :root { ${primitiveTokens} }
  body {
    ${styleVars}
    font-family: var(--font);
    letter-spacing: var(--tracking);
    background: ${bgCss(design)};
    color: var(--text-strong);
    min-height: 100vh;
  }
  /* Bridge for primitives: the Slot helper emits data-slot-path spans —
     keep them as inline plaintext so the layout reads naturally. */
  [data-slot-path] { display: inline; }
  /* Tailwind shorthands the primitives rely on (when rendered without the
     real Tailwind runtime in the iframe). */
  .font-display { font-family: var(--font-display); }
  .font-body    { font-family: var(--font-body); }
  .font-mono    { font-family: ui-monospace, 'JetBrains Mono', monospace; }
  .text-balance { text-wrap: balance; }
  .text-pretty  { text-wrap: pretty; }
  .container { max-width: 1080px; margin: 0 auto; padding: 0 32px; }
  nav { padding: 22px 32px; display: flex; align-items: center; justify-content: space-between; }
  nav .brand { display: inline-flex; align-items: center; gap: 8px; font-weight: 700; font-size: 15px; color: var(--text-strong); }
  nav .brand .mark { width: 22px; height: 22px; border-radius: 6px; background: var(--brand); display: inline-flex; align-items: center; justify-content: center; color: var(--on-accent); font-size: 11px; }
  nav .links { display: flex; gap: 24px; font-size: 13px; color: var(--text-muted); }
  nav .links span { cursor: pointer; }
  nav .cta { display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: var(--radius); background: var(--brand); color: var(--on-accent); font-weight: 500; font-size: 12.5px; text-decoration: none; }
  section.hero { padding: 80px 32px ${padPx}px; max-width: 1080px; margin: 0 auto; text-align: center; }
  .eyebrow { display: inline-flex; align-items: center; gap: 8px; padding: 4px 10px; border-radius: 999px; background: var(--surface); border: 1px solid var(--border); font-size: 11.5px; color: var(--text-muted); margin-bottom: 22px; backdrop-filter: blur(4px); }
  .eyebrow .ne { padding: 2px 8px; border-radius: 999px; background: var(--brand); color: var(--on-accent); font-size: 10px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; }
  h1.headline { font-family: var(--font); letter-spacing: var(--tracking); font-weight: 700; font-size: 64px; line-height: 1.02; margin: 0 0 18px; color: var(--text-strong); }
  h1.headline .accent { color: var(--brand); }
  p.subhead { font-size: 18px; line-height: 1.55; color: var(--text-muted); max-width: 560px; margin: 0 auto 32px; }
  .cta-row { display: inline-flex; gap: 10px; }
  .btn-primary { display: inline-flex; align-items: center; gap: 6px; padding: 10px 18px; border-radius: var(--radius); background: var(--brand); color: var(--on-accent); font-weight: 600; font-size: 13.5px; text-decoration: none; }
  .btn-ghost { display: inline-flex; align-items: center; gap: 6px; padding: 10px 18px; border-radius: var(--radius); background: transparent; color: var(--text-strong); border: 1px solid var(--border); font-weight: 500; font-size: 13.5px; text-decoration: none; }
  section.logobar { padding: 0 32px 64px; max-width: 1080px; margin: 0 auto; text-align: center; }
  .logobar .caption { font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.18em; color: var(--text-dim); font-weight: 600; margin-bottom: 18px; }
  .logobar .logos { display: flex; align-items: center; justify-content: center; gap: 40px; flex-wrap: wrap; opacity: 0.55; color: var(--text-strong); }
  .logobar .logos span { font-family: 'Geist', sans-serif; font-weight: 600; font-size: 16px; letter-spacing: -0.02em; }
  section.features { padding: ${padPx}px 32px; max-width: 1080px; margin: 0 auto; }
  .features-head { max-width: 520px; margin-bottom: 48px; }
  .features-head .eb2 { font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.18em; color: var(--brand); font-weight: 600; margin-bottom: 10px; }
  .features-head h2 { font-size: 36px; font-weight: 700; line-height: 1.1; margin: 0; color: var(--text-strong); }
  .feat-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
  .feat-card { padding: 20px; border-radius: var(--radius); background: var(--surface); border: 1px solid var(--border); }
  .feat-card .num { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border-radius: var(--radius); background: var(--brand); color: var(--on-accent); font-weight: 700; font-size: 12px; }
  .feat-card .ftitle { margin-top: 14px; font-weight: 600; font-size: 14.5px; color: var(--text-strong); }
  .feat-card .fbody { margin-top: 6px; font-size: 13px; color: var(--text-muted); line-height: 1.55; }
  section.pricing { padding: ${padPx}px 32px; max-width: 980px; margin: 0 auto; text-align: center; }
  .pricing h2 { font-size: 36px; font-weight: 700; line-height: 1.1; margin: 0 0 36px; color: var(--text-strong); }
  .price-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; text-align: left; }
  .tier { padding: 22px; border-radius: var(--radius); background: var(--surface); border: 1px solid var(--border); color: var(--text-strong); }
  .tier.featured { border-color: var(--brand); box-shadow: 0 0 0 3px oklch(75% 0.18 ${h} / 0.15); }
  .tier .tname { text-transform: uppercase; letter-spacing: 0.16em; font-size: 11px; font-weight: 600; color: var(--text-muted); }
  .tier.featured .tname { color: var(--brand); }
  .tier .tprice { font-size: 36px; font-weight: 700; letter-spacing: -0.02em; margin-top: 10px; color: var(--text-strong); }
  .tier .tprice small { font-size: 14px; color: var(--text-muted); font-weight: 400; margin-left: 2px; }
  .tier .tblurb { margin-top: 6px; font-size: 12.5px; color: var(--text-muted); }
  .tier .tcta { display: inline-block; margin-top: 18px; padding: 8px 14px; border-radius: var(--radius); font-weight: 500; font-size: 12.5px; text-decoration: none; }
  .tier .tcta.plain { background: transparent; border: 1px solid var(--border); color: var(--text-strong); }
  .tier .tcta.solid { background: var(--brand); color: var(--on-accent); }
  section.faq { padding: ${padPx}px 32px; max-width: 760px; margin: 0 auto; }
  .faq h2 { font-size: 32px; font-weight: 700; line-height: 1.1; margin: 0 0 28px; text-align: center; color: var(--text-strong); }
  .faq .qa { padding: 18px 0; border-top: 1px solid var(--border-soft); }
  .faq .qa:last-child { border-bottom: 1px solid var(--border-soft); }
  .faq .q { font-weight: 600; font-size: 15px; color: var(--text-strong); }
  .faq .a { margin-top: 6px; font-size: 13.5px; color: var(--text-muted); line-height: 1.55; }
  footer { padding: 36px 32px 28px; max-width: 1080px; margin: 0 auto; font-size: 12px; color: var(--text-dim); display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--border-soft); margin-top: ${padPx}px; }
  .inline-edit-target { transition: outline 100ms ease, background 100ms ease; }
  .inline-edit-target:hover { outline: 1px dashed var(--brand); outline-offset: 3px; background: oklch(60% 0.10 ${h} / 0.18); cursor: text; }
  body::before {
    content: ""; position: fixed; inset: 0; pointer-events: none; z-index: 0;
    ${decorationCss(design)}
  }
  main { position: relative; z-index: 1; }
</style></head><body>
<main>
  ${useLayout ? layoutHtml : `
  <nav>
    <div class="brand">
      <span class="mark">A</span>
      <span ${editAttr}>Acme</span>
    </div>
    <div class="links">
      <span ${editAttr}>Features</span>
      <span ${editAttr}>Pricing</span>
      <span ${editAttr}>Docs</span>
      <span ${editAttr}>Sign in</span>
    </div>
    <a class="cta" href="#" ${editAttr}>Start free →</a>
  </nav>
  ${
    hero
      ? `<section class="hero">
    <span class="eyebrow"><span class="ne">New</span><span ${editAttr}>${escapeHtml(fieldStr(hero.fields, "eyebrow"))}</span></span>
    <h1 class="headline"><span ${editAttr}>${heroHeading}</span></h1>
    <p class="subhead" ${editAttr}>${escapeHtml(fieldStr(hero.fields, "subheading"))}</p>
    <div class="cta-row">
      <a class="btn-primary" href="#"><span ${editAttr}>${escapeHtml(fieldStr(hero.fields, "ctaPrimaryLabel"))}</span> →</a>
      <a class="btn-ghost" href="#"><span ${editAttr}>${escapeHtml(fieldStr(hero.fields, "ctaSecondaryLabel"))}</span> ▸</a>
    </div>
  </section>`
      : ""
  }
  ${
    logobar
      ? `<section class="logobar">
    <div class="caption" ${editAttr}>${escapeHtml(fieldStr(logobar.fields, "caption"))}</div>
    <div class="logos">${logobarLogos
      .map((l) => `<span ${editAttr}>${escapeHtml(l)}</span>`)
      .join("")}</div>
  </section>`
      : ""
  }
  ${
    features
      ? `<section class="features">
    <div class="features-head">
      <div class="eb2" ${editAttr}>${escapeHtml(fieldStr(features.fields, "eyebrow"))}</div>
      <h2 ${editAttr}>${escapeHtml(fieldStr(features.fields, "heading"))}</h2>
    </div>
    <div class="feat-grid">
      ${featuresItems
        .map(
          (it, i) => `
        <div class="feat-card">
          <div class="num">0${i + 1}</div>
          <div class="ftitle" ${editAttr}>${escapeHtml(it.title)}</div>
          <div class="fbody" ${editAttr}>${escapeHtml(it.body)}</div>
        </div>`,
        )
        .join("")}
    </div>
  </section>`
      : ""
  }
  ${
    pricing
      ? `<section class="pricing">
    <h2 ${editAttr}>${escapeHtml(fieldStr(pricing.fields, "heading"))}</h2>
    <div class="price-grid">
      ${pricingTiers
        .map(
          (t) => `
        <div class="tier ${t.featured ? "featured" : ""}">
          <div class="tname" ${editAttr}>${escapeHtml(t.name)}</div>
          <div class="tprice">${escapeHtml(t.price)}<small>/mo</small></div>
          <div class="tblurb" ${editAttr}>${escapeHtml(t.blurb)}</div>
          <a class="tcta ${t.featured ? "solid" : "plain"}" href="#">Start free →</a>
        </div>`,
        )
        .join("")}
    </div>
  </section>`
      : ""
  }
  ${
    faq
      ? `<section class="faq">
    <h2 ${editAttr}>${escapeHtml(fieldStr(faq.fields, "heading"))}</h2>
    ${faqItems
      .map(
        (it) => `
      <div class="qa">
        <div class="q" ${editAttr}>${escapeHtml(it.q)}</div>
        <div class="a" ${editAttr}>${escapeHtml(it.a)}</div>
      </div>`,
      )
      .join("")}
  </section>`
      : ""
  }
  <footer>
    <span>© 2026 Acme · Built with OpenLen</span>
    <span style="font-family: 'JetBrains Mono', monospace;">acme.openlen.com</span>
  </footer>
  `}
</main>
</body></html>`;
}
