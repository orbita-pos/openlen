/**
 * ¿Este `replace` se llevó por delante el contenido del nodo?
 *
 * EL FALLO QUE LO TRAE (2026-09-02, en PRODUCCIÓN). El usuario pidió centrar
 * una sección de entradas y quitarle dos círculos decorativos del borde. Len lo
 * entendió bien y lo dijo bien —«quitar la clase `ticket-stub` del div 4h»—, y
 * aun así la sección entera desapareció. Después saltó `runtime_stale`, porque
 * el JavaScript de la página buscaba elementos que vivían ahí dentro.
 *
 * NO FUE UNA MALA DECISIÓN DEL MODELO. Fue el vocabulario. `editar_pagina` sólo
 * tenía `replace`, `insert_before`, `insert_after` y `delete`, así que quitar
 * una clase de once caracteres obliga a `replace` sobre el div — y `replace`
 * reemplaza el SUBÁRBOL. El modelo tiene que volver a teclear la tarjeta
 * entera: el precio, las fechas, los tres tipos de entrada. Si en esa
 * reescritura se deja el contenido, se pierde, y nadie se entera.
 *
 * La cura de fondo es `op="attrs"`, que reescribe sólo la etiqueta de apertura
 * y hace esto IMPOSIBLE. Esta guarda es la red: `attrs` no cubre los `replace`
 * legítimos, y un modelo puede seguir truncando uno.
 *
 * SE AVISA, NO SE RECHAZA. «Simplifica esta sección» es una petición real y su
 * resultado correcto es exactamente un nodo más pequeño. Lo que no puede pasar
 * es que ocurra en SILENCIO y el turno cierre con «listo». Misma doctrina que
 * `formulariosPerdidos` y `hechosPerdidos`.
 *
 * POR QUÉ NO VALÍA `hechosPerdidos`, que ya existía: compara URLs de imagen,
 * enlaces externos y teléfonos sobre el documento entero. Una tarjeta de
 * entradas puede no tener ninguno de los tres — la del fallo no los tenía— y
 * además mirar el documento entero no dice QUÉ nodo lo perdió. Aquí se compara
 * nodo contra nodo, que es donde está la respuesta.
 */

export interface ContenidoPerdido {
  /** El `data-op-id` reemplazado. */
  target: string;
  elementosAntes: number;
  elementosDespues: number;
  textoAntes: number;
  textoDespues: number;
}

export interface ReemplazoMedible {
  target: string;
  nuevoHtml: string;
}

/**
 * Mínimos para que la guarda hable. Existen para no llorar lobo: reescribir un
 * `<h2>` de tres palabras SIEMPRE mueve estos números en porcentaje, y avisar
 * ahí enseña al usuario —y al modelo— a ignorar el aviso.
 */
const MIN_ELEMENTOS = 4;
const MIN_ELEMENTOS_PERDIDOS = 3;
const MIN_TEXTO = 60;
const MIN_TEXTO_PERDIDO = 40;

/** Se pierde MÁS DE LA MITAD de los elementos, o más del 60% del texto. */
const RATIO_ELEMENTOS = 0.5;
const RATIO_TEXTO = 0.4;

/**
 * Cuenta etiquetas de apertura. Deliberadamente por expresión regular y no por
 * parser: esto es una heurística de aviso, no una frontera de seguridad, y
 * pagar una llamada al motor nativo por cada `replace` de cada turno para
 * afinar un número que sólo alimenta un porcentaje no lo vale.
 *
 * Los comentarios se quitan antes: `<!-- ... -->` no es contenido, y una
 * plantilla que documenta sus bloques inflaba el «antes» y tapaba la pérdida.
 */
export function medirFragmento(html: string): { elementos: number; texto: number } {
  const sinComentarios = html.replace(/<!--[\s\S]*?-->/g, "");
  const elementos = (sinComentarios.match(/<[a-zA-Z][^\s/>]*/g) ?? []).length;
  const texto = sinComentarios
    // `<script>` y `<style>` no son texto que el usuario lea. Sin esto, quitar
    // un bloque de CSS embebido contaba como perder media sección.
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim().length;
  return { elementos, texto };
}

/**
 * @param reemplazos  Sólo los `replace` que apuntan a un elemento del
 *                    documento. El runtime, el CSS, el `<head>` y el idioma NO
 *                    entran: ahí reemplazar TODO es la forma correcta de
 *                    usarlos, no un síntoma.
 * @param outerHtmlDe Devuelve el outerHTML del target ANTES de la edición.
 *                    Se inyecta para que esto se pueda probar sin el binding
 *                    nativo, que es de `npm run test:node` y no de vitest.
 */
export function contenidoPerdido(
  reemplazos: ReemplazoMedible[],
  outerHtmlDe: (target: string) => string | null,
): ContenidoPerdido[] {
  const out: ContenidoPerdido[] = [];

  for (const { target, nuevoHtml } of reemplazos) {
    const antesHtml = outerHtmlDe(target);
    // Sin el «antes» no hay comparación posible. Callar es correcto: el target
    // inexistente ya lo denuncia el aplicador con su propio error.
    if (antesHtml === null) continue;

    const antes = medirFragmento(antesHtml);
    const despues = medirFragmento(nuevoHtml);

    const perdioElementos =
      antes.elementos >= MIN_ELEMENTOS &&
      antes.elementos - despues.elementos >= MIN_ELEMENTOS_PERDIDOS &&
      despues.elementos < antes.elementos * RATIO_ELEMENTOS;

    const perdioTexto =
      antes.texto >= MIN_TEXTO &&
      antes.texto - despues.texto >= MIN_TEXTO_PERDIDO &&
      despues.texto < antes.texto * RATIO_TEXTO;

    if (perdioElementos || perdioTexto) {
      out.push({
        target,
        elementosAntes: antes.elementos,
        elementosDespues: despues.elementos,
        textoAntes: antes.texto,
        textoDespues: despues.texto,
      });
    }
  }

  return out;
}

/**
 * El aviso que se le devuelve al modelo, en su `aviso_critico`.
 *
 * Nombra el target y los números, y dice las DOS salidas: reponerlo, o usar
 * `attrs` si lo que quería era tocar la etiqueta. Un aviso que sólo regaña deja
 * al modelo adivinando qué se espera de él.
 */
export function avisoContenidoPerdido(perdidos: ContenidoPerdido[]): string {
  const detalle = perdidos
    .map(
      (p) =>
        `${p.target} (${p.elementosAntes}→${p.elementosDespues} elementos, ${p.textoAntes}→${p.textoDespues} caracteres)`,
    )
    .join(" · ");

  return (
    `Tu \`replace\` VACIÓ lo que reemplazaba: ${detalle}. ` +
    `\`replace\` sustituye el SUBÁRBOL ENTERO, así que \`new_html\` tiene que traer TODOS los hijos del nodo, no sólo su envoltorio. ` +
    `Si lo que querías era cambiar una clase o un atributo, NO uses \`replace\`: usa \`op="attrs"\`, que reescribe sólo la etiqueta de apertura y no puede perder contenido. ` +
    `Repón lo que falta en ESTE MISMO TURNO, o dile al usuario exactamente qué se perdió.`
  );
}
