// THE WORKSPACE'S THEMES (spec local 2026-11-27-temas-del-workspace; the bar is Claude Code's desktop themes, «mods»):
// the shapes shared by the manifest, install, the store, the resolver and the layer behind the workspace.
// Client-safe: no server imports.

/** The window a theme is made for (Claude Code's `window`): a theme with a twin is shown in the one that matches the person. */
export type ThemeWindow = "light" | "dark";

export const THEME_WINDOWS: readonly ThemeWindow[] = ["light", "dark"];

/** The glass over a scene, as Claude Code takes it: `blur` in points 0–64, `opacity` 0–1, `tint` a raw colour. */
export interface ThemeGlass {
  blur: number;
  opacity: number;
  tint?: string;
}

/** What Claude Code gives a scene that names no glass. */
export const DEFAULT_GLASS: Readonly<{ blur: number; opacity: number }> = { blur: 16, opacity: 0.6 };

/**
 * A still ground — no scene, so no glass — read from the manifest and ready to paint: Claude Code's `[w, h]` sizes
 * come out as `"<w>px <h>px"` (a `background-size`), its `viewBox` as the SVG attribute `"0 0 <w> <h>"`, a bare colour
 * or path string as an object, and, once any stop has an `at`, every stop has one.
 */
export type ThemeGround =
  | { color: string }
  | { gradient: ThemeGradient }
  | { vector: ThemeVector };

export interface ThemeGradient {
  /** 2 to 16, in order; `at` from 0 to 1. Without any `at`, the stops are evenly spaced. */
  stops: { color: string; at?: number }[];
  /** Degrees from -360 to 360, as in CSS (0 runs up, 90 right, 180 down); ignored when `shape` is `radial`. */
  angle?: number;
  shape?: "linear" | "radial";
  size?: string;
  repeat?: boolean;
}

export interface ThemeVector {
  viewBox: string;
  /** 1 to 64. Filled by the even-odd rule, or stroked when it has a `strokeWidth` (above 0, at most 64). */
  paths: { d: string; color?: string; strokeWidth?: number }[];
  /** The colour of every path that names none of its own. */
  color?: string;
  size?: string;
  repeat?: boolean;
}

/** The font a theme may ask for: one generic, as Claude Code's `style.fontFamily` does. */
export type ThemeFont = "sans" | "serif" | "mono" | "code" | "cursive";

export const THEME_FONTS: readonly ThemeFont[] = ["sans", "serif", "mono", "code", "cursive"];

/**
 * The workspace tokens a theme's palette may name (`colors`): the custom properties `app/[locale]/new/tokens.css`
 * defines for `.workspace-v2` and every surface reads. A name outside this list is refused, so a palette can never
 * reach anything else; `manifest.test.ts` checks each one still exists in that file.
 */
export const THEME_TOKENS = [
  "--bg",
  "--bg-sidebar",
  "--bg-preview",
  "--bg-elev",
  "--fg",
  "--fg-muted",
  "--fg-faint",
  "--border",
  "--border-strong",
  "--accent",
  "--accent-soft",
  "--hover",
] as const;

export type ThemeToken = (typeof THEME_TOKENS)[number];

/** One theme of a project's manifest (`/package.json` → `openlen.theme.themes`), checked and ready to use. */
export interface ThemeDefinition {
  id: string;
  window: ThemeWindow;
  /** The same theme for the other window: its id. */
  twin?: string;
  /** Path of the scene's SVG in the project, e.g. `/themes/pond.svg`. */
  scene?: string;
  /** Present with a scene (defaulted); `false` is no glass; absent with a still ground or a palette alone. */
  glass?: ThemeGlass | false;
  ground?: ThemeGround;
  colors?: Partial<Record<ThemeToken, string>>;
  font?: ThemeFont;
  /** The title and the blurb of each locale the project's `locale/*.json` carry. */
  titles: Record<string, string>;
  blurbs: Record<string, string>;
}
