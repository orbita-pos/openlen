import { describe, it, expect } from "vitest";
import { renderPlatformsBand, PLATFORMS_BAND_MARKER } from "./platforms-band";
import type { BusinessProfileData } from "./types";

const d = (links: { type: string; url: string }[]) => ({ links }) as BusinessProfileData;

describe("renderPlatformsBand", () => {
  it("devuelve vacío sin plataformas", () => {
    expect(renderPlatformsBand(d([]))).toBe("");
  });

  it("devuelve vacío si ninguna URL es armable", () => {
    expect(renderPlatformsBand(d([{ type: "spotify", url: "kira" }]))).toBe("");
  });

  it("pinta una tarjeta por plataforma con su nombre y URL", () => {
    const out = renderPlatformsBand(d([{ type: "twitch", url: "kira" }, { type: "kofi", url: "kira" }]));
    expect(out).toContain('href="https://twitch.tv/kira"');
    expect(out).toContain("Twitch");
    expect(out).toContain("Ko-fi");
  });

  it("no emite scripts ni iframes (contrato de la página sellada)", () => {
    const out = renderPlatformsBand(d([{ type: "twitch", url: "kira" }]));
    expect(out).not.toMatch(/<script|<iframe/i);
  });

  it("usa el token de acento del sitio", () => {
    expect(renderPlatformsBand(d([{ type: "twitch", url: "kira" }]))).toContain("var(--ol-accent");
  });

  it("escapa la entrada del usuario", () => {
    const out = renderPlatformsBand(d([{ type: "otro", url: 'a.com/"><img src=x onerror=1>' }]));
    expect(out).not.toContain("<img");
  });

  it("NO emite encabezado — ese lo pone buildModuleSection", () => {
    const out = renderPlatformsBand(d([{ type: "twitch", url: "kira" }]));
    expect(out).not.toMatch(/<h2/i);
  });
});
