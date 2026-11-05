// THE WORKSPACE'S COLOURS, FOR A TOOL OUTSIDE THE WORKSPACE (spec local 2026-11-04-herramientas-hechas-por-len, §4.4,
// §4.14). §4.4: the parent gives the frame «los colores del workspace». In the workspace they are read off the page
// (`readToolTheme`); the phone app paints with its own orange, which is no background for a tool, so it gives the tool
// these — the workspace's tokens, light or dark with the phone's theme — and the tool looks as it does on the web.
// Copied from app/[locale]/new/tokens.css; workspace-theme.test.ts fails the day they drift. `--font-sans` is left to
// the parent (the phone sends its own font). Pure.
export const WORKSPACE_TOOL_THEME: Readonly<Record<"light" | "dark", Readonly<Record<string, string>>>> = {
  light: {
    "--bg": "oklch(97.2% 0.004 12)",
    "--bg-elev": "oklch(99.2% 0.003 12)",
    "--fg": "oklch(15% 0.01 12)",
    "--fg-muted": "oklch(45% 0.01 12)",
    "--fg-faint": "oklch(48% 0.01 12)",
    "--border": "oklch(85% 0.005 12 / 0.6)",
    "--border-strong": "oklch(78% 0.005 12 / 0.8)",
    "--hover": "oklch(93.2% 0.006 12)",
    "--accent": "#FF5A36",
    "--accent-strong": "#D63916",
    "--accent-soft": "oklch(94.2% 0.045 30)",
    "--accent-ring": "oklch(74% 0.18 30)",
    "--link": "oklch(50% 0.2 262)",
  },
  dark: {
    "--bg": "oklch(11% 0.01 12)",
    "--bg-elev": "oklch(15% 0.01 12)",
    "--fg": "oklch(96% 0.005 12)",
    "--fg-muted": "oklch(65% 0.01 12)",
    "--fg-faint": "oklch(64% 0.01 12)",
    "--border": "oklch(25% 0.01 12 / 0.7)",
    "--border-strong": "oklch(32% 0.01 12 / 0.9)",
    "--hover": "oklch(18% 0.01 12)",
    "--accent": "#FF5A36",
    "--accent-strong": "#D63916",
    "--accent-soft": "oklch(28% 0.07 30)",
    "--accent-ring": "oklch(72% 0.18 30)",
    "--link": "oklch(74% 0.13 255)",
  },
};
