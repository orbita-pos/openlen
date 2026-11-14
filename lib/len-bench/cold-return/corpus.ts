// THE MADE-UP WEB OF A CASE. A chat case is research over a catalog that does not exist — invented makers,
// invented models, invented prices — so that nothing in it can be answered from what a model already knows:
// a right answer comes from the conversation, or from reading the page again. Everything is generated from
// a seed: the same case is the same web on every machine and in every run, and the checks of a question are
// computed from the same items the pages are written with.
import type { WebDelCaso } from "@/lib/len-bench/tipos";

export interface AttrSpec {
  readonly key: string;
  /** As the page's table names it, in lower case: «precio». */
  readonly label: string;
  readonly unit: string;
  /** How the unit may be written back, as a pattern: «mes(es)?», «km|kil[óo]metros». Absent = as printed. */
  readonly said?: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

export interface DomainSpec {
  /** The site, under a reserved name that resolves nowhere. */
  readonly site: string;
  readonly siteName: string;
  /** «bomba», «bombas». */
  readonly noun: string;
  readonly plural: string;
  /** Stems of invented model names. */
  readonly brands: readonly string[];
  /** One page each. A single distinctive word: the search rule matches on it. */
  readonly categories: readonly string[];
  /** The first is the price. */
  readonly attrs: readonly [AttrSpec, ...AttrSpec[]];
  /** In every table, and never asked about while the conversation is built: what an «old result» question
   *  asks for. */
  readonly hidden: AttrSpec;
  /** Invented suppliers: the column of a data file nobody is asked to show. */
  readonly makers: readonly string[];
}

export interface Item {
  readonly name: string;
  readonly category: number;
  readonly maker: string;
  readonly values: Readonly<Record<string, number>>;
}

export interface Corpus {
  readonly spec: DomainSpec;
  readonly items: readonly Item[];
  readonly web: WebDelCaso;
  /** The items of a category, in the order its page lists them. */
  of(category: number): readonly Item[];
  url(category: number): string;
}

function seedOf(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const slug = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** A number as a page prints it, with a thin grouping the checks do not depend on: 4385 → «4,385». */
export function printed(n: number): string {
  return n.toLocaleString("en-US");
}

/** The digits of a number however they were written back, without what may follow them. */
function numberSource(n: number): string {
  const digits = String(Math.round(n));
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, "[.,\\s\u00a0\u202f]?");
  return `(?<![\\d.,])${grouped}(?:[.,]0{1,2})?`;
}

/** A pattern that finds a number however it was written back: 4385, 4,385, 4.385 or 4 385, with or without
 *  empty cents (4,385.00) — and not as part of a longer number, nor of one with real decimals. */
export function numberPattern(n: number): RegExp {
  return new RegExp(`${numberSource(n)}(?![.,]?\\d)`);
}

/** A pattern for a value as an answer gives it: the number and, right after it, its unit — «11 meses»,
 *  «2,350 km». The number alone is elsewhere on a page (a price ends in it, another item has it for something
 *  else); with its unit it is one line of one table. */
export function valuePattern(n: number, attr: AttrSpec): RegExp {
  return new RegExp(`${numberSource(n)}\\s*(?:${attr.said ?? attr.unit})(?![A-Za-zÁÉÍÓÚáéíóúñ])`, "i");
}

const VOWELS: Readonly<Record<string, string>> = { a: "[aá]", e: "[eé]", i: "[ií]", o: "[oó]", u: "[uúü]", n: "[nñ]" };

/** A pattern that finds a category in a search however it was typed: with or without its accents, in the
 *  plural the catalog uses or in the singular («sumergibles», «sumergible»; «solares», «solar»). */
export function categoryPattern(category: string): RegExp {
  const plain = category
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const stem = plain.replace(/s$/, "").replace(/([aeiou][lrnd])e$/, "$1");
  return new RegExp([...stem].map((ch) => VOWELS[ch] ?? ch.replace(/[.*+?^${}()|[\]\\]/g, (special) => `\\${special}`)).join(""), "i");
}

/** A pattern for a name, whatever the case and with any dash or space between its parts. */
export function namePattern(name: string): RegExp {
  return new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[-\s]+/g, "[-\\s\u2011]?"), "i");
}

// 🔴 No sentence here may use a unit that a `hidden` attribute is printed in (meses, minutos, horas,
// kilómetros, páginas): an «old result» is asked back as its number WITH its unit, and that pair has to be
// on the page exactly once — in the item's table (pinned in cases.test.ts).
const OPINIONS = [
  "En las pruebas de {site} funcionó {h} jornadas seguidas sin incidencias y con un consumo estable.",
  "Quien la compró en la última temporada destaca que la instalación tomó menos de {m} segundos.",
  "El fabricante, {maker}, la revisó en su versión {v} y cambió el empaque y los sellos.",
  "Se entrega en caja de {k} kilos con manual impreso y una lista de repuestos numerada.",
  "En el taller de {site} midieron una variación de apenas {p} por ciento entre unidades del mismo lote.",
  "Lleva {y} años en el catálogo y sigue entre las más pedidas de su categoría.",
  "Su ficha recomienda una revisión cada {r} semanas y guardar el comprobante de compra.",
  "Para pedidos de más de {q} unidades, {maker} ofrece entrega directa desde su almacén.",
] as const;

/**
 * The web of a case: an index, one page per category with `perCategory` items each, and the search rules
 * that lead to them. `opinions` sentences of prose per item set how heavy a page is.
 */
