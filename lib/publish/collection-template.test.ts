import { describe, it, expect } from "vitest";
import { parse } from "node-html-parser";
import {
  fillCollectionTemplate,
  hasCollectionTemplate,
  previewCollectionCards,
} from "./collection-template";
import { bakeCollections } from "./collections-block";
import { stripDisabledModuleBands } from "./strip-disabled-bands";
import type { ItemRow } from "@/lib/collections/store";

function item(over: Partial<ItemRow> = {}): ItemRow {
  return {
    id: "i1",
    projectId: "p1",
    collectionId: "c1",
    title: "Tacos al pastor",
    subtitle: null,
    description: null,
    imageUrl: null,
    priceDisplay: null,
    badge: null,
    ctaLabel: null,
    ctaUrl: null,
    tags: [],
    attrs: {},
    status: "published",
    sortOrder: 0,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...over,
  };
}

/** Una tarjeta como la que escribiría el modelo: con SU diseño. */
const CARD = `<article data-ol-item class="rounded-3xl bg-white shadow-lg">
  <img data-ol-item-field="image" src="/foto-modelo.jpg" alt="muestra" class="w-full aspect-[4/3] object-cover">
  <span data-ol-item-field="badge" class="chip">Nuevo</span>
  <h3 data-ol-item-field="title" class="font-serif text-2xl">Muestra</h3>
  <p data-ol-item-field="subtitle" class="text-sm opacity-70">sub muestra</p>
  <p data-ol-item-field="description">desc muestra</p>
  <span data-ol-item-field="price" class="font-bold">$00</span>
  <a data-ol-item-field="cta" href="#" class="btn">Pedir</a>
</article>`;

const PAGE = (inner: string) =>
  `<!doctype html><html lang="es"><head><title>t</title></head><body><section data-ol-collection-section class="py-24"><h2>Menú</h2><div class="grid grid-cols-3 gap-6">${inner}</div></section></body></html>`;

const CON_PLANTILLA = PAGE(CARD + CARD + CARD);
const LEGADA = `<!doctype html><html lang="es"><head><title>t</title></head><body><section data-ol-collection-section></section></body></html>`;

