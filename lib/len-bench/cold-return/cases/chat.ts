// THE SIX CHAT CASES (spec local 2026-11-13-conversar-todo-el-mes, §8.2): talking and researching with the
// person's own assistant, over a web that does not exist (../corpus.ts). Three of about 40.000 tokens and
// three of about 100.000 — the difference is how heavy each page of the catalog is.
//
// Every case is the same conversation in another trade: fifteen messages from someone who is choosing what to
// buy, a page read at almost every one. Coming back, the person asks three things:
//   · what they themselves said at the very start (nothing of theirs is ever trimmed; a summary may lose it);
//   · about the LAST list that was looked at (a recent result, which the trim keeps);
//   · a detail of the FIRST list that nobody asked about then (an old result, which the trim clears: the
//     assistant has to read the page again, or say it no longer has it — never make it up).
import { makeCorpus, namePattern, numberPattern, type AttrSpec, type Corpus, type DomainSpec } from "../corpus";
import type { ReturnCase } from "../types";

interface ChatSpec {
  readonly id: string;
  readonly targetKTokens: 40 | 100;
  readonly domain: DomainSpec;
  /** Her name: one person cannot have two assistants of the same name, and every case is the same owner's. */
  readonly assistant: string;
  /** Who is asking and for what: the opening line. */
  readonly who: string;
  /** Two things the person says about themselves in the first message, and how they ask for them back. */
  readonly facts: readonly [PersonalFact, PersonalFact];
}

interface PersonalFact {
  readonly said: string;
  readonly asked: string;
  readonly answer: RegExp;
}

const cap = (s: string): string => s[0]!.toUpperCase() + s.slice(1);

const cheapest = (corpus: Corpus, category: number) => {
  const price = corpus.spec.attrs[0].key;
  return [...corpus.of(category)].sort((a, b) => a.values[price]! - b.values[price]!)[0]!;
};
const dearest = (corpus: Corpus, category: number) => {
  const price = corpus.spec.attrs[0].key;
  return [...corpus.of(category)].sort((a, b) => b.values[price]! - a.values[price]!)[0]!;
};

/** How heavy the catalog's pages are for a conversation of that size: fifteen turns, a page at most of them. */
// The arithmetic: each turn adds the page it read plus some 900 tokens of question, search, thinking and
// answer, so a page is about 1.800 tokens for 40.000 and about 5.800 for 100.000.
const WEIGHT = { 40: { perCategory: 14, opinions: 3 }, 100: { perCategory: 36, opinions: 4 } } as const;

