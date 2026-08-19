import { parse, type HTMLElement } from "node-html-parser";

/** node-html-parser deja reetiquetar en el sitio: atributos, clases y contenido
 *  se quedan donde están, y sólo cambia lo semántico. */
function retag(node: HTMLElement, to: "h1" | "h2"): void {
  (node as unknown as { rawTagName: string }).rawTagName = to;
}

/**
 * Exactamente un `<h1>`, y es el primero de la página.
 *
 * Medido sobre el catálogo publicado: 8 secciones de rol `hero` no traen
 * `<h1>` y 25 de roles que no son hero sí lo traen —los 12 `comparison`, el
 * 100% de ese rol—. Cosidas en una página eso da documentos con cero titulares
 * o con dos, y ninguno de los dos se arregla desde el catálogo sin re-sellar
 * `contentHash`, que no se toca.
 *
 * Sube el primer `<h2>` cuando no hay ninguno y baja los sobrantes cuando hay
 * de más. Nunca inventa texto: una página sin ningún encabezado sigue sin
 * titular, y el chequeo determinista la marca `h1_missing`.
 */
export function ensureSingleH1(html: string): { html: string; changed: boolean } {
  const document = parse(html);
  const h1s = document.querySelectorAll("h1");

  if (h1s.length === 1) return { html, changed: false };

  if (h1s.length === 0) {
    const first = document.querySelector("h2");
    if (!first) return { html, changed: false };
    retag(first, "h1");
    return { html: document.toString(), changed: true };
  }

  for (const extra of h1s.slice(1)) retag(extra, "h2");
  return { html: document.toString(), changed: true };
}
