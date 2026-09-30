// lib/agent/revision/linea-base.ts — H14: las dos fotos del diff, pasadas por el MISMO guardado.
//
// El diff de `/code-review` de Claude Code es `git diff`: lo que el turno
// cambió frente a lo que ya estaba en el repositorio, que pasó por las mismas
// herramientas que lo nuevo. Aquí no era así. La foto de ANTES
// (`session.alEmpezar`) es la página tal como estaba en la base, y puede no
// haber pasado nunca por `preparePage` —Len-Bench la inserta en crudo; en
// producción, una plantilla clonada—. La de DESPUÉS sí pasó, en el primer
// guardado de Len, y la plataforma hace ahí cosas que Len no escribió:
//   · completa el `<head>` (`ensurePageMeta`: descripción, `og:*`,
//     `twitter:card`, favicon);
//   · estampa `data-ol-form-id` en cada formulario sin él, con un id
//     ALEATORIO, y al estampar re-serializa el documento entero
//     (`stampFormIds`: «pierde comentarios, normaliza `/>`»).
//
// Medido el 29/09 en la primera pasada pagada (ficha H14): de 7 hallazgos, 3
// culpaban a Len de eso —los `og:*` de la portada y de las páginas nuevas, la
// tarjeta `og:image` de éstas, y los comentarios y los `<x/>` de la portada— y
// el verificador no pudo tumbar ninguno, porque el diff SÍ los mostraba. El
// fallo estaba en la entrada, no en el juicio.
//
// El arreglo es comparar lo mismo con lo mismo: la foto de antes pasa por el
// mismo guardado (`comoLoGuarda`) y queda como la habría dejado la plataforma
// sin que nadie la tocara. `ensurePageMeta` es idempotente y la re-serialización
// es la misma en los dos lados, así que se anulan. El id de formulario no se
// anula —es aleatorio—, y por eso sale de las DOS fotos, como `sinOpIds`: es
// identidad de la plataforma, no algo que Len decida. Una página NUEVA no
// tiene con qué anularse: le sale lo que se demuestra que puso `ensurePageMeta`
// (`sinLoQueAnadeElHead`). En las 11 grabaciones de la acotada, el ruido de la
// plataforma quedó en cero y lo de Len, entero.

import { normalizarFinales } from "@/lib/agent/ficheros/read";
import { sinOpIds } from "@/lib/agent/ficheros/sitio";
import { preparePage } from "@/lib/page-engine/prepare";
import { ensurePageMeta } from "@/lib/publish/ensure-page-meta";
import { FORM_ID_ATTR } from "@/lib/publish/form-identity";
import type { FicheroDelTurno } from "./diff-del-turno";

/** Cómo queda una página al guardarla sin cambiarle nada. */
export type Guardar = (html: string) => Promise<string>;

/**
 * El guardado de Len (`guardarFichero`) con la página tal cual: la misma
 * `preparePage`, sin render. Con `priorHtml` la puerta avisa en vez de
 * bloquear, y un defecto que ya estaba no la tumba. Si aun así la rechaza, la
 * foto se queda como estaba: peor un diff con ruido que ningún diff.
 */
export const comoLoGuarda: Guardar = async (html) => {
  const r = await preparePage(html, { mode: "edit", renderChecks: false, priorHtml: html });
  return r.ok ? r.html : html;
};

const ID_DE_FORMULARIO = new RegExp(`\\s+${FORM_ID_ATTR}\\s*=\\s*("[^"]*"|'[^']*'|[^\\s>]+)`, "gi");

/** La página sin el id que la plataforma le estampa a cada formulario. */
export function sinIdsDeFormulario(html: string): string {
  return html.replace(ID_DE_FORMULARIO, "");
}

