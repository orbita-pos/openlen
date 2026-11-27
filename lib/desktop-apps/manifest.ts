// THE WEB APP MANIFEST OF AN APP ON THE DESKTOP (spec local 2026-11-26-apps-en-el-escritorio, §4.3, §4.5): what the browser
// reads to offer «Instalar» and to open it as its own window. `id`, `scope` and `start_url` are the page's own address
// WITHOUT a trailing slash — next.config has no `trailingSlash`, so `/desktop/<id>/` would redirect — and the ids are all
// of one length, so no scope is the prefix of another. Pure.
import { DESKTOP_COLORS } from "./colors";
import { iconMimeType } from "./icon";

/** The workspace's light tokens, as hex (`colors.ts`, which a test pins to tokens.css). A manifest has one pair of colours, so
 *  the light one; the page's own `theme-color` has the dark one too (`app/desktop/[id]/layout.tsx`). The theme colour is the
 *  strip's, so the title bar and the strip are one band. */
export const DESKTOP_BACKGROUND_COLOR = DESKTOP_COLORS.light.background;
export const DESKTOP_THEME_COLOR = DESKTOP_COLORS.light.theme;

export interface DesktopManifestIcon {
  src: string;
  sizes: "any";
  type?: string;
  purpose: "any" | "maskable";
}

export interface DesktopManifest {
  id: string;
  scope: string;
  start_url: string;
  name: string;
  short_name: string;
  display: "standalone";
  background_color: string;
  theme_color: string;
  icons: DesktopManifestIcon[];
}

export function desktopManifest(i: { readonly id: string; readonly name: string; readonly iconPath: string | null }): DesktopManifest {
  const page = `/desktop/${i.id}`;
  const type = i.iconPath ? iconMimeType(i.iconPath) : "image/svg+xml";
  const icon = (purpose: DesktopManifestIcon["purpose"]): DesktopManifestIcon => ({ src: `${page}/icon`, sizes: "any", ...(type ? { type } : {}), purpose });
  return {
    id: page,
    scope: page,
    start_url: page,
    name: i.name,
    // By characters: a cut inside an emoji would leave half of one.
    short_name: [...i.name].slice(0, 12).join(""),
    display: "standalone",
    background_color: DESKTOP_BACKGROUND_COLOR,
    theme_color: DESKTOP_THEME_COLOR,
    icons: [icon("any"), icon("maskable")],
  };
}
