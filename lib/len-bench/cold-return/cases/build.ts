// THE SIX BUILD CASES (spec local 2026-11-13-conversar-todo-el-mes, §8.2): building with Len over several
// turns — two pages (about 40.000 tokens of conversation), two apps (about 100.000) and two apps with more
// rounds of changes (about 220.000). What a conversation really measures is read after building it.
//
// Each project starts with a data file, /data/catalogo.csv, that Len reads in the first turn: that read is
// the «result of long ago». Coming back, the owner asks:
//   · what they themselves said at the start (the shop's name or town, the colour they ruled out);
//   · to go on with the LAST thing that was done (a change to it, checked in the files);
//   · who supplies an item, a column of the data file that no screen was ever asked to show.
import { esqueletoDeApp } from "@/lib/apps/esqueleto";
import { catalogCsv, makeCorpus, namePattern, type Corpus, type DomainSpec } from "../corpus";
import type { ReturnCase, ReturnQuestion } from "../types";
import { DOMAINS } from "./chat";

const DATA_FILE = "/data/catalogo.csv";

interface BuildSpec {
  readonly id: string;
  readonly targetKTokens: 40 | 100 | 220;
  readonly domain: DomainSpec;
  readonly shop: string;
  readonly town: string;
}

/** A row deep in the file: not one of the first, which a page shows. */
const askedAbout = (corpus: Corpus) => corpus.items[Math.floor(corpus.items.length * 0.6)]!;

const escaped = (s: string): RegExp => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"), "i");

function early(spec: BuildSpec): ReturnQuestion {
  return {
    kind: "early",
    prompt: "Hola otra vez. Antes de seguir: ¿qué color te pedí que no usaras, y en qué ciudad está mi tienda?",
    checks: [
      { on: "answer", has: /morado/i, why: "no dice el color que el dueño descartó al principio (morado)" },
      { on: "answer", has: escaped(spec.town), why: `no dice la ciudad que el dueño dio al principio (${spec.town})` },
    ],
  };
}

function oldResult(corpus: Corpus): ReturnQuestion {
  const item = askedAbout(corpus);
  return {
    kind: "old_result",
    prompt: `Una consulta: según mi archivo de catálogo, ¿quién es el proveedor de la ${item.name}?`,
    checks: [{ on: "answer", has: namePattern(item.maker), why: `no da el proveedor de la ${item.name} (${item.maker}), que sólo está en ${DATA_FILE}` }],
  };
}

function pageCase(spec: BuildSpec): ReturnCase {
  const corpus = makeCorpus(spec.domain, { seed: spec.id, perCategory: 8, opinions: 0 });
  const d = spec.domain;
  return {
    id: spec.id,
    family: "build",
    targetKTokens: spec.targetKTokens,
    title: spec.shop,
    brief: `La página de ${spec.shop}, una tienda de ${d.plural} en ${spec.town}.`,
    start: { html: "", ficheros: { [DATA_FILE]: catalogCsv(corpus) } },
    build: [
      `Tengo una tienda de ${d.plural} que se llama ${spec.shop}, en ${spec.town}. En ${DATA_FILE} está mi catálogo con precios. Hazme la página de la tienda: el nombre, una frase de bienvenida, una sección «Destacadas» con las seis primeras ${d.plural} del archivo y su precio, y un botón de WhatsApp al 56 9 5550 0142. Nada de color morado en ningún sitio.`,
      "Añade una sección de preguntas frecuentes con cuatro preguntas sobre envíos y formas de pago.",
      "Añade una sección con los horarios: lunes a viernes de 9 a 19 y sábados de 10 a 14.",
      "Añade al final una franja con el texto «Envíos gratis desde 600 pesos» y un botón que diga «Ver catálogo».",
    ],
    questions: [
      early(spec),
      {
        kind: "continue",
        prompt: "Sigue con lo último que hicimos: en la franja del final cambia 600 por 750, y que el botón diga «Pide la tuya» en vez de «Ver catálogo».",
        checks: [
          { on: "file", path: "/index.html", has: /Pide la tuya/i, why: "el botón de la franja no dice «Pide la tuya»" },
          { on: "file", path: "/index.html", has: /\b750\b/, why: "la franja no dice 750" },
          { on: "file", path: "/index.html", lacks: /Ver cat[áa]logo/i, why: "el botón sigue diciendo «Ver catálogo»" },
          { on: "file", path: "/index.html", has: escaped(spec.shop), why: `la página ya no lleva el nombre de la tienda (${spec.shop}): se perdió lo que había` },
        ],
      },
      oldResult(corpus),
    ],
  };
}

