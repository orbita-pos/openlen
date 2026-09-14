// lib/uso/cliente.ts — LOS EVENTOS DE USO, del lado del navegador.
//
// La forma es la de Claude Code (2.1.257), y cada decisión se puede
// comprobar allí:
//
//  - SE APAGA SI LA PERSONA LO PIDE. Allí `DISABLE_TELEMETRY` y `DO_NOT_TRACK`
//    ponen la sesión en «no-telemetry» antes de registrar nada. El equivalente
//    de un navegador es `navigator.doNotTrack` y el Global Privacy Control. El
//    servidor lo vuelve a comprobar con las cabeceras: esto sólo ahorra el envío.
//  - VA EN LOTES Y NUNCA BLOQUEA. Su `BatchLogRecordProcessor` espera
//    `scheduledDelayMillis` (5000) antes de exportar, y un envío que falla se
//    cuenta, no se lanza. Aquí, igual: si `sendBeacon` no puede se intenta
//    `fetch` con `keepalive`, y si tampoco, el lote se pierde.
//  - SE VACÍA AL IRSE. La pestaña que se cierra es justo lo que este embudo
//    quiere ver.
//
// Del catálogo sólo se importan TIPOS: validar es trabajo del servidor, y así
// zod no entra al paquete del navegador.

import type { DatosDe, EventoDeCliente } from "./catalogo";

/** El `scheduledDelayMillis` de Claude Code. */
export const RETRASO_MS = 5_000;
/** El tope de eventos por petición que acepta `/api/uso`. */
export const MAX_POR_LOTE = 20;
/** Con la cola llena se descarta el más viejo, como con `maxQueueSize` allí. */
export const MAX_EN_COLA = 200;

export interface EventoPendiente {
  nombre: EventoDeCliente;
  sesion: string;
  datos: unknown;
}

export interface DependenciasDeCola {
  enviar: (cuerpo: string) => void;
  programar: (fn: () => void, ms: number) => void;
  noRastrear: () => boolean;
  sesion: string;
}

export function crearCola(deps: DependenciasDeCola) {
  const cola: EventoPendiente[] = [];
  let programado = false;

  const vaciar = () => {
    programado = false;
    while (cola.length > 0) {
      deps.enviar(JSON.stringify({ eventos: cola.splice(0, MAX_POR_LOTE) }));
    }
  };

  const registrar = <N extends EventoDeCliente>(nombre: N, datos: DatosDe<N>) => {
    if (deps.noRastrear()) return;
    if (cola.length >= MAX_EN_COLA) cola.shift();
    cola.push({ nombre, sesion: deps.sesion, datos });
    if (!programado) {
      programado = true;
      deps.programar(vaciar, RETRASO_MS);
    }
  };

  return { registrar, vaciar };
}

let delNavegador: ReturnType<typeof crearCola> | null = null;

function colaDelNavegador(): ReturnType<typeof crearCola> | null {
  if (typeof window === "undefined") return null;
  if (delNavegador) return delNavegador;
  const cola = crearCola({
    enviar: (cuerpo) => {
      try {
        const aceptado = navigator.sendBeacon?.(
          "/api/uso",
          new Blob([cuerpo], { type: "application/json" }),
        );
        if (aceptado) return;
        void fetch("/api/uso", {
          method: "POST",
          body: cuerpo,
          headers: { "content-type": "application/json" },
          keepalive: true,
        }).catch(() => {});
      } catch {
        // Un evento perdido no puede costarle nada a la persona.
      }
    },
    programar: (fn, ms) => {
      window.setTimeout(fn, ms);
    },
    noRastrear: () =>
      navigator.doNotTrack === "1" ||
      (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true,
    // Una por carga de página, sólo para agrupar los pasos de UNA visita. No
    // se guarda en ningún almacenamiento del navegador.
    sesion:
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`,
  });
  window.addEventListener("pagehide", cola.vaciar);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") cola.vaciar();
  });
  delNavegador = cola;
  return cola;
}

/** Registra un paso del usuario. Nunca lanza y nunca espera. */
export function registrarUso<N extends EventoDeCliente>(nombre: N, datos: DatosDe<N>): void {
  colaDelNavegador()?.registrar(nombre, datos);
}