export function chatCase(spec: ChatSpec): ReturnCase & { readonly corpus: Corpus } {
  const corpus = makeCorpus(spec.domain, { seed: spec.id, ...WEIGHT[spec.targetKTokens] });
  const d = spec.domain;
  const cat = (c: number) => `${d.plural} ${d.categories[c]}`;
  const [price, second] = [d.attrs[0], d.attrs[1] ?? d.attrs[0]] as [AttrSpec, AttrSpec];
  const a = corpus.of(0)[2]!;
  const b = corpus.of(1)[4]!;
  const finalists = [corpus.of(6)[1]!, corpus.of(7)[3]!] as const;
  const last = d.categories.length - 1;
  const old = corpus.of(0)[3]!;

  const build = [
    `Hola. ${spec.who} Dos cosas para que las tengas presentes: ${spec.facts[0].said}, y ${spec.facts[1].said}. Quiero que me ayudes a comparar ${d.plural} en ${d.site}. Empieza por las ${cat(0)}: ¿cuáles hay y cuánto cuesta cada una?`,
    `Bien. Ahora mira las ${cat(1)} en el mismo sitio. ¿Cuál tiene mejor ${second.label}?`,
    `Revisa también las ${cat(2)}. Dime la más barata y su ${second.label}.`,
    `Compara la ${a.name} con la ${b.name}: ¿cuál me conviene por ${price.label}?`,
    `Sigamos con las ${cat(3)}. ¿Hay alguna por debajo de ${Math.round((price.min + price.max) / 2)} ${price.unit}?`,
    `Y las ${cat(4)}, ¿qué tal? Dame las tres con mejor ${second.label}.`,
    `De todo lo que hemos visto hasta ahora, ¿cuál tiene el mayor ${second.label}? Dime de qué lista es.`,
    `Ahora las ${cat(5)}. Resúmelas en pocas líneas.`,
    `Mira las ${cat(6)} y dime cuáles dos elegirías tú y por qué.`,
    `Cambio de planes: necesito decidir antes de fin de mes. Revisa las ${cat(7)} con eso en mente.`,
    `Compara la ${finalists[0].name} con la ${finalists[1].name}.`,
    `Decidido: mis finalistas son la ${finalists[0].name} y la ${finalists[1].name}. Las demás, descartadas.`,
    `Antes de cerrar, mira las ${cat(last)} por si se me escapa algo.`,
    `De esa última lista, ¿cuál es la más barata?`,
    `Perfecto, gracias. Lo dejo aquí por hoy; la semana que viene lo retomo contigo.`,
  ];

  const top = dearest(corpus, last);
  return {
    id: spec.id,
    family: "chat",
    targetKTokens: spec.targetKTokens,
    title: `Comparar ${d.plural}`,
    brief: `Investigación para elegir ${d.plural}.`,
    start: { html: "" },
    assistant: { name: spec.assistant },
    web: corpus.web,
    build,
    questions: [
      {
        kind: "early",
        prompt: `Hola de nuevo. Antes de seguir, recuérdame dos cosas que te dije al principio: ${spec.facts[0].asked} y ${spec.facts[1].asked}`,
        checks: [
          { on: "answer", has: spec.facts[0].answer, why: `no dice lo primero que la persona contó de sí misma (${spec.facts[0].said})` },
          { on: "answer", has: spec.facts[1].answer, why: `no dice lo segundo que la persona contó de sí misma (${spec.facts[1].said})` },
        ],
      },
      {
        kind: "continue",
        prompt: `De la última lista que vimos, las ${cat(last)}: ¿cuál era la más cara y cuánto costaba? Dime el nombre exacto.`,
        checks: [
          { on: "answer", has: namePattern(top.name), why: `no nombra la más cara de la última lista (${top.name})` },
          { on: "answer", has: numberPattern(top.values[price.key]!), why: `no da su ${price.label} (${top.values[price.key]})` },
        ],
      },
      {
        kind: "old_result",
        prompt: `Y una de la primera lista que revisamos, las ${cat(0)}: ¿qué ${d.hidden.label} tiene la ${old.name}?`,
        checks: [{ on: "answer", has: numberPattern(old.values[d.hidden.key]!), why: `no da el ${d.hidden.label} de la ${old.name} (${old.values[d.hidden.key]} ${d.hidden.unit}), que sólo está en su ficha` }],
      },
    ],
    corpus,
  };
}

const PRICE = (min: number, max: number, step: number, unit = "pesos"): AttrSpec => ({ key: "precio", label: "precio", unit, min, max, step });

const PUMPS: DomainSpec = {
  site: "riegoandino.example",
  siteName: "Riego Andino",
  noun: "bomba",
  plural: "bombas",
  brands: ["Kuntur", "Yaku", "Mayu", "Illapa", "Sumaq", "Wayra", "Qocha", "Tika"],
  categories: ["sumergibles", "periféricas", "centrífugas", "solares", "autocebantes", "multietapa", "manuales", "portátiles", "industriales"],
  attrs: [PRICE(2_400, 38_000, 35), { key: "caudal", label: "caudal", unit: "litros por minuto", min: 20, max: 480, step: 5 }, { key: "altura", label: "altura máxima", unit: "metros", min: 8, max: 140, step: 2 }],
  hidden: { key: "garantia", label: "garantía", unit: "meses", min: 6, max: 96, step: 1 },
  makers: ["Talleres Pumasillo", "Hidráulica del Cañón", "Fundición Tres Ríos", "Motores Altiplano", "Casa Quillabamba"],
};