function appCase(spec: BuildSpec): ReturnCase {
  const corpus = makeCorpus(spec.domain, { seed: spec.id, perCategory: 14, opinions: 0 });
  const d = spec.domain;
  const skeleton = esqueletoDeApp({ titulo: spec.shop, idioma: "es" });
  const first = `Tengo una tienda de ${d.plural} que se llama ${spec.shop}, en ${spec.town}. En ${DATA_FILE} está mi catálogo. Hazme una app para atender en el mostrador: una pantalla con la lista completa, con buscador por nombre y filtro por categoría, y al tocar una ${d.noun} su detalle con el precio. Todo en español y nada de color morado.`;
  const quote = `Añade una pantalla «Cotización»: elijo varias ${d.plural} con su cantidad y me da el total.`;
  const discount = "En la cotización, aplica 8 % de descuento cuando el total pase de 50.000 pesos y muéstralo en una línea aparte.";
  const favourites = `Añade una pantalla «Favoritas» donde guardo ${d.plural} y se conservan al recargar.`;
  const sorting = "En la lista, permite ordenar por precio de menor a mayor y de mayor a menor.";
  const notice = "Añade en la pantalla de inicio un aviso arriba que diga «Precios vigentes hasta el 30 de noviembre».";
  return {
    id: spec.id,
    family: "build",
    targetKTokens: spec.targetKTokens,
    title: spec.shop,
    brief: `La app de mostrador de ${spec.shop}, una tienda de ${d.plural} en ${spec.town}.`,
    start: { html: skeleton.html, app: skeleton.app, ficheros: { ...skeleton.ficheros, [DATA_FILE]: catalogCsv(corpus) } },
    // The longer cases are the same app with two more rounds before the last one.
    build: spec.targetKTokens === 220 ? [first, quote, discount, favourites, sorting, notice] : [first, quote, discount, notice],
    questions: [
      early(spec),
      {
        kind: "continue",
        prompt: "Sigue con lo último: cambia el aviso de arriba para que diga «Precios vigentes hasta el 15 de diciembre».",
        checks: [
          { on: "files", has: /15 de diciembre/i, why: "ningún fichero de la app dice «15 de diciembre»" },
          { on: "files", lacks: /30 de noviembre/i, why: "el aviso viejo («30 de noviembre») sigue en la app" },
          { on: "files", has: /Cotizaci[óo]n/i, why: "la pantalla «Cotización» ya no está: se perdió lo que había" },
        ],
      },
      oldResult(corpus),
    ],
  };
}

const D = DOMAINS();

export const BUILD_CASES: readonly ReturnCase[] = [
  pageCase({ id: "build-page-lamps-40k", targetKTokens: 40, domain: D.LAMPS, shop: "Farol Sereno", town: "Valdivia" }),
  pageCase({ id: "build-page-bikes-40k", targetKTokens: 40, domain: D.BIKES, shop: "Piñón Fijo", town: "Antofagasta" }),
  appCase({ id: "build-app-pumps-100k", targetKTokens: 100, domain: D.PUMPS, shop: "Aguas Claras", town: "Ovalle" }),
  appCase({ id: "build-app-printers-100k", targetKTokens: 100, domain: D.PRINTERS, shop: "Papel Mojado", town: "Rancagua" }),
  appCase({ id: "build-app-looms-220k", targetKTokens: 220, domain: D.LOOMS, shop: "Hilo Rojo", town: "Temuco" }),
  appCase({ id: "build-app-mixers-220k", targetKTokens: 220, domain: D.MIXERS, shop: "Masa Madre", town: "Coquimbo" }),
];
