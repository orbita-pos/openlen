// @vitest-environment node
//
// La píldora «cambios sin publicar». Existía un bug: la comparación medía
// publishedHtml (los BYTES servidos, tras ensurePageMeta + ensureSocialOgImage)
// contra data.html (el FUENTE), así que nunca coincidían y la píldora estaba
// encendida en toda página publicada, siempre. Medido en producción antes del
// arreglo: las 3 páginas publicadas la traían, incluidas dos sin tocar.
import { describe, expect, it } from "vitest";
import { computeUnpublishedChanges, hashHomeDoc } from "@/lib/projects";

const SOURCE = `<html><body><h1>Kira</h1></body></html>`;
// Lo que publish guarda en publishedHtml: el fuente + lo que le inyectan
// ensurePageMeta / ensureSocialOgImage. Nunca es igual al fuente.
const SERVED = `<html><head><meta property="og:image" content="x"></head><body><h1>Kira</h1></body></html>`;

const row = (over: Partial<Parameters<typeof computeUnpublishedChanges>[0]> = {}) => ({
  subdomain: "kira",
  publishedHtml: SERVED,
  publishedHomeHash: hashHomeDoc(SOURCE),
  publishedPagesHash: null,
  data: { html: SOURCE } as never,
  currentHtml: SOURCE,
  ...over,
});

describe("computeUnpublishedChanges", () => {
  it("EL BUG: recién publicado, sin editar nada, la píldora se apaga", () => {
    // Antes daba `true` porque SERVED !== SOURCE. Esta es la regresión a cazar.
    expect(computeUnpublishedChanges(row())).toBe(false);
  });

  it("editar el documento la enciende", () => {
    expect(
      computeUnpublishedChanges(row({ currentHtml: SOURCE.replace("Kira", "Kira 2") })),
    ).toBe(true);
  });

  it("un cambio de UN byte la enciende (el hash no redondea)", () => {
    expect(computeUnpublishedChanges(row({ currentHtml: SOURCE + " " }))).toBe(true);
  });

  it("sin subdominio nunca hay deriva que mostrar", () => {
    expect(computeUnpublishedChanges(row({ subdomain: null }))).toBe(false);
  });

  it("nunca publicado (publishedHtml null) tampoco", () => {
    expect(computeUnpublishedChanges(row({ publishedHtml: null }))).toBe(false);
  });

  describe("filas legado (publishedHomeHash NULL: publicadas antes de la columna, o tras rollback)", () => {
    it("caen en la comparación vieja — sobre-reporta, que es el fallo SEGURO", () => {
      expect(
        computeUnpublishedChanges(row({ publishedHomeHash: null })),
      ).toBe(true);
    });

    it("y jamás sub-reporta: un cambio real sigue encendiéndola", () => {
      expect(
        computeUnpublishedChanges(
          row({ publishedHomeHash: null, currentHtml: "otra cosa" }),
        ),
      ).toBe(true);
    });

    it("se curan solas: su siguiente publicación escribe el hash", () => {
      const curada = row({ publishedHomeHash: hashHomeDoc(SOURCE) });
      expect(computeUnpublishedChanges(curada)).toBe(false);
    });
  });

  describe("las subpáginas siguen mandando (no toqué esa rama)", () => {
    it("con hash de páginas que no cuadra, enciende aunque el home esté igual", () => {
      expect(
        computeUnpublishedChanges(row({ publishedPagesHash: "noesigual" })),
      ).toBe(true);
    });

    it("con hash de páginas NULL, las páginas se saltan", () => {
      expect(
        computeUnpublishedChanges(row({ publishedPagesHash: null })),
      ).toBe(false);
    });
  });

  it("TRAMPA: normalizar el html cambia el hash — los read paths deben comparar el CRUDO", () => {
    // publishProject hashea `data.html` tal cual sale de la BD. getProject
    // normaliza el documento antes de devolverlo (normalizeBornCanonical +
    // ensurePageMeta); si esa versión llegara a la comparación, no cuadraría
    // nunca y la píldora volvería a quedarse encendida para siempre — en la
    // única vista donde el usuario la ve. Por eso pasa `rawHtml`.
    const normalizado = SOURCE.replace("<body>", '<head><meta charset="utf-8"></head><body>');
    expect(hashHomeDoc(normalizado)).not.toBe(hashHomeDoc(SOURCE));
    expect(computeUnpublishedChanges(row({ currentHtml: normalizado }))).toBe(true);
  });

  it("hashHomeDoc es estable y corto (16 hex, igual que hashSitePages)", () => {
    expect(hashHomeDoc(SOURCE)).toBe(hashHomeDoc(SOURCE));
    expect(hashHomeDoc(SOURCE)).toMatch(/^[0-9a-f]{16}$/);
    expect(hashHomeDoc(SOURCE)).not.toBe(hashHomeDoc(SOURCE + "x"));
  });

  describe("los AJUSTES cuentan (el bake los lee, así que cambian la publicada)", () => {
    const conAjustes = (settings: unknown) => ({
      ...row(),
      data: { html: SOURCE, settings } as never,
      publishedHomeHash: hashHomeDoc(SOURCE, { collections: { theme: "dark" } } as never),
    });

    it("EL FALSO NEGATIVO: cambiar el tema del catálogo enciende la píldora", () => {
      // Medido en prod antes de esto: theme dark->light dejaba la píldora en
      // false mientras la página publicada seguía con el tema viejo.
      expect(
        computeUnpublishedChanges(conAjustes({ collections: { theme: "light" } })),
      ).toBe(true);
    });

    it("con los mismos ajustes NO se enciende", () => {
      expect(
        computeUnpublishedChanges(conAjustes({ collections: { theme: "dark" } })),
      ).toBe(false);
    });

    it("el ORDEN de las claves no cuenta (los patches usan spreads)", () => {
      const a = { comments: { theme: "dark", moderation: "all" }, members: { enabled: true } };
      const b = { members: { enabled: true }, comments: { moderation: "all", theme: "dark" } };
      expect(hashHomeDoc(SOURCE, a as never)).toBe(hashHomeDoc(SOURCE, b as never));
    });

    it("sin ajustes y con ajustes vacíos hashean igual (nada churnea al migrar)", () => {
      expect(hashHomeDoc(SOURCE)).toBe(hashHomeDoc(SOURCE, {} as never));
      expect(hashHomeDoc(SOURCE)).toBe(hashHomeDoc(SOURCE, null));
    });

    it("un ajuste anidado distinto cambia la huella", () => {
      expect(hashHomeDoc(SOURCE, { comments: { theme: "dark" } } as never)).not.toBe(
        hashHomeDoc(SOURCE, { comments: { theme: "light" } } as never),
      );
    });
  });
});
