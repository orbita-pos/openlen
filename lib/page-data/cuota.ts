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

/** Filas que recibe un VISITANTE en una lectura. El porqué está en `listar`
 *  (`store.ts`); vive aquí porque este módulo no toca la base y lo importan
 *  también la ruta pública y el sustituto de la medición. */
export const MAX_FILAS_VISITANTE = 200;

export function bytesDe(doc: Record<string, unknown>): number {
  return Buffer.byteLength(JSON.stringify(doc), "utf8");
}

/** A partir de aquí se avisa. 80% deja sitio para reaccionar: decirlo cuando ya
 *  no cabe nada es contar un accidente, no evitarlo. */
export const CUOTA_CERCA = 0.8;

/** Lo que el DUEÑO tiene que poder ver de su cuota. */
export interface EstadoDeCuota {
  readonly usados: number;
  readonly tope: number;
  /** 0-100, redondeado hacia arriba y tapado a 100. */
  readonly porcentaje: number;
  readonly nivel: "bien" | "cerca" | "llena";
}

/**
 * LA CUOTA, DICHA PARA QUIEN PUEDE HACER ALGO.
 *
 * 🔴 POR QUÉ EXISTE. `bytesUsados` lo llamaban dos sitios —la ruta pública y la
 * herramienta de datos del Agente— y ninguno se lo enseñaba al dueño. Cuando el
 * proyecto se llena, el visitante recibe un 507 y el dueño no se entera: ni
 * aviso, ni panel, ni correo. Es el fallo que LLEGA CON EL ÉXITO —cuanto mejor
 * le va a la página, antes ocurre— y su síntoma es que los carritos dejan de
 * guardarse en silencio, con los datos de sus clientes dentro.
 *
 * El porcentaje se redondea HACIA ARRIBA: unos kilobytes pintados como «0%» se
 * leen como «no has usado nada», que es lo mismo que no decir nada. Y se tapa a
 * 100 porque un «137%» no le dice a nadie qué hacer.
 */
export function estadoDeCuota(usados: number, plan: Plan): EstadoDeCuota {
  const tope = BYTES_POR_PLAN[plan];
  const crudo = tope > 0 ? usados / tope : 0;
  return {
    usados,
    tope,
    porcentaje: Math.min(100, Math.ceil(crudo * 100)),
    nivel: crudo >= 1 ? "llena" : crudo >= CUOTA_CERCA ? "cerca" : "bien",
  };
}

/**
 * LO QUE SE LE DICE AL MODELO, o `null` si no hay nada que decir.
 *
 * El panel de Datos sólo ayuda a quien lo abre, y el 507 les ocurre a los
 * visitantes mientras el dueño no mira. Len habla con él, así que Len tiene que
 * saberlo — y saber qué hacer: avisarle, y no gastar cuota en filas de prueba.
 *
 * `null` con sitio de sobra: en el 95% de los turnos no hay nada que contar, y
 * contarlo igual es ruido en un contexto que se paga entero.
 */
export function avisoDeCuotaParaElModelo(estado: EstadoDeCuota): string | null {
  if (estado.nivel === "bien") return null;
  if (estado.nivel === "llena") {
    return (
      `Los datos de esta página han llenado su cuota (${estado.porcentaje}%): sus visitantes YA NO PUEDEN guardar nada ` +
      "—reciben un error al enviar—. Díselo al dueño con esas palabras y ofrécele borrar lo que no use. " +
      "No añadas filas de prueba."
    );
  }
  return (
    `Los datos de esta página ocupan el ${estado.porcentaje}% de su cuota. Al llegar al 100% los visitantes dejan de poder guardar ` +
    "y reciben un error. Si el dueño toca datos en este turno, díselo. No añadas filas de prueba."
  );
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
