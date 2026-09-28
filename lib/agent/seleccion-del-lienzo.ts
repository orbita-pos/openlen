/**
 * LO QUE EL DUEÑO SEÑALÓ EN EL LIENZO, como fichero y líneas (Len 2.0, T8c).
 *
 * Era un op-id («Ancla tu edición principal en este data-op-id») más, con pin,
 * la sección recortada y un índice del resto. Len 2.0 no ve ids: se le dice
 * como Claude Code le dice al modelo lo que el usuario selecciona en su IDE
 * (ver `seleccionBlock` en `context.ts`).
 *
 * La ruta CSS que manda el lienzo (`buildEditPath`) se resuelve con el
 * resolvedor de siempre contra un GEMELO cuyos ids son la posición de cada
 * etiqueta en el fichero (`etiquetarConPosiciones`); el recorte exacto del motor
 * (`outerHtmlByOpId`) dice hasta dónde llega. Si no se puede anclar, va la
 * pista del lienzo sin líneas, que es lo que se sabe.
 */
import "server-only";

import type { SeleccionDelDueno } from "@/lib/agent/context";
import { etiquetarConPosiciones, seleccionDelTrozo } from "@/lib/agent/ficheros/posiciones";
import { rutaDePagina, sinOpIds } from "@/lib/agent/ficheros/sitio";
import { outerHtmlByOpId, resolveOpIdByPath } from "@/lib/html-ops";

export function seleccionDelLienzo(args: {
  /** El HTML guardado de la página que el dueño tiene abierta. */
  html: string;
  page: string | null;
  path: string | null;
  hint: string | null;
}): SeleccionDelDueno | null {
  if (!args.path && !args.hint) return null;
  const ruta = rutaDePagina(args.page);
  // Las líneas son las que enseña Read: sin los ids que un proyecto anterior al
  // 2026-08-23 pudo hornear.
  const fichero = sinOpIds(args.html);
  if (args.path) {
    const gemelo = etiquetarConPosiciones(fichero);
    const id = resolveOpIdByPath(gemelo, args.path);
    const trozo = id ? outerHtmlByOpId(gemelo, id) : null;
    const lineas = id && trozo ? seleccionDelTrozo(fichero, id, trozo) : null;
    if (lineas) return { ruta, ...lineas };
  }
  return args.hint ? { ruta, pista: args.hint } : null;
}
