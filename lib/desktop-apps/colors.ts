// THE COLOURS OF THE WINDOW OF AN APP ON THE DESKTOP (spec local 2026-11-26-apps-en-el-escritorio, §4.3), in the one place the
// manifest and the page's `theme-color` read them from. The workspace's own tokens (`--bg` and `--bg-elev` of
// app/[locale]/new/tokens.css) as hex, because the browser reads these with its own parser, where oklch is not safe.
// `background` is the page behind the window; `theme` is the strip's band, so the title bar and the strip are one.
// Claude's window follows the system the same way (a light and a dark background, by `nativeTheme`).
// colors.test.ts reads tokens.css and fails the day one of these moves there and not here. Pure.
export const DESKTOP_COLORS = {
  light: { background: "#f8f5f5", theme: "#fefcfc" },
  dark: { background: "#070304", theme: "#0f090a" },
} as const;
