// Memoria de originales del editor (data-ol-was) — codec puro compartido.
// El runtime del iframe inyecta parseStash/serializeStash vía toString()
// (mismo patrón que splitContainer), así que AMBAS deben ser auto-contenidas.
// El panel importa todo para pintar dots de procedencia y armar resets.
//
// Formato: JSON { "<css-prop>": "<valor inline previo>" }. "" = no había
// estilo inline (reset = removeProperty y la cascada del diseño vuelve).
// Primer toque gana: el stash siempre guarda el valor DE DISEÑO.
// El atributo persiste en el HTML del proyecto y solo se elimina al publicar.

export const DESIGN_STASH_ATTR = "data-ol-was";

export function parseStash(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    const out: Record<string, string> = {};
    for (const k of Object.keys(v as Record<string, unknown>)) {
      const val = (v as Record<string, unknown>)[k];
      if (typeof val === "string") out[k] = val;
    }
    return out;
  } catch {
    return {};
  }
}

export function serializeStash(map: Record<string, string>): string | null {
  if (Object.keys(map).length === 0) return null;
  return JSON.stringify(map);
}

export const FACET_PROPS = {
  texto: [
    "font-size",
    "line-height",
    "font-weight",
    "font-style",
    "text-align",
    "color",
    "font-family",
  ],
  espaciado: ["padding", "padding-top", "padding-bottom", "gap"],
  estilo: [
    "background-color",
    "background-image",
    "background-size",
    "background-position",
    "background-repeat",
    "border",
    "border-radius",
  ],
} as const;

export type Facet = keyof typeof FACET_PROPS;

export function facetOf(prop: string): Facet | null {
  for (const f of Object.keys(FACET_PROPS) as Facet[]) {
    if ((FACET_PROPS[f] as readonly string[]).includes(prop)) return f;
  }
  return null;
}
