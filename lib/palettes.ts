// Curated palettes — visual swatches the inspector applies in one click.
// Each is a bundle of born-canonical color tokens (`--ol-bg`, `--ol-surface`,
// `--ol-fg`, `--ol-border`, `--ol-accent`). Light-mode values; dark is
// auto-derived by the normalizer chain. The accent's `--ol-accent-r` RGB
// triplet is re-derived on apply by the iframe handler.

export interface Palette {
  id: string;
  name: string;
  hint: string;
  /** Hex shown in the swatch — the accent for visual identification. */
  swatch: string;
  /** Light-mode token bundle. */
  tokens: Record<string, string>;
}

export const PALETTES: Palette[] = [
  // Warm / coral
  {
    id: "coral",
    name: "Coral",
    hint: "Cálido marca OpenLen",
    swatch: "#ff6b3d",
    tokens: { "--ol-bg": "#fffaf7", "--ol-surface": "#ffffff", "--ol-fg": "#1f1410", "--ol-border": "#f1e4dc", "--ol-accent": "#ff6b3d" },
  },
  {
    id: "marfil",
    name: "Marfil",
    hint: "Crema editorial, cálido",
    swatch: "#b5673e",
    tokens: { "--ol-bg": "#fbf8f1", "--ol-surface": "#ffffff", "--ol-fg": "#1c1a17", "--ol-border": "#e7e0d4", "--ol-accent": "#b5673e" },
  },
  {
    id: "sunset",
    name: "Sunset",
    hint: "Naranja vibrante",
    swatch: "#ed7c1e",
    tokens: { "--ol-bg": "#fffcf3", "--ol-surface": "#ffffff", "--ol-fg": "#221708", "--ol-border": "#f5ead0", "--ol-accent": "#ed7c1e" },
  },
  {
    id: "amber",
    name: "Ámbar",
    hint: "Amarillo cálido, luminoso",
    swatch: "#d97706",
    tokens: { "--ol-bg": "#fefce8", "--ol-surface": "#ffffff", "--ol-fg": "#1c1701", "--ol-border": "#f4ecbc", "--ol-accent": "#d97706" },
  },
  // Greens
  {
    id: "bosque",
    name: "Bosque",
    hint: "Verde profundo, profesional",
    swatch: "#1f8a52",
    tokens: { "--ol-bg": "#fafdf8", "--ol-surface": "#ffffff", "--ol-fg": "#0b1410", "--ol-border": "#e2efe2", "--ol-accent": "#1f8a52" },
  },
  {
    id: "menta",
    name: "Menta",
    hint: "Verde fresco, optimista",
    swatch: "#10b981",
    tokens: { "--ol-bg": "#f0fdf9", "--ol-surface": "#ffffff", "--ol-fg": "#0a1f1a", "--ol-border": "#cdf0e3", "--ol-accent": "#10b981" },
  },
  {
    id: "oliva",
    name: "Oliva",
    hint: "Verde tierra, sereno",
    swatch: "#65803a",
    tokens: { "--ol-bg": "#fafbf5", "--ol-surface": "#ffffff", "--ol-fg": "#191c10", "--ol-border": "#e2e6d5", "--ol-accent": "#65803a" },
  },
  // Blues
  {
    id: "cielo",
    name: "Cielo",
    hint: "Azul fresco, SaaS limpio",
    swatch: "#2563eb",
    tokens: { "--ol-bg": "#f8fbff", "--ol-surface": "#ffffff", "--ol-fg": "#101a2c", "--ol-border": "#dfe9f6", "--ol-accent": "#2563eb" },
  },
  {
    id: "oceano",
    name: "Océano",
    hint: "Azul profundo, confianza",
    swatch: "#0e7490",
    tokens: { "--ol-bg": "#f6fbfc", "--ol-surface": "#ffffff", "--ol-fg": "#091820", "--ol-border": "#d3e7ec", "--ol-accent": "#0e7490" },
  },
  {
    id: "indigo",
    name: "Índigo",
    hint: "Azul violáceo, premium",
    swatch: "#4f46e5",
    tokens: { "--ol-bg": "#fafaff", "--ol-surface": "#ffffff", "--ol-fg": "#161329", "--ol-border": "#e4e3f5", "--ol-accent": "#4f46e5" },
  },
  // Purples / pinks
  {
    id: "lavanda",
    name: "Lavanda",
    hint: "Lila suave, amigable",
    swatch: "#7c5cff",
    tokens: { "--ol-bg": "#fdfbff", "--ol-surface": "#ffffff", "--ol-fg": "#211d2e", "--ol-border": "#e9e4f2", "--ol-accent": "#7c5cff" },
  },
  {
    id: "magenta",
    name: "Magenta",
    hint: "Rosa eléctrico, atrevido",
    swatch: "#db2777",
    tokens: { "--ol-bg": "#fff5fa", "--ol-surface": "#ffffff", "--ol-fg": "#1f0a16", "--ol-border": "#f5d4e4", "--ol-accent": "#db2777" },
  },
  {
    id: "rosa",
    name: "Rosa",
    hint: "Rosa polvo, romántico",
    swatch: "#e11d48",
    tokens: { "--ol-bg": "#fff7f7", "--ol-surface": "#ffffff", "--ol-fg": "#1c0a0d", "--ol-border": "#f3d8da", "--ol-accent": "#e11d48" },
  },
  // Neutrals / monos
  {
    id: "carbon",
    name: "Carbón",
    hint: "Negro punzante, alto contraste",
    swatch: "#ff5a36",
    tokens: { "--ol-bg": "#ffffff", "--ol-surface": "#fafafa", "--ol-fg": "#000000", "--ol-border": "#1a1a1a", "--ol-accent": "#ff5a36" },
  },
  {
    id: "pizarra",
    name: "Pizarra",
    hint: "Gris pizarra, neutral",
    swatch: "#475569",
    tokens: { "--ol-bg": "#fafbfc", "--ol-surface": "#ffffff", "--ol-fg": "#0b0d12", "--ol-border": "#e1e4ea", "--ol-accent": "#475569" },
  },
  {
    id: "grafito",
    name: "Grafito",
    hint: "Gris oscuro, minimal",
    swatch: "#1f2937",
    tokens: { "--ol-bg": "#f9fafb", "--ol-surface": "#ffffff", "--ol-fg": "#030712", "--ol-border": "#d1d5db", "--ol-accent": "#1f2937" },
  },
  // Earthy / unique
  {
    id: "terracota",
    name: "Terracota",
    hint: "Rojo tierra, cálido orgánico",
    swatch: "#c2410c",
    tokens: { "--ol-bg": "#fef9f4", "--ol-surface": "#ffffff", "--ol-fg": "#1c0b04", "--ol-border": "#f0dccb", "--ol-accent": "#c2410c" },
  },
  {
    id: "esmeralda",
    name: "Esmeralda",
    hint: "Verde joya, lujoso",
    swatch: "#047857",
    tokens: { "--ol-bg": "#f6fbf8", "--ol-surface": "#ffffff", "--ol-fg": "#0a1f17", "--ol-border": "#d5e8df", "--ol-accent": "#047857" },
  },
  {
    id: "vino",
    name: "Vino",
    hint: "Borgoña editorial",
    swatch: "#7f1d1d",
    tokens: { "--ol-bg": "#fdf6f6", "--ol-surface": "#ffffff", "--ol-fg": "#19090a", "--ol-border": "#ecd6d6", "--ol-accent": "#7f1d1d" },
  },
  {
    id: "turquesa",
    name: "Turquesa",
    hint: "Azulverde tropical",
    swatch: "#0891b2",
    tokens: { "--ol-bg": "#f6fcfd", "--ol-surface": "#ffffff", "--ol-fg": "#081a1f", "--ol-border": "#d2eaf0", "--ol-accent": "#0891b2" },
  },
];
