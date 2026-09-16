// LA MÁQUINA DEL LIENZO REMOTO — pura, para poder probarla sin React.
//
//   esperando ──subido──▶ remoto(listo=false) ──listo──▶ remoto(listo=true)
//                             │ vencido (1ª vez) → se sube otra vez
//                             │ vencido (tras reintento) → local(no_respondio)
//   cualquier ──fallo──▶ local(motivo)        local se queda: no parpadea
//
// «listo» lo manda el propio lienzo: `openlen:iframe-ready`, que emiten los
// scripts del editor. Un 404 (documento caducado, host mal servido) carga una
// página sin esos scripts, así que no llega nunca, y el plazo lo resuelve: una
// subida nueva y, si tampoco, la reserva con banda. Spec 2026-09-15, D7.

/** Medido en la Task 7 del plan (M3), el 2026-09-15 — los números están en
 *  `docs/superpowers/plans/2026-09-15-un-solo-camino-mediciones.md`. La
 *  fórmula `max(8000, 4 × (load_remoto_p50 + documentoDeVista_p50))` dio
 *  `max(8000, 850)`: el camino remoto salió MÁS RÁPIDO que el `srcdoc`
 *  (208,9 ms frente a 356,9), así que manda el suelo de 8 s. */
export const PLAZO_LISTO_MS = 8000;

export type MotivoLocal = "apagado" | "sin_host" | "demasiado_grande" | "error" | "no_respondio";

export type EstadoLienzo =
  | { modo: "esperando" }
  | { modo: "remoto"; url: string; listo: boolean; reintentado: boolean }
  | { modo: "local"; motivo: MotivoLocal };

export type EventoLienzo =
  | { tipo: "subido"; url: string; reintento: boolean }
  | { tipo: "fallo"; motivo: Exclude<MotivoLocal, "no_respondio"> }
  | { tipo: "listo" }
  | { tipo: "vencido" }
  | { tipo: "recargado" };

export interface Paso {
  estado: EstadoLienzo;
  subirOtraVez: boolean;
}

export const INICIAL: EstadoLienzo = { modo: "esperando" };

export function siguiente(e: EstadoLienzo, ev: EventoLienzo): Paso {
  const quieto = { estado: e, subirOtraVez: false };
  switch (ev.tipo) {
    case "fallo":
      return { estado: { modo: "local", motivo: ev.motivo }, subirOtraVez: false };
    case "subido":
      if (e.modo === "local") return quieto;
      return { estado: { modo: "remoto", url: ev.url, listo: false, reintentado: ev.reintento }, subirOtraVez: false };
    case "listo":
      return e.modo === "remoto" ? { estado: { ...e, listo: true }, subirOtraVez: false } : quieto;
    case "recargado":
      return e.modo === "remoto" ? { estado: { ...e, listo: false, reintentado: false }, subirOtraVez: false } : quieto;
    case "vencido":
      if (e.modo !== "remoto" || e.listo) return quieto;
      if (!e.reintentado) return { estado: e, subirOtraVez: true };
      return { estado: { modo: "local", motivo: "no_respondio" }, subirOtraVez: false };
  }
}

export function motivoDeRespuesta(status: number, error: unknown): Exclude<MotivoLocal, "no_respondio"> {
  if (status === 503 && error === "apagado") return "apagado";
  if (status === 503 && error === "sin_host") return "sin_host";
  if (status === 413) return "demasiado_grande";
  return "error";
}