const BIKES: DomainSpec = {
  site: "pedalnorte.example",
  siteName: "Pedal Norte",
  noun: "bicicleta",
  plural: "bicicletas",
  brands: ["Cierzo", "Brisa", "Garúa", "Tramontana", "Solano", "Levante", "Ábrego", "Galerna"],
  categories: ["urbanas", "plegables", "eléctricas", "infantiles", "gravel", "montañeras", "tándem", "reclinadas", "cargueras"],
  attrs: [PRICE(3_200, 64_000, 45), { key: "peso", label: "peso", unit: "gramos", min: 7_200, max: 28_000, step: 100 }, { key: "velocidades", label: "velocidades", unit: "marchas", min: 1, max: 27, step: 1 }],
  hidden: { key: "revision", label: "intervalo de revisión", unit: "kilómetros", min: 300, max: 4_000, step: 50 },
  makers: ["Cuadros Ribera", "Taller Monteluz", "Ciclos Arrayán", "Fábrica La Rueda", "Hermanos Zubieta"],
};

const MIXERS: DomainSpec = {
  site: "amasadorasdelsur.example",
  siteName: "Amasadoras del Sur",
  noun: "amasadora",
  plural: "amasadoras",
  brands: ["Brasa", "Tizón", "Rescoldo", "Lumbre", "Ascua", "Fogón", "Candela", "Llama"],
  categories: ["espirales", "planetarias", "horizontales", "basculantes", "industriales", "compactas", "refrigeradas", "artesanales", "sobadoras"],
  attrs: [PRICE(8_500, 240_000, 250), { key: "capacidad", label: "capacidad", unit: "kilos de masa", min: 3, max: 160, step: 1 }, { key: "potencia", label: "potencia", unit: "vatios", min: 600, max: 15_000, step: 50 }],
  hidden: { key: "amasado", label: "tiempo de amasado", unit: "minutos", min: 4, max: 48, step: 1 },
  makers: ["Refractarios Maipo", "Metalúrgica Lonquén", "Hornería Chiloé", "Fundo San Blas", "Calderas Itata"],
};

const PRINTERS: DomainSpec = {
  site: "tintayforma.example",
  siteName: "Tinta y Forma",
  noun: "impresora",
  plural: "impresoras",
  brands: ["Sepia", "Índigo", "Carmín", "Ocre", "Añil", "Bermejo", "Cobalto", "Gualda"],
  categories: ["láser", "térmicas", "matriciales", "fotográficas", "planas", "textiles", "resina", "etiquetadoras", "portátiles"],
  attrs: [PRICE(1_900, 180_000, 95), { key: "velocidad", label: "velocidad", unit: "páginas por minuto", min: 4, max: 120, step: 1 }, { key: "resolucion", label: "resolución", unit: "puntos por pulgada", min: 200, max: 4_800, step: 100 }],
  hidden: { key: "ciclo", label: "ciclo mensual", unit: "páginas", min: 500, max: 90_000, step: 500 },
  makers: ["Gráfica Tucapel", "Imprenta Yungay", "Rodillos Ñuble", "Tipos del Biobío", "Casa Linares"],
};

const LAMPS: DomainSpec = {
  site: "luzdepatio.example",
  siteName: "Luz de Patio",
  noun: "lámpara",
  plural: "lámparas",
  brands: ["Alba", "Ocaso", "Cénit", "Aurora", "Penumbra", "Fulgor", "Destello", "Lucero"],
  categories: ["colgantes", "empotradas", "solares", "regulables", "industriales", "náuticas", "portátiles", "sumergibles", "decorativas"],
  attrs: [PRICE(180, 9_600, 15), { key: "lumenes", label: "flujo", unit: "lúmenes", min: 120, max: 14_000, step: 20 }, { key: "consumo", label: "consumo", unit: "vatios", min: 2, max: 240, step: 1 }],
  hidden: { key: "vida", label: "vida útil", unit: "horas", min: 3_000, max: 90_000, step: 500 },
  makers: ["Vidrios Putaendo", "Latonería Petorca", "Luminaria Illapel", "Taller Combarbalá", "Casa Ovalle"],
};

const LOOMS: DomainSpec = {
  site: "telaresaustrales.example",
  siteName: "Telares Australes",
  noun: "máquina",
  plural: "máquinas",
  brands: ["Urdimbre", "Lanzadera", "Trama", "Huso", "Madeja", "Ovillo", "Rueca", "Bastidor"],
  categories: ["rectas", "remalladoras", "bordadoras", "tejedoras", "cortadoras", "planchadoras", "ojaladoras", "recubridoras", "acolchadoras"],
  attrs: [PRICE(4_800, 310_000, 180), { key: "puntadas", label: "velocidad", unit: "puntadas por minuto", min: 400, max: 9_000, step: 50 }, { key: "agujas", label: "agujas", unit: "agujas", min: 1, max: 24, step: 1 }],
  hidden: { key: "engrase", label: "intervalo de engrase", unit: "horas", min: 8, max: 600, step: 4 },
  makers: ["Mecánica Aysén", "Telar Coyhaique", "Fundición Cochrane", "Taller Puyuhuapi", "Casa Chaitén"],
};