describe("fillCollectionTemplate", () => {
  it("emite una tarjeta por ítem, no las que escribió el modelo", () => {
    const out = fillCollectionTemplate(CON_PLANTILLA, [
      item({ id: "a", title: "Pastor" }),
      item({ id: "b", title: "Suadero" }),
    ]);
    expect(out.touched).toBe(true);
    expect(out.filled).toBe(2);
    const cards = parse(out.html).querySelectorAll("[data-ol-item]");
    expect(cards).toHaveLength(2);
    expect(out.html).toContain("Pastor");
    expect(out.html).toContain("Suadero");
    expect(out.html).not.toContain("Muestra");
  });

  it("conserva el diseño del modelo — clases, envoltorio y rejilla", () => {
    const out = fillCollectionTemplate(CON_PLANTILLA, [item()]).html;
    expect(out).toContain("rounded-3xl bg-white shadow-lg");
    expect(out).toContain("grid grid-cols-3 gap-6");
    expect(out).toContain("<h2>Menú</h2>");
    expect(out).toContain('class="font-serif text-2xl"');
  });

  it("rellena cada campo con el dato del dueño", () => {
    const out = fillCollectionTemplate(CON_PLANTILLA, [
      item({
        title: "Pastor",
        subtitle: "con piña",
        description: "en tortilla de maíz",
        priceDisplay: "$45",
        badge: "Top",
        imageUrl: "https://images.openlen.com/pastor.jpg",
        ctaLabel: "Pedir",
        ctaUrl: "https://wa.me/521",
      }),
    ]).html;
    expect(out).toContain(">Pastor<");
    expect(out).toContain(">con piña<");
    expect(out).toContain(">en tortilla de maíz<");
    expect(out).toContain(">$45<");
    expect(out).toContain(">Top<");
    expect(out).toContain('src="https://images.openlen.com/pastor.jpg"');
    expect(out).toContain('alt="Pastor"');
    expect(out).toContain('href="https://wa.me/521"');
  });

  it("esconde el hueco que el ítem no llena, con display:none INLINE", () => {
    // `hidden` a secas pierde contra una utilidad de Tailwind; el inline gana.
    const out = fillCollectionTemplate(CON_PLANTILLA, [item({ badge: null })]).html;
    const badge = parse(out).querySelector('[data-ol-item-field="badge"]');
    expect(badge?.getAttribute("hidden")).toBe("");
    expect(badge?.getAttribute("style")).toContain("display:none");
  });

  it("un botón sin destino se esconde en vez de quedarse muerto", () => {
    const out = fillCollectionTemplate(CON_PLANTILLA, [
      item({ ctaLabel: "Pedir", ctaUrl: null }),
    ]).html;
    const cta = parse(out).querySelector('[data-ol-item-field="cta"]');
    expect(cta?.getAttribute("style")).toContain("display:none");
  });

  it("sin foto propia esconde el hueco — nunca enseña la foto de otro producto", () => {
    // Medido en el render: conservar la de la muestra ponía tacos en la tarjeta
    // del agua de horchata. Vacío es feo; mentir es peor.
    const out = fillCollectionTemplate(CON_PLANTILLA, [item({ imageUrl: null })]).html;
    const img = parse(out).querySelector('[data-ol-item-field="image"]');
    expect(img?.getAttribute("style")).toContain("display:none");
  });

  it("es idempotente: el hueco escondido por un ítem no mata el del siguiente", () => {
    const items = [item({ id: "a", badge: null }), item({ id: "b", badge: "Nuevo" })];
    const una = fillCollectionTemplate(CON_PLANTILLA, items).html;
    const dos = fillCollectionTemplate(una, items).html;
    expect(dos).toBe(una);
    // La insignia del SEGUNDO sobrevive aunque el primero no la tuviera.
    const badges = parse(dos).querySelectorAll('[data-ol-item-field="badge"]');
    expect(badges[0]?.getAttribute("style")).toContain("display:none");
    expect(badges[1]?.getAttribute("style") ?? "").not.toContain("display:none");
    expect(badges[1]?.text).toBe("Nuevo");
  });

  it("sin plantilla NO toca nada — la página legada cae a la rejilla vieja", () => {
    const out = fillCollectionTemplate(LEGADA, [item()]);
    expect(out.touched).toBe(false);
    expect(out.html).toBe(LEGADA);
  });

  it("con plantilla y catálogo vacío deja la página intacta", () => {
    const out = fillCollectionTemplate(CON_PLANTILLA, []);
    expect(out.touched).toBe(true);
    expect(out.filled).toBe(0);
    expect(out.html).toBe(CON_PLANTILLA);
  });

  it("escapa el texto del dueño — un título con marcado no ejecuta", () => {
    const out = fillCollectionTemplate(CON_PLANTILLA, [
      item({ title: '<img src=x onerror=alert(1)>' }),
    ]).html;
    expect(out).not.toContain("onerror=alert(1)>");
    expect(out).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("rechaza esquemas peligrosos en cta e imagen", () => {
    const out = fillCollectionTemplate(CON_PLANTILLA, [
      item({
        ctaLabel: "Click",
        ctaUrl: "javascript:alert(1)",
        imageUrl: "javascript:alert(2)",
      }),
    ]).html;
    expect(out).not.toContain("javascript:");
    expect(out).toContain('src="/foto-modelo.jpg"');
  });

  it("el molde es la tarjeta MÁS COMPLETA, no la primera", () => {
    // Medido en una generación real: de 11 tarjetas el modelo puso el hueco de
    // insignia en UNA sola. Si cae fuera de la primera, sin esto ningún ítem
    // enseñaría insignia nunca — y nada lo avisaría.
    const pobre = '<article data-ol-item><h3 data-ol-item-field="title">A</h3></article>';
    const rica =
      '<article data-ol-item><h3 data-ol-item-field="title">B</h3>' +
      '<span data-ol-item-field="badge">x</span></article>';
    const out = fillCollectionTemplate(PAGE(pobre + rica), [
      item({ title: "Pastor", badge: "Top" }),
    ]).html;
    expect(out).toContain(">Top<");
  });

  it("sólo repite la tanda de la plantilla, no marcas de otra sección", () => {
    const doble = CON_PLANTILLA.replace(
      "</body>",
      '<section><div data-ol-item>otra</div></section></body>',
    );
    const out = fillCollectionTemplate(doble, [item(), item({ id: "b" })]).html;
    expect(out).toContain(">otra<");
    expect(parse(out).querySelectorAll("[data-ol-item]")).toHaveLength(3);
  });
});

describe("hasCollectionTemplate", () => {
  it("distingue plantilla de banda vacía", () => {
    expect(hasCollectionTemplate(CON_PLANTILLA)).toBe(true);
    expect(hasCollectionTemplate(LEGADA)).toBe(false);
  });

  it("no confunde data-ol-item-field suelto con una tarjeta", () => {
    expect(hasCollectionTemplate('<p data-ol-item-field="title">x</p>')).toBe(false);
  });
});

describe("bakeCollections delega en la plantilla", () => {
  it("con plantilla NO dibuja la rejilla genérica", () => {
    const out = bakeCollections(CON_PLANTILLA, { items: [item()], layout: "grid" });
    expect(out).not.toContain("data-ol-collection-widget");
    expect(out).toContain("rounded-3xl bg-white shadow-lg");
  });

  it("sin plantilla sigue horneando la rejilla de siempre", () => {
    const out = bakeCollections(LEGADA, { items: [item()], layout: "grid" });
    expect(out).toContain("data-ol-collection-widget");
  });
});

describe("strip-disabled-bands", () => {
  const OFF = { bookings: false, collections: false, comments: false, chat: false };

  it("apagado NO borra una sección con tarjetas del modelo", () => {
    const out = stripDisabledModuleBands(CON_PLANTILLA, OFF);
    expect(out).toContain("data-ol-collection-section");
    expect(out).toContain("<h2>Menú</h2>");
  });

  it("apagado sigue borrando la banda vacía de siempre", () => {
    const out = stripDisabledModuleBands(LEGADA, OFF);
    expect(out).not.toContain("data-ol-collection-section");
  });
});

describe("previewCollectionCards", () => {
  it("sella las copias y NO toca las tarjetas del modelo", () => {
    const out = previewCollectionCards(CON_PLANTILLA, [item({ title: "Pastor" })], {
      marker: "data-openlen-modules-preview",
      attrs: { "data-openlen-no-edit": "" },
    });
    expect(out).toContain("data-openlen-modules-preview");
    expect(out).toContain(">Pastor<");
    // Las tres originales siguen enteras: el guardado debe poder devolverlas.
    const originales = parse(out)
      .querySelectorAll("[data-ol-item]")
      .filter((n) => n.getAttribute("data-openlen-modules-preview") === undefined);
    expect(originales).toHaveLength(3);
    expect(out).toContain("display:none!important");
  });

  it("sin plantilla devuelve el html tal cual", () => {
    expect(previewCollectionCards(LEGADA, [item()], { marker: "m" })).toBe(LEGADA);
  });
});

/**
 * EL MARCO VACÍO. MEDIDO en el render de una generación real: el modelo puso la
 * proporción en un `<div class="aspect-[4/3]">` con la `<img>` dentro.
 * Escondiendo sólo la imagen, el envoltorio seguía reservando su altura y la
 * tarjeta salía con un hueco enorme. El prompt le pide la proporción en la
 * propia `<img>`; un prompt no es una garantía.
 */
describe("ítem sin foto — el marco tampoco reserva sitio", () => {
  const CON_MARCO = `<article data-ol-item class="card">
      <div class="marco relative aspect-[4/3] overflow-hidden">
        <img data-ol-item-field="image" src="/muestra.jpg" alt="m" class="h-full w-full object-cover">
      </div>
      <h3 data-ol-item-field="title">Muestra</h3>
    </article>`;

  it("esconde el envoltorio que fija la proporción, no sólo la imagen", () => {
    const out = fillCollectionTemplate(PAGE(CON_MARCO), [item({ imageUrl: null })]).html;
    const marco = parse(out).querySelector(".marco");
    expect(marco?.getAttribute("style") ?? "").toContain("display:none");
  });

  it("con foto el marco sigue visible", () => {
    const out = fillCollectionTemplate(PAGE(CON_MARCO), [
      item({ imageUrl: "https://images.openlen.com/x.jpg" }),
    ]).html;
    const marco = parse(out).querySelector(".marco");
    expect(marco?.getAttribute("style") ?? "").not.toContain("display:none");
    expect(out).toContain("https://images.openlen.com/x.jpg");
  });

  // El mismo modo de fallo que ya cazamos con las insignias: un ítem sin foto
  // no puede dejar el marco oculto para todos los siguientes.
  it("un ítem sin foto no apaga el marco del siguiente", () => {
    const out = fillCollectionTemplate(PAGE(CON_MARCO), [
      item({ id: "a", imageUrl: null }),
      item({ id: "b", imageUrl: "https://images.openlen.com/b.jpg" }),
    ]).html;
    const marcos = parse(out).querySelectorAll(".marco");
    expect(marcos).toHaveLength(2);
    expect(marcos[0]?.getAttribute("style") ?? "").toContain("display:none");
    expect(marcos[1]?.getAttribute("style") ?? "").not.toContain("display:none");
  });

  // Falla hacia quedarse corto: esconder de más borraría el producto entero.
  it("NUNCA sube a un padre que tiene hermanos — sería la tarjeta entera", () => {
    const plano = `<article data-ol-item class="card h-96">
        <img data-ol-item-field="image" src="/m.jpg" class="w-full">
        <h3 data-ol-item-field="title">Muestra</h3>
      </article>`;
    const out = fillCollectionTemplate(PAGE(plano), [item({ title: "Pastor", imageUrl: null })]).html;
    // El <article> lleva `h-96` (reserva altura) pero tiene DOS hijos: no es un
    // marco de foto. Se esconde sólo la imagen y el producto sigue visible.
    expect(out).toContain(">Pastor<");
    const art = parse(out).querySelector("[data-ol-item]");
    expect(art?.getAttribute("style") ?? "").not.toContain("display:none");
  });

  it("sin envoltorio que reserve altura se esconde la imagen y ya", () => {
    const out = fillCollectionTemplate(CON_PLANTILLA, [item({ imageUrl: null })]).html;
    const img = parse(out).querySelector('[data-ol-item-field="image"]');
    expect(img?.getAttribute("style") ?? "").toContain("display:none");
  });
});