/**
 * Lo que `ensurePageMeta` añadió al guardar, fuera. Lo necesita sobre todo UNA
 * PÁGINA NUEVA, que no tiene foto de antes con la que anularse: medido en
 * `una-pagina-por-area`, la tarjeta `og:image` en base64, `twitter:card` y
 * `og:type` (la descripción, los `og:title`/`og:description` y el favicon los
 * había escrito Len).
 *
 * Sale SÓLO si se demuestra que es suyo. `ensurePageMeta` mete todo lo que
 * añade junto y justo antes de `</head>`; se prueba a quitar las últimas
 * etiquetas `<meta>`/`<link>` pegadas a `</head>`, de la tanda más larga a la
 * más corta, y vale la primera que `ensurePageMeta` vuelve a poner BYTE A BYTE.
 * Si ninguna, la página va tal cual: mejor ruido que esconderle a un revisor
 * algo que escribió Len.
 */
export function sinLoQueAnadeElHead(html: string): string {
  return partirElHead(html).sin;
}

/** Para comparar, `<meta …/>` y `<meta … >` son la misma etiqueta. Hoy hace
 *  falta: si al guardar se estampó un formulario, el parser re-serializa DESPUÉS
 *  de `ensurePageMeta` y sus ` />` salen como ` >` (medido con `comoLoGuarda`).
 *  Si `stampFormIds` deja de re-serializar, esto sobra pero no estorba. */
const cierreDeVacias = (html: string) => html.replace(/<(meta|link)\b([^>]*?)\s*\/?>/gi, "<$1$2>");

/** La página sin la tanda demostrada, y qué etiqueta era cada una de la tanda
 *  (`og:image`, `twitter:card`, `icon`…), en orden; vacía si no se demostró. */
function partirElHead(html: string): { readonly sin: string; readonly clases: readonly string[] } {
  const fin = html.search(/<\/head\s*>/i);
  if (fin < 0) return { sin: html, clases: [] };
  const cortes: number[] = [];
  for (let pos = fin; ; ) {
    const m = /<(?:meta|link)\b[^>]*>$/i.exec(html.slice(0, pos));
    if (!m) break;
    pos -= m[0].length;
    cortes.push(pos);
  }
  for (let i = cortes.length - 1; i >= 0; i--) {
    const sin = html.slice(0, cortes[i]) + html.slice(fin);
    if (cierreDeVacias(ensurePageMeta(sin)) !== cierreDeVacias(html)) continue;
    const clases = (html.slice(cortes[i], fin).match(/<[^>]*>/g) ?? []).map(
      (t) => /\b(?:name|property|rel)\s*=\s*"([^"]*)"/i.exec(t)?.[1] ?? t,
    );
    return { sin, clases };
  }
  return { sin: html, clases: [] };
}

const comoSeCompara = (html: string) => sinIdsDeFormulario(normalizarFinales(sinOpIds(html)));

/**
 * Las páginas del turno, listas para `diffDelTurno`: la de antes, pasada por el
 * guardado; las dos, sin ids de plataforma, sin lo que se demuestra que puso
 * `ensurePageMeta` y con los finales de línea de Read. Una página que el turno
 * creó no tiene antes y va entera, menos eso último.
 */
export async function ficherosDelTurno(
  paginas: readonly { readonly ruta: string; readonly antes: string | null; readonly despues: string }[],
  guardar: Guardar = comoLoGuarda,
): Promise<FicheroDelTurno[]> {
  return Promise.all(
    paginas.map(async ({ ruta, antes, despues }) => {
      const d = comoSeCompara(despues);
      if (antes === null) return { ruta, antes: null, despues: sinLoQueAnadeElHead(d) };
      const a = comoSeCompara(await guardar(antes).catch(() => antes));
      // Las etiquetas del `<head>` que puso el guardado se sacan de las DOS
      // fotos sólo si en las dos se demuestra LA MISMA tanda. Hace falta
      // cuando el primer guardado de Len cambió de dónde salen (el titular,
      // el primer párrafo): son las mismas etiquetas con otro contenido. Si no
      // es la misma tanda, se quedan las dos: `ensurePageMeta` no reescribe lo
      // que ya existe, así que lo que no cambió se anula solo en el diff.
      const pa = partirElHead(a);
      const pd = partirElHead(d);
      const mismaTanda = pa.clases.length > 0 && pa.clases.join("\n") === pd.clases.join("\n");
      return mismaTanda ? { ruta, antes: pa.sin, despues: pd.sin } : { ruta, antes: a, despues: d };
    }),
  );
}
