import { describe, it, expect } from "vitest";
import { platformLinkRenders, renderPlatformsBand, PLATFORMS_BAND_MARKER } from "./platforms-band";
import type { BusinessProfileData } from "./types";

const d = (links: { type: string; url: string }[]) => ({ links }) as BusinessProfileData;

// El gate de la afordancia de inserción (page.tsx) y el de la rejilla TIENEN
// que ser el mismo predicado. Cuando divergían, un "Sitio web: micafe" hacía
// que la tarjeta dijera "En esta página", se insertara una banda pelada
// (encabezado + hueco) y el publish la borrara entera sin avisar.
describe("platformLinkRenders — el único gate de «esto pinta algo»", () => {
  it("un link cuyo href NO resuelve no cuenta como link", () => {
    expect(platformLinkRenders({ type: "website", url: "micafe" })).toBe(false);
    expect(platformLinkRenders({ type: "spotify", url: "mibanda" })).toBe(false);
    expect(platformLinkRenders({ type: "otro", url: "tienda" })).toBe(false);
  });

  it("URL en blanco tampoco cuenta", () => {
    expect(platformLinkRenders({ type: "twitch", url: "" })).toBe(false);
    expect(platformLinkRenders({ type: "twitch", url: "   " })).toBe(false);
  });

  it("un link armable sí cuenta", () => {
    expect(platformLinkRenders({ type: "twitch", url: "kira" })).toBe(true);
    expect(platformLinkRenders({ type: "website", url: "micafe.mx" })).toBe(true);
  });

  it("coincide exactamente con lo que la rejilla decide pintar", () => {
    const links = [
      { type: "website", url: "micafe" },
      { type: "spotify", url: "mibanda" },
      { type: "twitch", url: "kira" },
    ];
    const contados = links.filter(platformLinkRenders).length;
    const pintadas = (renderPlatformsBand(d(links)).match(/<a /g) ?? []).length;
    expect(contados).toBe(1);
    expect(pintadas).toBe(contados);
  });

  it("cero armables ⇒ el gate dice 0 y la rejilla sale vacía (nunca banda pelada)", () => {
    const links = [{ type: "website", url: "micafe" }, { type: "otro", url: "tienda" }];
    expect(links.filter(platformLinkRenders)).toHaveLength(0);
    expect(renderPlatformsBand(d(links))).toBe("");
  });
});

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
    // Sin este assert el test pasaría en vacío: si platformHref devolviera null
    // no se renderiza tarjeta y "no contiene <img" se cumple sin haber ejercido
    // el escapado ni una sola vez.
    expect(out).toContain('href="https://a.com/&quot;&gt;&lt;img src=x onerror=1&gt;"');
    expect(out).not.toContain("<img");
  });

  it("NO emite encabezado — ese lo pone buildModuleSection", () => {
    const out = renderPlatformsBand(d([{ type: "twitch", url: "kira" }]));
    expect(out).not.toMatch(/<h2/i);
  });

  describe("los tres nombres genéricos siguen el idioma de la página", () => {
    const generic = d([
      { type: "website", url: "tunegocio.mx" },
      { type: "menu", url: "linktr.ee/kira" },
      { type: "otro", url: "algo.com" },
    ]);

    it("en español usa los nombres en español", () => {
      const out = renderPlatformsBand(generic, { lang: "es" });
      expect(out).toContain("Sitio web");
      expect(out).toContain("Menú / Linktree");
      expect(out).toContain("Otro enlace");
    });

    it("en inglés NO deja español visible en la tarjeta", () => {
      const out = renderPlatformsBand(generic, { lang: "en" });
      expect(out).toContain("Website");
      expect(out).toContain("Menu / Linktree");
      expect(out).toContain("Other link");
      expect(out).not.toContain("Sitio web");
      expect(out).not.toContain("Otro enlace");
    });

    it("las MARCAS no se traducen en ningún idioma", () => {
      const brands = d([{ type: "twitch", url: "kira" }, { type: "kofi", url: "kira" }]);
      for (const lang of ["es", "en", "fr", "ja", ""]) {
        const out = renderPlatformsBand(brands, { lang });
        expect(out).toContain("Twitch");
        expect(out).toContain("Ko-fi");
      }
    });
  });
});