export function makeCorpus(spec: DomainSpec, o: { readonly seed: string; readonly perCategory: number; readonly opinions: number }): Corpus {
  const next = mulberry32(seedOf(o.seed));
  const pick = <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)]!;
  const between = (a: AttrSpec): number => a.min + Math.floor((next() * (a.max - a.min)) / a.step) * a.step;
  const all = [...spec.attrs, spec.hidden];

  const used = new Set<string>();
  const items: Item[] = [];
  for (let c = 0; c < spec.categories.length; c++) {
    for (let i = 0; i < o.perCategory; i++) {
      let name = "";
      do name = `${pick(spec.brands)} ${String.fromCharCode(65 + Math.floor(next() * 26))}-${100 + Math.floor(next() * 900)}`;
      while (used.has(name));
      used.add(name);
      const values: Record<string, number> = {};
      for (const a of all) values[a.key] = between(a);
      items.push({ name, category: c, maker: pick(spec.makers), values });
    }
  }
  // Within a category no two items share a price, nor the hidden value: «the cheapest» and «the one with…»
  // have one answer.
  for (let c = 0; c < spec.categories.length; c++) {
    for (const key of [spec.attrs[0].key, spec.hidden.key]) {
      const a = all.find((x) => x.key === key)!;
      const seen = new Set<number>();
      for (const item of items.filter((x) => x.category === c)) {
        let v = item.values[key]!;
        while (seen.has(v)) v = v + a.step <= a.max ? v + a.step : a.min;
        seen.add(v);
        (item.values as Record<string, number>)[key] = v;
      }
    }
  }

  const of = (category: number) => items.filter((x) => x.category === category);
  const url = (category: number) => `https://${spec.site}/${slug(spec.plural)}/${slug(spec.categories[category]!)}`;
  const fill = (template: string, item: Item): string =>
    template
      .replace(/\{site\}/g, spec.siteName)
      .replace(/\{maker\}/g, item.maker)
      .replace(/\{h\}/g, String(40 + Math.floor(next() * 900)))
      .replace(/\{m\}/g, String(10 + Math.floor(next() * 80)))
      .replace(/\{v\}/g, `${1 + Math.floor(next() * 6)}.${Math.floor(next() * 10)}`)
      .replace(/\{k\}/g, String(2 + Math.floor(next() * 40)))
      .replace(/\{p\}/g, String(1 + Math.floor(next() * 9)))
      .replace(/\{y\}/g, String(2 + Math.floor(next() * 14)))
      .replace(/\{r\}/g, String(3 + Math.floor(next() * 21)))
      .replace(/\{q\}/g, String(5 + Math.floor(next() * 45)));

  const paginas: Record<string, string> = {};
  for (let c = 0; c < spec.categories.length; c++) {
    const title = `${spec.plural[0]!.toUpperCase()}${spec.plural.slice(1)} ${spec.categories[c]} — ${spec.siteName}`;
    const body = of(c)
      .map((item) => {
        const rows = all.map((a) => `<tr><td>${a.label}</td><td>${printed(item.values[a.key]!)} ${a.unit}</td></tr>`).join("");
        const prose = Array.from({ length: o.opinions }, () => fill(pick(OPINIONS), item)).join(" ");
        return `<h2>${item.name}</h2>\n<p>${spec.noun[0]!.toUpperCase()}${spec.noun.slice(1)} de ${item.maker}. ${prose}</p>\n<table><tr><th>Característica</th><th>Valor</th></tr>${rows}</table>`;
      })
      .join("\n");
    paginas[url(c)] = `<!doctype html><html lang="es"><head><title>${title}</title></head><body><h1>${title}</h1>\n<p>Catálogo de ${spec.siteName}: ${of(c).length} ${spec.plural} ${spec.categories[c]}, con su ficha completa.</p>\n${body}\n</body></html>`;
  }
  const index = `https://${spec.site}/`;
  paginas[index] = `<!doctype html><html lang="es"><head><title>${spec.siteName}</title></head><body><h1>${spec.siteName}</h1><p>Catálogo de ${spec.plural} por categoría.</p><ul>${spec.categories
    .map((name, c) => `<li><a href="${url(c)}">${spec.plural} ${name}</a></li>`)
    .join("")}</ul></body></html>`;

  const result = (c: number) => ({
    titulo: `${spec.plural[0]!.toUpperCase()}${spec.plural.slice(1)} ${spec.categories[c]} — ${spec.siteName}`,
    url: url(c),
    fragmento: `Las ${of(c).length} ${spec.plural} ${spec.categories[c]} de ${spec.siteName}, con precios y ficha técnica.`,
  });
  const web: WebDelCaso = {
    busquedas: [
      // The category named in the query; then anything else finds the site's index and its pages.
      ...spec.categories.map((name, c) => ({ si: categoryPattern(name), resultados: [result(c)] })),
      {
        si: /./,
        resultados: [{ titulo: spec.siteName, url: index, fragmento: `Catálogo de ${spec.plural} de ${spec.siteName}, por categoría.` }, ...spec.categories.map((_, c) => result(c))].slice(0, 8),
      },
    ],
    paginas,
  };
  return { spec, items, web, of, url };
}

/** The catalog as a data file: one line per item, with a supplier column no page of a build is asked to show. */
export function catalogCsv(corpus: Corpus): string {
  const [price] = corpus.spec.attrs;
  const lines = corpus.items.map((item) => [item.name, corpus.spec.categories[item.category], item.values[price.key], item.maker].join(","));
  return `nombre,categoria,${price.label},proveedor\n${lines.join("\n")}\n`;
}
