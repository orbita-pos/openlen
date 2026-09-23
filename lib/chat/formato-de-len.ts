// El markdown en línea que Len escribe, partido en trozos que el chat pinta.
//
// Medido el 2026-09-23 sobre los 83 cierres de la batería: 37 líneas con
// **negrita**, 12 con `código`, 1 con *cursiva*; ningún enlace, ningún título,
// ninguna lista numerada. Las listas con guion ya se leen bien con
// `whitespace-pre-wrap`. El chat pintaba el texto tal cual, y el dueño leía
// «**Cobrar**» con los asteriscos a la vista.
//
// Por eso esto y no una librería de markdown: son tres marcas, y cada trozo sale
// como TEXTO que React escapa, sin HTML que inyectar. Lo que no casa con una
// marca completa —un ** sin cerrar, una multiplicación, un nombre_con_guiones—
// se queda como texto sin perder un carácter.

export type Trozo = {
  readonly tipo: "texto" | "negrita" | "codigo" | "cursiva";
  readonly texto: string;
};

// El orden importa: el código va primero porque dentro de él nada es formato,
// y la negrita antes que la cursiva porque «**» empieza por «*».
// La cursiva exige texto pegado a los dos asteriscos: «3 * 4 * 5» no lo es.
const MARCAS = /`([^`\n]+)`|\*\*([^*\n]+?)\*\*|\*([^\s*][^*\n]*?[^\s*]|[^\s*])\*/g;

export function trozosConFormato(texto: string): Trozo[] {
  const trozos: Trozo[] = [];
  let desde = 0;
  for (const m of texto.matchAll(MARCAS)) {
    const i = m.index ?? 0;
    if (i > desde) trozos.push({ tipo: "texto", texto: texto.slice(desde, i) });
    if (m[1] !== undefined) trozos.push({ tipo: "codigo", texto: m[1] });
    else if (m[2] !== undefined) trozos.push({ tipo: "negrita", texto: m[2] });
    else trozos.push({ tipo: "cursiva", texto: m[3] });
    desde = i + m[0].length;
  }
  if (desde < texto.length || trozos.length === 0) trozos.push({ tipo: "texto", texto: texto.slice(desde) });
  return trozos;
}
