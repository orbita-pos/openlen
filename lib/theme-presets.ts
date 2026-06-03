// Curated theme presets — coherent "looks" the inspector applies in one
// click. Each preset's `tokens` is its LIGHT bundle (5 base colors + display
// font + radius/type/space scales); the dark counterpart is derived on apply
// from the accent (`lookFromAccent`, contrast-guaranteed) so every look works
// in both modes. Fonts are limited to the ones the engine preloads (font.rs).
//
// See docs/theme-engine.md.

export type ThemeCategory = "editorial" | "minimal" | "vibrant" | "expressive";

// Display order of the category groups in the expanded picker.
export const THEME_CATEGORIES: ThemeCategory[] = [
  "editorial",
  "minimal",
  "vibrant",
  "expressive",
];

export interface ThemePreset {
  id: string;
  name: string;
  /** A blurb of the look, for the picker. */
  hint: string;
  /** Group the look belongs to, for the expanded picker. */
  category: ThemeCategory;
  /** Light-mode CSS-var → value bundle, applied verbatim onto <html>. */
  tokens: Record<string, string>;
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: "editorial",
    name: "Editorial",
    hint: "Warm cream, serif headings, generous",
    category: "editorial",
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
    category: "minimal",
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
    category: "expressive",
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
    category: "expressive",
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
  {
    id: "forest",
    name: "Forest",
    hint: "Deep green, calm and grounded",
    category: "vibrant",
    tokens: {
      "--ol-bg": "#f6faf7",
      "--ol-surface": "#ffffff",
      "--ol-fg": "#13231a",
      "--ol-border": "#dde9e1",
      "--ol-accent": "#1f9d63",
      "--ol-font-display": "'Manrope', sans-serif",
      "--ol-r-scale": "1",
      "--ol-text-scale": "1",
      "--ol-space-scale": "1.05",
    },
  },
  {
    id: "ocean",
    name: "Ocean",
    hint: "Teal, airy and modern",
    category: "vibrant",
    tokens: {
      "--ol-bg": "#f4fafb",
      "--ol-surface": "#ffffff",
      "--ol-fg": "#0e2025",
      "--ol-border": "#d8e8eb",
      "--ol-accent": "#0d8ea3",
      "--ol-font-display": "'Plus Jakarta Sans', sans-serif",
      "--ol-r-scale": "1.5",
      "--ol-text-scale": "1",
      "--ol-space-scale": "1.05",
    },
  },
  {
    id: "amber",
    name: "Amber",
    hint: "Warm gold, inviting",
    category: "editorial",
    tokens: {
      "--ol-bg": "#fffaf1",
      "--ol-surface": "#ffffff",
      "--ol-fg": "#241a0e",
      "--ol-border": "#ece0cd",
      "--ol-accent": "#d98a16",
      "--ol-font-display": "'Fraunces', serif",
      "--ol-r-scale": "1",
      "--ol-text-scale": "1.05",
      "--ol-space-scale": "1.1",
    },
  },
  {
    id: "rose",
    name: "Rose",
    hint: "Soft pink, fashion editorial",
    category: "editorial",
    tokens: {
      "--ol-bg": "#fff6f8",
      "--ol-surface": "#ffffff",
      "--ol-fg": "#2a151c",
      "--ol-border": "#f0dde3",
      "--ol-accent": "#e14d82",
      "--ol-font-display": "'Playfair Display', serif",
      "--ol-r-scale": "1.5",
      "--ol-text-scale": "1.05",
      "--ol-space-scale": "1.1",
    },
  },
  {
    id: "indigo",
    name: "Indigo",
    hint: "Deep indigo, techy and sharp",
    category: "vibrant",
    tokens: {
      "--ol-bg": "#f7f8fd",
      "--ol-surface": "#ffffff",
      "--ol-fg": "#15172b",
      "--ol-border": "#e2e4f2",
      "--ol-accent": "#4f46e5",
      "--ol-font-display": "'Space Grotesk', sans-serif",
      "--ol-r-scale": "0.75",
      "--ol-text-scale": "1",
      "--ol-space-scale": "1",
    },
  },
  {
    id: "slate",
    name: "Slate",
    hint: "Neutral graphite, corporate",
    category: "minimal",
    tokens: {
      "--ol-bg": "#f7f8fa",
      "--ol-surface": "#ffffff",
      "--ol-fg": "#11151c",
      "--ol-border": "#e2e5ea",
      "--ol-accent": "#475569",
      "--ol-font-display": "'Outfit', sans-serif",
      "--ol-r-scale": "0.75",
      "--ol-text-scale": "1",
      "--ol-space-scale": "1",
    },
  },
];
