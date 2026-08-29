// Cuánto puede guardar un proyecto.
//
// LA CUOTA ES LA RESPUESTA AL SPAM, y por eso no hay moderación en ningún sitio
// de este sistema. No tenemos que decidir qué es spam: si la página de alguien
// se llena de basura, se llena SU almacén y se rompe SU página. El radio de la
// explosión es su proyecto.
//
// 1 MB suena a poco y es enorme para una landing: ~1.000 carritos, o ~2.000
// items de menú. Y el almacenamiento es lo más barato que se puede vender, así
// que la diferencia entre planes cuesta casi nada y separa de verdad.

import type { Plan } from "@/lib/limits";

export const BYTES_POR_PLAN: Record<Plan, number> = {
  free: 1 * 1024 * 1024,
  pro: 10 * 1024 * 1024,
};

/** Tope por documento. Existe por un caso concreto: que nadie meta una imagen
 *  en base64 en una fila y se coma la cuota entera de una sola escritura. */
export const MAX_BYTES_DOCUMENTO = 16 * 1024;

export function bytesDe(doc: Record<string, unknown>): number {
  return Buffer.byteLength(JSON.stringify(doc), "utf8");
}

export type Veredicto =
  | { ok: true }
  | { ok: false; razon: "documento_grande" | "cuota_llena" };

/** ¿Cabe esta escritura?
 *
 *  `salientes` son los bytes del documento que se REEMPLAZA. Sin ese descuento,
 *  un proyecto lleno no podría ni editar lo que ya tiene: cambiar un carrito
 *  por otro del mismo tamaño fallaría, que es la peor forma de estar lleno. */
export function cabe(args: {
  plan: Plan;
  usados: number;
  entrantes: number;
  salientes?: number;
}): Veredicto {
  if (args.entrantes > MAX_BYTES_DOCUMENTO) {
    return { ok: false, razon: "documento_grande" };
  }
  const despues = args.usados - (args.salientes ?? 0) + args.entrantes;
  if (despues > BYTES_POR_PLAN[args.plan]) {
    return { ok: false, razon: "cuota_llena" };
  }
  return { ok: true };
}
