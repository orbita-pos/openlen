import { describe, it, expect } from "vitest";
import { injectContactWidget } from "./contact-widget";
import type { BusinessProfileData } from "./types";

const base = { links: [] } as unknown as BusinessProfileData;
const HTML = "<html><body><h1>hola</h1></body></html>";
const withLinks = (links: { type: string; url: string }[]) =>
  ({ ...base, links }) as BusinessProfileData;

describe("el widget usa el registry de plataformas", () => {
  it("arma la URL de Twitch desde un handle pelado", () => {
    const out = injectContactWidget(HTML, withLinks([{ type: "twitch", url: "kira" }]), "#FF5A36");
    expect(out).toContain('href="https://twitch.tv/kira"');
    expect(out).not.toContain('href="https://kira"');
  });

  it("usa el icono de la plataforma, no el genérico de cadena", () => {
    const out = injectContactWidget(HTML, withLinks([{ type: "twitch", url: "kira" }]), "#FF5A36");
    // el path de la cadena genérica NO debe aparecer para un link de twitch
    expect(out).not.toContain('d="M9 17H7A5 5 0 0 1 7 7h2"');
  });

  it("etiqueta con el nombre real de la plataforma", () => {
    const out = injectContactWidget(HTML, withLinks([{ type: "kofi", url: "kira" }]), "#FF5A36");
    expect(out).toContain('aria-label="Ko-fi"');
  });

  it("omite un link cuya URL no se puede armar", () => {
    const out = injectContactWidget(HTML, withLinks([{ type: "spotify", url: "kira" }]), "#FF5A36");
    expect(out).toBe(HTML);
  });

  it("escapa comillas en el href", () => {
    const out = injectContactWidget(HTML, withLinks([{ type: "otro", url: 'a.com/"onmouseover=x' }]), "#FF5A36");
    expect(out).not.toContain('"onmouseover=x');
  });

  it("un perfil vacío no toca el HTML", () => {
    expect(injectContactWidget(HTML, base, "#FF5A36")).toBe(HTML);
  });

  describe("el aria-label de los genéricos habla el idioma de la página", () => {
    const links = [{ type: "website", url: "tunegocio.mx" }];

    it("página en español → «Sitio web»", () => {
      const out = injectContactWidget(
        '<html lang="es"><body><h1>hola</h1></body></html>',
        withLinks(links),
        "#FF5A36",
      );
      expect(out).toContain('aria-label="Sitio web"');
    });

    it("página en inglés → «Website», nunca español", () => {
      const out = injectContactWidget(
        '<html lang="en"><body><h1>hi</h1></body></html>',
        withLinks(links),
        "#FF5A36",
      );
      expect(out).toContain('aria-label="Website"');
      expect(out).not.toContain("Sitio web");
    });

    it("una MARCA sale igual en cualquier locale", () => {
      const out = injectContactWidget(
        '<html lang="ja"><body><h1>hi</h1></body></html>',
        withLinks([{ type: "twitch", url: "kira" }]),
        "#FF5A36",
      );
      expect(out).toContain('aria-label="Twitch"');
    });
  });
});
