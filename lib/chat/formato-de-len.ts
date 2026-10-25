// El markdown en línea que Len escribe, partido en trozos que el chat pinta.
//
// Medido el 2026-09-23 sobre los 83 cierres de la batería: 37 líneas con
// **negrita**, 12 con `código`, 1 con *cursiva*; ningún enlace, ningún título,
// ninguna lista numerada. Las listas con guion ya se leen bien con
// `whitespace-pre-wrap`. El chat pintaba el texto tal cual, y el dueño leía
// «**Cobrar**» con los asteriscos a la vista.
//
// Y LOS ENLACES (24/10/2026): con `web_search` Len cita sus fuentes como
// `[texto](url)`, y la respuesta del dólar en producción salía con los
// corchetes a la vista; una URL suelta tampoco se podía abrir. Ahora las dos
// son enlaces, con la regla de autoenlace de GFM (`lib/chat/links.ts`).
//
// Por eso esto y no una librería de markdown: son pocas marcas, y cada trozo sale
// como TEXTO que React escapa, sin HTML que inyectar. Lo que no casa con una
// marca completa —un ** sin cerrar, una multiplicación, un nombre_con_guiones—
// se queda como texto sin perder un carácter.

import { splitLinks } from "@/lib/chat/links";

export type Trozo = {
  readonly tipo: "texto" | "negrita" | "codigo" | "cursiva" | "enlace";
  readonly texto: string;
  /** Sólo en un `enlace`: adónde lleva (siempre http o https). */
  readonly href?: string;
};

// El orden importa: el código va primero porque dentro de él nada es formato,
// el enlace markdown antes que la negrita porque su texto puede llevarla, y la
// negrita antes que la cursiva porque «**» empieza por «*».
// La cursiva exige texto pegado a los dos asteriscos: «3 * 4 * 5» no lo es.
// La dirección del enlace admite UN nivel de paréntesis (las de Wikipedia).
const MARCAS =
  /`([^`\n]+)`|\[([^\]\n]+)\]\((https?:\/\/[^\s()]+(?:\([^\s()]*\)[^\s()]*)*)\)|\*\*([^*\n]+?)\*\*|\*([^\s*][^*\n]*?[^\s*]|[^\s*])\*/g;

/** El texto suelto, con sus URLs ya como enlaces. */
function conEnlaces(texto: string): Trozo[] {
  return splitLinks(texto).map((p) => (p.href ? { tipo: "enlace", texto: p.text, href: p.href } : { tipo: "texto", texto: p.text }));
}

export function trozosConFormato(texto: string): Trozo[] {
  const trozos: Trozo[] = [];
  let desde = 0;
  for (const m of texto.matchAll(MARCAS)) {
    const i = m.index ?? 0;
    if (i > desde) trozos.push(...conEnlaces(texto.slice(desde, i)));
    if (m[1] !== undefined) trozos.push({ tipo: "codigo", texto: m[1] });
    else if (m[2] !== undefined) trozos.push({ tipo: "enlace", texto: m[2], href: m[3]! });
    else if (m[4] !== undefined) trozos.push({ tipo: "negrita", texto: m[4] });
    else trozos.push({ tipo: "cursiva", texto: m[5]! });
    desde = i + m[0].length;
  }
  if (desde < texto.length || trozos.length === 0) trozos.push(...conEnlaces(texto.slice(desde)));
  return trozos;
}

/**
 * LOS HUECOS (24/10/2026, la captura del dueño): Len acaba cada nota entre
 * pasos con «\n\n» y el bucle pone otro «\n\n» delante de la siguiente, así que
 * entre dos notas había CUATRO saltos, y con `whitespace-pre-wrap` eso son tres
 * líneas en blanco. Como en markdown —lo que pinta el chat de Claude—, una línea
 * en blanco separa párrafos y más no añaden nada; y los saltos del final no
 * dejan un hueco debajo. Sólo en pantalla: lo que lee el modelo no se toca (su
 * prefijo es la caché).
 */
export function collapseBlankLines(texto: string): string {
  return texto.replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, "\n\n").replace(/\s+$/, "");
}