/** The catalogs, for the build cases: their data files are the same invented trades. */
export const DOMAINS = () => ({ PUMPS, BIKES, MIXERS, PRINTERS, LAMPS, LOOMS });

export const CHAT_CASES = [
  chatCase({
    id: "chat-pumps-40k",
    assistant: "Lucía",
    targetKTokens: 40,
    domain: PUMPS,
    who: "Tengo una huerta pequeña y necesito una bomba de agua.",
    facts: [
      { said: "mi pozo tiene 37 metros de profundidad", asked: "¿qué profundidad tiene mi pozo?", answer: /\b37\s*(m\b|metros)/i },
      { said: "no puedo gastar más de 18.400 pesos", asked: "¿cuál era mi tope de gasto?", answer: numberPattern(18_400) },
    ],
  }),
  chatCase({
    id: "chat-bikes-40k",
    assistant: "Marta",
    targetKTokens: 40,
    domain: BIKES,
    who: "Quiero una bicicleta para ir al trabajo.",
    facts: [
      { said: "mi trayecto diario es de 14 kilómetros", asked: "¿de cuántos kilómetros es mi trayecto?", answer: /\b14\s*(km\b|kil[óo]metros)/i },
      { said: "la guardo en un cuarto piso sin ascensor", asked: "¿dónde la voy a guardar?", answer: /cuarto\s+piso|4\.?º\s*piso|piso\s+4|sin\s+ascensor/i },
    ],
  }),
  chatCase({
    id: "chat-lamps-40k",
    assistant: "Irene",
    targetKTokens: 40,
    domain: LAMPS,
    who: "Estoy iluminando el patio de un restaurante.",
    facts: [
      { said: "el patio mide 96 metros cuadrados", asked: "¿cuánto mide el patio?", answer: /\b96\s*(m2|m²|metros)/i },
      { said: "el restaurante se llama Brasa Quieta", asked: "¿cómo se llama el restaurante?", answer: /brasa\s+quieta/i },
    ],
  }),
  chatCase({
    id: "chat-mixers-100k",
    assistant: "Clara",
    targetKTokens: 100,
    domain: MIXERS,
    who: "Voy a abrir una panadería y tengo que elegir la amasadora.",
    facts: [
      { said: "pienso hacer unas 650 piezas de pan al día", asked: "¿cuántas piezas de pan al día pienso hacer?", answer: /\b650\s*piezas/i },
      { said: "el local sólo tiene instalación monofásica", asked: "¿qué instalación eléctrica tiene el local?", answer: /monof[áa]sic/i },
    ],
  }),
  chatCase({
    id: "chat-printers-100k",
    assistant: "Elena",
    targetKTokens: 100,
    domain: PRINTERS,
    who: "Llevo una imprenta de barrio y quiero renovar equipo.",
    facts: [
      { said: "imprimo alrededor de 12.750 páginas al mes", asked: "¿cuántas páginas imprimo al mes?", answer: numberPattern(12_750) },
      { said: "el equipo tiene que caber en un mostrador de 80 centímetros", asked: "¿de qué ancho es el mostrador donde tiene que caber?", answer: /\b80\s*(cm\b|cent[íi]metros)/i },
    ],
  }),
  chatCase({
    id: "chat-looms-100k",
    assistant: "Sofía",
    targetKTokens: 100,
    domain: LOOMS,
    who: "Tengo un taller de confección con seis personas.",
    facts: [
      { said: "la mayor parte de lo que cosemos es mezclilla gruesa", asked: "¿qué tela cosemos sobre todo?", answer: /mezclilla/i },
      { said: "el taller cierra todo febrero", asked: "¿qué mes cierra el taller?", answer: /febrero/i },
    ],
  }),
] as const;
