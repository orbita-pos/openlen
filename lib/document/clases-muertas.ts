// Clases que NUNCA pueden pintar nada — el hermano del selector muerto, por el
// otro lado.
//
// `css-wiring.ts` caza la regla que existe y no encuentra su elemento. Esto caza
// lo contrario: la clase que está en el elemento y no puede tener regla, porque
// no es una clase que ningún Tailwind ni ningún CSS pueda haber definido.
//
// EL CASO QUE LO MOTIVA, medido el 2026-09-07 sobre el corpus de páginas:
//
//   <p class="mt-3 text-sm text( --ol-fg-muted )">
//
// El contrato le pide al modelo que todo color salga de un token `--ol-*`, y no
// le dice cómo alcanzarlo desde una clase. Así que se lo inventó: 65 veces en
// UN caso y cero en los otros 49. El navegador parte eso en cuatro clases
// —`text(`, `--ol-fg-muted`, `)` y la siguiente—, ninguna existe, y el párrafo
// se queda con el color heredado.
//
// 🔴 POR QUÉ NO LO VE NADIE MÁS. No baja el contraste —el texto sale a `--ol-fg`,
// que contrasta MÁS que el gris que se pretendía—, no desborda, no grita en
// consola y la captura se ve bien. Es pérdida de jerarquía visual, invisible
// para las tres medidas del render. Y se publica igual.
//
// LA PRECISIÓN, que es la misma vara que se puso `css-wiring.ts`: no se avisa de
// «clase rara». Las dos formas de abajo no son ambiguas —ninguna puede existir
// en esta pila— y por eso se pueden afirmar sin juicio. Cualquier cosa que
// pudiera ser una clase legítima del usuario se queda fuera a propósito.
//
// Determinista y sin navegador, como su hermano: corre siempre.

/** La Tailwind que esta pila compila y sirve: `package.json` y el Play CDN. */
const TAILWIND_MAYOR = 3;

export interface ClaseMuerta {
  /** El atributo `class` tal cual lo escribió el modelo, recortado. */
  readonly enClase: string;
  /** Lo que no puede existir. */
  readonly muerta: string;
  /** Qué se quiso escribir, cuando se puede decir sin adivinar. */
  readonly enSuLugar: string;
}

const MAX_CLASES = 5;
const ATRIBUTO = /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;

/**
 * Un paréntesis con espacio dentro: `text( --ol-fg-muted )`.
 *
 * Nunca es válido. En un valor arbitrario de Tailwind el espacio se escribe
 * `_`, jamás literal, así que un espacio dentro del paréntesis parte el
 * atributo en clases sueltas que no existen.
 */
const CON_ESPACIO = /([a-z][a-z0-9-]*)\(\s+(--[a-z0-9-]+)\s*\)|([a-z][a-z0-9-]*)\(\s*(--[a-z0-9-]+)\s+\)/gi;

/**
 * La forma de Tailwind v4: `text-(--ol-fg-muted)`.
 *
 * Correcta en v4 y MUERTA aquí, que es lo que la hace peligrosa: parece bien
 * escrita. Medido en el navegador que la página carga de verdad — la clase no
 * genera ninguna regla y el elemento hereda.
 */
const FORMA_V4 = /([a-z][a-z0-9-]*)-\((--[a-z0-9-]+)\)/gi;

/**
 * Las clases del documento que no pueden pintar nada.
 *
 * Devuelve `[]` cuando no hay ninguna, que es el caso normal. Nunca lanza: es
 * un diagnóstico, y un diagnóstico no puede costar la página.
 */
export function clasesQueNuncaAplican(html: string): ClaseMuerta[] {
  if (TAILWIND_MAYOR !== 3) return [];
  const out: ClaseMuerta[] = [];
  const vistas = new Set<string>();

  for (const m of html.matchAll(ATRIBUTO)) {
    const valor = m[1] ?? m[2] ?? "";
    if (!valor.includes("(")) continue;

    const anota = (muerta: string, util: string, token: string) => {
      if (vistas.has(muerta) || out.length >= MAX_CLASES) return;
      vistas.add(muerta);
      out.push({
        enClase: valor.length > 80 ? `${valor.slice(0, 77)}…` : valor,
        muerta,
        enSuLugar: `${util}-[${token.startsWith("--") ? `var(${token})` : token}]`,
      });
    };

    for (const c of valor.matchAll(CON_ESPACIO)) {
      const util = c[1] ?? c[3] ?? "";
      const token = c[2] ?? c[4] ?? "";
      anota(c[0], util, token);
    }
    for (const c of valor.matchAll(FORMA_V4)) {
      anota(c[0], c[1] ?? "", c[2] ?? "");
    }
  }
  return out;
}

/** Dicho para una persona: qué clase no pinta y qué habría que escribir. */
export function frasesDeClasesMuertas(muertas: readonly ClaseMuerta[]): string[] {
  return muertas.map(
    (c) =>
      `la clase \`${c.muerta}\` no existe y no pinta nada (se escribe \`${c.enSuLugar}\`)`,
  );
}
