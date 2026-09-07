// lib/generation/repeticion-de-portada.ts — cuánto de una subpágina ya estaba
// en la portada.
//
// EL DEFECTO. El prompt de subpágina se lo dice con todas las letras: «El
// CONTENIDO es nuevo y es sólo de esta página. No repitas las secciones de la
// portada». Nadie lo comprobaba. Una subpágina que repite la portada cuesta
// igual —una llamada y un crédito— y el usuario paga por leer dos veces lo
// mismo.
//
// 🔴 LO CARO ES DISCRIMINAR, y aquí hay DOS trampas que harían de esto otro
// veredicto `prueba` —acusar a todos y acertar en ninguno—:
//
//   1. LA CABECERA Y EL PIE SE REPITEN A PROPÓSITO. El mismo prompt EXIGE «la
//      misma cabecera y el mismo pie, con los mismos enlaces». Contarlos
//      acusaría al 100% de las subpáginas por obedecer. Se recortan antes.
//   2. UN DATO REPETIDO NO ES UNA SECCIÓN REPETIDA. Medido el 2026-09-07
//      sobre las tres subpáginas reales: `/servicios` repetía dos bloques —la
//      dirección ("av. de la ciencia 1520…") y el horario ("estamos abiertos
//      24/7…")—, y repetir eso entre páginas es CORRECTO. Lo que el prompt
//      prohíbe es repetir SECCIONES, y una sección son bloques SEGUIDOS: los
//      dos de `/servicios` estaban sueltos (patrón `.......X.......X`, racha
//      1) mientras que pegarle una sección de la portada da racha 10. Por eso
//      la señal es `rachaMaxima`, no `repetidos`.
//   3. LAS FRASES CORTAS SE REPITEN SOLAS. "Urgencias 24h", "Ver más",
//      "Agendar cita" salen en las dos páginas sin que nadie haya copiado
//      nada. Es letra por letra el `href="#"` que salió 45 veces en 12 de 16
//      páginas y que por eso NO se cuenta. Por debajo de `MINIMO` no cuenta.
//
// Y NO EMITE VEREDICTO. Se mide, se guarda y se imprime; nadie falla por esto
// todavía. Claude Code tiene esa figura de serie —un grader con
// `scored: false` corre y se reporta sin entrar en el score— y nuestra propia
// historia la pide: `calc` y `prueba` nacieron con voto y hubo que retirarlo
// las dos veces. Primero el dato; el voto, cuando haya corpus que lo sostenga.

/** Por debajo de esto una coincidencia no dice nada: es vocabulario del rubro,
 *  no contenido copiado. Medido en caracteres del texto ya normalizado. */
export const MINIMO = 40;

export interface RepeticionDePortada {
  /** Bloques de la subpágina que ya estaban, palabra por palabra, en la portada. */
  readonly repetidos: number;
  /** Bloques que tiene la subpágina, fuera de cabecera y pie. */
  readonly total: number;
  /** El repetido más largo — para que la fila diga CUÁL, no "hay uno". */
  readonly peor: string | null;
  /** LA SEÑAL: bloques repetidos SEGUIDOS. Una sección copiada los deja en
   *  racha; un dato que se repite por ser verdad queda suelto, en racha 1. */
  readonly rachaMaxima: number;
}

/** El texto de los bloques de contenido, sin lo que se repite por contrato. */
function bloques(html: string): string[] {
  const limpio = html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<head\b[^>]*>[\s\S]*?<\/head>/i, " ")
    // Cabecera, pie y navegación: el prompt los EXIGE idénticos.
    .replace(/<(header|footer|nav)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
  const fuera: string[] = [];
  const re = /<(h[1-6]|p|li|blockquote|figcaption|dd|dt|td|th)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(limpio)) !== null) {
    const texto = (m[2] ?? "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    if (texto.length >= MINIMO) fuera.push(texto);
  }
  return fuera;
}

export function repeticionDePortada(portada: string, subpagina: string): RepeticionDePortada {
  const dePortada = new Set(bloques(portada));
  const propios = bloques(subpagina);
  const repetidos = propios.filter((b) => dePortada.has(b));
  let racha = 0;
  let rachaMaxima = 0;
  for (const b of propios) {
    racha = dePortada.has(b) ? racha + 1 : 0;
    if (racha > rachaMaxima) rachaMaxima = racha;
  }
  const peor = repetidos.length === 0
    ? null
    : repetidos.reduce((a, b) => (b.length > a.length ? b : a));
  return {
    repetidos: repetidos.length,
    total: propios.length,
    peor: peor === null ? null : peor.slice(0, 80),
    rachaMaxima,
  };
}
