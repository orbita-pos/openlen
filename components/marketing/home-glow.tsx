"use client";

// The home's light (spec local 2026-11-06-portada-solo-input; the why and the values are in `home-glow.css`). It goes
// inside the input's wrapper, which is `relative`, and the home's wrapper (`app/[locale]/page.tsx`) is `isolate`: with
// `z-index: -1` and no stacking context above it, the page's background would paint over the light. Not the hero
// `<section>`: there it trapped the sign-in dialog under the menu and the footer.

import { useHeroLenPersonActive } from "./hero-len";
import "./home-glow.css";

export function HomeGlow() {
  const active = useHeroLenPersonActive();
  return (
    <div className="home-glow" data-home-glow data-active={String(active)} aria-hidden="true">
      <div className="home-glow__light" />
      <div className="home-glow__boost" />
      <div className="home-glow__rings" />
      <div className="home-glow__grain" />
    </div>
  );
}
