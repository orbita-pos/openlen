// lib/projects/runtime-staleness.ts — ¿el JavaScript guardado sigue hablando
// de esta página, o de la que había antes?
//
// EL FALLO. `resealRuntime` re-ata el código VIEJO a cualquier documento nuevo
// sin comprobar que siga teniendo sentido: es lo correcto para lo que protege
// —el hash impide introducir código nuevo, no que el documento cambie— pero
// deja un hueco. Una edición que quita el elemento al que el script se
// enganchaba produce esto en la página publicada:
//
//     document.getElementById('carrito').addEventListener(...)
//     → TypeError: Cannot read properties of null
//
// Y no es que ese botón deje de funcionar: la excepción **aborta el script
// entero**, así que se lleva por delante todo lo que viniera después. Un
// elemento borrado puede apagar la interactividad completa de la página. En
// silencio: el error vive en la consola del visitante, que nadie mira.
//
// LO QUE ESTO HACE Y LO QUE NO. No repara ni reescribe el código del modelo —
// eso sería inventar. Comprueba un hecho verificable: qué identificadores busca
// el script y cuáles ya no existen en el documento. Con eso se avisa
// (`openlen-degradation-doctrine`: la página no miente, pero perdió algo) y,
// sobre todo, el aviso llega AL MODELO en el turno siguiente, que ahora sí
// puede arreglarlo — el JavaScript es direccionable por ops
// (`runtime-as-op-target`).
//
// Falla hacia CALLAR. Ante la duda no se avisa: una alarma falsa sobre la
// página de alguien vale menos que nada.

import { parse } from "node-html-parser";

/** Búsquedas por identificador que el script hace sobre el documento. */
const LOOKUPS: readonly RegExp[] = [
  /getElementById\(\s*['"]([A-Za-z][\w:.-]*)['"]\s*\)/g,
  /querySelector(?:All)?\(\s*['"]#([A-Za-z][\w:.-]*)['"]\s*\)/g,
];

/** El script se fabrica ese elemento él mismo, así que no tiene por qué estar
 *  en el HTML. Cubre `el.id = "x"`, `setAttribute("id","x")` y una plantilla
 *  con `id="x"` dentro de una cadena. */
const CREATIONS: readonly RegExp[] = [
  /\.id\s*=\s*['"]([A-Za-z][\w:.-]*)['"]/g,
  /setAttribute\(\s*['"]id['"]\s*,\s*['"]([A-Za-z][\w:.-]*)['"]\s*\)/g,
  /\bid=\\?["']([A-Za-z][\w:.-]*)\\?["']/g,
];

function matchAll(code: string, res: readonly RegExp[]): Set<string> {
  const out = new Set<string>();
  for (const re of res) {
    // `lastIndex` se reinicia a mano: son constantes con /g compartidas entre
    // llamadas, y sin esto la segunda invocación empieza a mitad de la cadena.
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(code))) if (m[1]) out.add(m[1]);
  }
  return out;
}

/**
 * Los identificadores que el runtime busca y que el documento ya no tiene.
 *
 * Vacío ⇒ nada que decir. NO significa «el script funciona»: sólo que ninguna
 * de sus búsquedas por id quedó huérfana, que es lo único comprobable sin
 * ejecutar nada.
 */
export function staleRuntimeRefs(code: string, html: string): string[] {
  if (code.trim() === "" || !html) return [];
  const buscados = matchAll(code, LOOKUPS);
  if (buscados.size === 0) return [];

  let presentes: Set<string>;
  try {
    presentes = new Set(
      parse(html)
        .querySelectorAll("[id]")
        .map((e) => e.getAttribute("id") ?? "")
        .filter(Boolean),
    );
  } catch {
    // Sin poder leer el documento no se acusa a nadie.
    return [];
  }
  const creados = matchAll(code, CREATIONS);

  const huerfanos: string[] = [];
  for (const id of buscados) {
    if (presentes.has(id) || creados.has(id)) continue;
    huerfanos.push(id);
  }
  return huerfanos.sort();
}

/** La frase para el usuario. Se queda en tres identificadores: es texto de
 *  máquina en la fila del proyecto, no un registro. */
export function staleRuntimeDetail(ids: readonly string[]): string[] {
  const muestra = ids.slice(0, 3).join(", ");
  const resto = ids.length > 3 ? ` (y ${ids.length - 3} más)` : "";
  return [
    `El código de la página busca ${ids.length === 1 ? "un elemento que ya no existe" : "elementos que ya no existen"}: ${muestra}${resto}. Eso detiene el script entero, así que puede haber dejado de funcionar más de lo que falta.`,
  ];
}
