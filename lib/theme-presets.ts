// Curated theme presets — coherent "looks" the inspector applies in one
// click. Each preset is a bundle of born-canonical token values; applying it
// sets every listed token at once (the accent's --ol-accent-r triplet is
// re-derived on apply). Light-mode looks only — dark is the separate
// light/dark toggle. Fonts are limited to the five the engine preloads.
//
// See docs/theme-engine.md.

export interface ThemePreset {
  id: string;
  name: string;
  /** A blurb of the look, for the picker. */
  hint: string;
  /** CSS-var → value, applied verbatim onto <html>. */
  tokens: Record<string, string>;
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: "editorial",
    name: "Editorial",
    hint: "Warm cream, serif headings, generous",
    tokens: {
      "--ol-bg": "#fbf8f1",
      "--ol-surface": "#ffffff",
      "--ol-fg": "#1c1a17",
      "--ol-border": "#e7e0d4",
      "--ol-accent": "#b5673e",
      "--ol-font-display": "'Fraunces', serif",
      "--ol-r-scale": "1",
      "--ol-text-scale": "1.1",
      "--ol-space-scale": "1.15",
    },
  },
  {
    id: "crisp",
    name: "Crisp",
    hint: "Clean white SaaS, tight corners",
    tokens: {
      "--ol-bg": "#ffffff",
      "--ol-surface": "#f6f7f9",
      "--ol-fg": "#0b0d12",
      "--ol-border": "#e3e6ea",
      "--ol-accent": "#2563eb",
      "--ol-font-display": "'Inter', sans-serif",
      "--ol-r-scale": "0.75",
      "--ol-text-scale": "1",
      "--ol-space-scale": "1",
    },
  },
  {
    id: "soft",
    name: "Soft",
    hint: "Lilac tint, round corners, airy",
    tokens: {
      "--ol-bg": "#fdfbff",
      "--ol-surface": "#ffffff",
      "--ol-fg": "#211d2e",
      "--ol-border": "#e9e4f2",
      "--ol-accent": "#7c5cff",
      "--ol-font-display": "'Inter', sans-serif",
      "--ol-r-scale": "2",
      "--ol-text-scale": "1",
      "--ol-space-scale": "1.15",
    },
  },
  {
    id: "bold",
    name: "Bold",
    hint: "Sharp corners, heavy ink, punchy",
    tokens: {
      "--ol-bg": "#ffffff",
      "--ol-surface": "#fafafa",
      "--ol-fg": "#000000",
      "--ol-border": "#1a1a1a",
      "--ol-accent": "#ff5a36",
      "--ol-font-display": "'Geist', sans-serif",
      "--ol-r-scale": "0",
      "--ol-text-scale": "1.1",
      "--ol-space-scale": "0.85",
    },
  },
];
