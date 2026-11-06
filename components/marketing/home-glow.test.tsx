// The home's light (spec local 2026-11-06-portada-solo-input): Gemini's background in OpenLen's orange, «medio». It
// rises only with what the person does, and stands still for whoever asks the system for less motion.
import { afterEach, describe, expect, it } from "vitest";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { HeroLenProvider, useHeroLenReport, type Signals } from "./hero-len";
import { HomeGlow } from "./home-glow";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
afterEach(() => {
  roots.splice(0).forEach((r) => act(() => r.unmount()));
  document.body.innerHTML = "";
});

let reportNow: (patch: Partial<Signals>) => void = () => {};
function Reporter() {
  const report = useHeroLenReport();
  useEffect(() => {
    reportNow = report;
  }, [report]);
  return null;
}

function mount() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() =>
    root.render(
      <HeroLenProvider>
        <Reporter />
        <HomeGlow />
      </HeroLenProvider>,
    ),
  );
  return () => host.querySelector<HTMLElement>("[data-home-glow]")!;
}

describe("the home's light", () => {
  it("is decorative: hidden from assistive technology", () => {
    const glow = mount();
    expect(glow().getAttribute("aria-hidden")).toBe("true");
  });

  it("🔴 rises while the person types, and goes back when they stop", () => {
    const glow = mount();
    expect(glow().dataset.active).toBe("false");
    act(() => reportNow({ focused: true, hasText: true }));
    expect(glow().dataset.active).toBe("true");
    act(() => reportNow({ focused: false }));
    expect(glow().dataset.active).toBe("false");
  });

  it("🔴 does not rise with the box typing its own examples", () => {
    const glow = mount();
    act(() => reportNow({ ghost: true }));
    expect(glow().dataset.active).toBe("false");
  });
});

describe("its stylesheet", () => {
  // jsdom's import.meta.url isn't a file URL: read it from the repo root (vitest's cwd).
  const css = readFileSync(join(process.cwd(), "components/marketing/home-glow.css"), "utf8");

  it("carries the approved «medio» light, verbatim", () => {
    expect(css).toContain("radial-gradient(ellipse 42% 46% at 50% 63%, #7c2a11 0%, #632011 20%, #3d140f 42%, #1f100e 66%, transparent 86%)");
    expect(css).toContain("radial-gradient(ellipse 24% 17% at 50% 60%, rgba(255,110,64,.20), transparent 70%)");
    expect(css).toContain("radial-gradient(ellipse 30% 22% at 42% 18%, rgba(8,4,4,.75), transparent 70%)");
    expect(css).toContain("repeating-radial-gradient(ellipse 60% 70% at 50% 64%, rgba(255,255,255,.012) 0 2px, transparent 2px 26px)");
  });

  // Jesús, 06/11, on /new in the light theme: «¿por qué en blanco no tiene ese brillo que sí tiene el negro?» — Gemini
  // keeps its light in its light theme too. Outside a `.dark`, the light is a warm haze over the light page (the dark
  // one's browns would be a smudge there); inside one —the home, always dark— nothing changes.
  it("🔴 has its own light for the light theme, and leaves the dark one as it is", () => {
    const light = css.slice(css.indexOf(".home-glow:not(.dark *) .home-glow__light {"));
    const rule = light.slice(0, light.indexOf("}"));
    expect(rule.length).toBeGreaterThan(60);
    expect(rule).toMatch(/radial-gradient\(ellipse 42% 46% at 50% 63%, rgba\(255,\s*1\d\d,\s*\d+,\s*\.\d+\)/);
    expect(rule).not.toContain("#7c2a11");
    expect(rule).not.toContain("rgba(8,4,4");
    expect(css).toMatch(/\.home-glow:not\(\.dark \*\) \.home-glow__rings \{[^}]*rgba\(1\d\d,\s*\d+,\s*\d+,\s*\.0\d+\)/);
  });

  it("breathes in 14 seconds", () => {
    expect(css).toMatch(/animation:\s*home-glow-breathe 14s ease-in-out infinite/);
  });

  // Seen in the browser on 06/11: two hard horizontal bands — the grain started at the light's box (~146 px down) and
  // the hero section clipped the light right above the footer. The grain bleeds far past the box, and nothing
  // between the light and the page clips it: the page wrapper clips both axes instead (no scroll, no bands).
  it("🔴 the grain bleeds far past the light's box, so its edge never shows", () => {
    const grain = css.slice(css.indexOf(".home-glow__grain {"), css.indexOf("}", css.indexOf(".home-glow__grain {")));
    expect(grain).toMatch(/inset:\s*-100svh\s+-50vw/);
  });

  // The stacking context that keeps the light (z-index -1) above the page's background lives on the HOME'S WRAPPER,
  // not on the hero: on the hero it trapped the sign-in dialog (`fixed z-[60]`, inside the hero) under the sticky menu
  // (z-50) and the footer row (z-10) — found in the final review, 06/11.
  it("🔴 the hero doesn't clip the light nor trap the sign-in dialog; the home's wrapper isolates and clips", () => {
    const hero = readFileSync(join(process.cwd(), "components/marketing/hero.tsx"), "utf8");
    const section = /<section className="([^"]+)"/.exec(hero)?.[1] ?? "";
    expect(section.split(/\s+/)).not.toContain("isolate");
    expect(section).not.toContain("overflow-hidden");
    const page = readFileSync(join(process.cwd(), "app/[locale]/page.tsx"), "utf8");
    const wrapper = (/<div className="([^"]*dark[^"]*)"/.exec(page)?.[1] ?? "").split(/\s+/);
    expect(wrapper).toContain("isolate");
    expect(wrapper).toContain("overflow-clip");
  });

  // Final review, 06/11: on real phones `100vh` (the body's `min-h-screen`) is the LARGE viewport, taller than the
  // home's 100svh, so a strip of the body's background (white for light-theme visitors) showed under the home, and in
  // the overscroll bounce. On the home, the body is one small viewport tall and the home's own colour.
  it("🔴 on the home, the body is 100svh tall and the home's colour", () => {
    const rule = css.slice(css.indexOf("body:has(.home-page)"), css.indexOf("}", css.indexOf("body:has(.home-page)")));
    expect(rule).toMatch(/min-height:\s*100svh/);
    expect(rule).toMatch(/background-color:\s*#100d0c/);
    const page = readFileSync(join(process.cwd(), "app/[locale]/page.tsx"), "utf8");
    const wrapper = (/<div className="([^"]*dark[^"]*)"/.exec(page)?.[1] ?? "").split(/\s+/);
    expect(wrapper).toContain("home-page");
  });

  it("🔴 stands still with reduced motion: no breathing, no rising", () => {
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced.length).toBeGreaterThan(40);
    expect(reduced).toContain("animation: none");
    expect(reduced).toMatch(/\[data-active="true"\][^{]*\{[^}]*opacity:\s*0/);
  });
});
