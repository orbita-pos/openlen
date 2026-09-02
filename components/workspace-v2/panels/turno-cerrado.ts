// ─────────────────────────────────────────────────────────────────────────────
// Cómo cierra un turno del Agente cuando el stream terminó mal.
//
// La regla es una sola y no es opinable: **un turno que ya cambió la página no
// puede terminar como fallo puro.** Una herramienta guarda, el stream siguiente
// se cae (503, cancelado, max_tokens), y el turno se pintaba rojo: sin Undo, sin
// entrar en la transcripción, y con el cambio ya vivo en la base. El usuario
// leía «falló», pulsaba Reintentar, y aplicaba el mismo cambio DOS veces.
//
// El Chat clásico ya lo hacía bien (`cambioDurable` en ai-design, 24/08). Esto
// es la misma política en la superficie del Agente, escrita aparte para que la
// decisión se pueda probar sin montar el panel entero.
// ─────────────────────────────────────────────────────────────────────────────

export type CierreDeTurno =
  /** Nada quedó guardado: el turno falló entero y se pinta en rojo. */
  | { readonly kind: "error"; readonly texto: string }
  /** Terminó bien. */
  | { readonly kind: "aplicado" }
  /** Cambió la página y luego se cortó. Aplicado, con el motivo a la vista. */
  | { readonly kind: "aplicado-con-aviso"; readonly aviso: string };

export function cierreDeTurno(args: {
  /** El mensaje de error del stream, ya localizado. `null` = terminó limpio. */
  readonly errorMessage: string | null;
  /**
   * SE QUEDÓ SIN CUERDA: el turno terminó bien pero agotó un tope (pasos o
   * acciones), ya localizado. `null`/ausente = no fue el caso.
   *
   * 🔴 Va aparte del error a propósito, porque NO es un error: el bucle redacta
   * un cierre elegante y no emite ningún evento `error`, así que el turno
   * llegaba aquí indistinguible de uno que terminó la faena. Verde, limpio, y
   * a medias. Es aviso, no rojo — lo hecho está hecho y sigue siendo suyo.
   */
  readonly avisoDeTope?: string | null;
  /**
   * LA CONVERSACIÓN NO CABE ENTERA y el usuario tiene derecho a saberlo, ya
   * localizado. `null`/ausente = cabe.
   *
   * 🔴 Al MODELO ya se le decía —la nota de `buildAgentContext`, para que pueda
   * contestar «de eso ya no me acuerdo» en vez de nombrar el turno más viejo que
   * tenga a mano—. Al usuario no: veía a Len olvidar y no tenía forma de saber
   * por qué, ni de saber que seguir alargando la misma charla empeora la
   * memoria en vez de mejorarla.
   *
   * NO es un error ni un tope: el turno hizo su trabajo entero. Es un hecho
   * sobre la conversación, y por eso viaja como aviso sobre un turno aplicado.
   */
  readonly avisoDeVentana?: string | null;
  /** El servidor dijo que alguna herramienta escribió en la base. Cubre los
   *  cambios de AJUSTES, que son durables y no emiten documento. */
  readonly mutoDurable: boolean;
  /** Llegó al menos un evento `html`. Respaldo para cuando el terminal no
   *  llega (la ruta reventó después de pintar el documento). */
  readonly hayDocumentoNuevo: boolean;
}): CierreDeTurno {
  // LOS AVISOS SE SUMAN, NO SE PISAN. Un turno puede a la vez quedarse sin
  // pasos Y estar hablando con media conversación fuera de la ventana: son dos
  // hechos distintos y quedarse con uno le esconde el otro al usuario. Es la
  // misma lección que los `aviso_critico` de `editar_pagina`, donde cuatro
  // claves sueltas en el mismo objeto hacían que ganara la última en silencio.
  const avisos = [args.avisoDeTope, args.avisoDeVentana].filter(
    (a): a is string => typeof a === "string" && a.length > 0,
  );
  if (args.errorMessage === null) {
    return avisos.length > 0
      ? { kind: "aplicado-con-aviso", aviso: avisos.join(" ") }
      : { kind: "aplicado" };
  }
  const yaMuto = args.mutoDurable || args.hayDocumentoNuevo;
  return yaMuto
    ? { kind: "aplicado-con-aviso", aviso: [args.errorMessage, ...avisos].join(" ") }
    : { kind: "error", texto: args.errorMessage };
}
