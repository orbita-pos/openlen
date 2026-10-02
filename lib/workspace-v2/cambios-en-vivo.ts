// LO QUE CAMBIÓ EN CADA TURNO, del Chat a la lente «Cambios» del lienzo
// (plans/len-agente-2026; la forma de DeepSeek, ver `lib/agent/cambios-del-turno.ts`).
//
// El Chat recibe el evento `cambios` al final de cada turno y lo guarda aquí;
// la tarjeta del pie del turno y la lente lo leen. Es el patrón de
// `terminal-en-vivo.ts`: un objeto de módulo al que el Chat empuja y los demás
// se suscriben. Y lleva además la PETICIÓN de abrir: pulsar una fila de la
// tarjeta pide la lente en ese fichero, y el lienzo —que es quien manda la
// lente— la atiende.
//
// VIVE LO QUE LA PESTAÑA, como en DeepSeek vive lo que la sesión: al recargar
// no hay tarjeta, porque una tarjeta cuyo contenido ya no se puede abrir no se
// enseña.

import type { FicheroCambiado } from "@/lib/agent/cambios-del-turno";

export interface CambiosDeUnTurno {
  readonly turnId: string;
  /** Lo que pidió el usuario, para nombrar el turno en la lente. */
  readonly pedido: string;
  readonly ficheros: readonly FicheroCambiado[];
}

export interface PeticionDeCambios {
  readonly turnId: string;
  /** El fichero en el que abrir; `null`, el primero. */
  readonly ruta: string | null;
  /** Sube con cada petición: pedir dos veces lo mismo también abre. */
  readonly n: number;
}

/** Un fichero del evento `cambios` con la forma que pinta la lente; lo demás se descarta. */
export function esFicheroCambiado(x: unknown): x is FicheroCambiado {
  if (typeof x !== "object" || x === null) return false;
  const f = x as Record<string, unknown>;
  if (typeof f.ruta !== "string" || !f.ruta.startsWith("/")) return false;
  const textoONulo = (v: unknown) => v === null || typeof v === "string";
  if (f.tipo === "texto") return textoONulo(f.antes) && textoONulo(f.despues) && !(f.antes === null && f.despues === null);
  return f.tipo === "grande" && typeof f.nuevo === "boolean" && typeof f.borrado === "boolean";
}

/** Tope por proyecto: cada turno lleva el texto entero de lo que tocó. */
const TOPE = 20;

export interface CambiosEnVivo {
  subscribe(fn: () => void): () => void;
  /** Los turnos del proyecto con cambios, del más viejo al más nuevo; la MISMA
   *  referencia mientras no cambie (para `useSyncExternalStore`). */
  turnos(projectId: string): readonly CambiosDeUnTurno[];
  guardar(projectId: string, turno: CambiosDeUnTurno): void;
  abrir(projectId: string, turnId: string, ruta: string | null): void;
  peticion(projectId: string): PeticionDeCambios | null;
}

const VACIA: readonly CambiosDeUnTurno[] = [];

export function createCambiosEnVivo(): CambiosEnVivo {
  const porProyecto = new Map<string, readonly CambiosDeUnTurno[]>();
  const peticiones = new Map<string, PeticionDeCambios>();
  let n = 0;
  const listeners = new Set<() => void>();
  const avisar = () => {
    for (const fn of listeners) {
      try {
        fn();
      } catch {
        // Un suscriptor que revienta no se lleva a los demás.
      }
    }
  };
  return {
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    turnos(projectId) {
      return porProyecto.get(projectId) ?? VACIA;
    },
    guardar(projectId, turno) {
      const otros = (porProyecto.get(projectId) ?? VACIA).filter((t) => t.turnId !== turno.turnId);
      porProyecto.set(projectId, [...otros, turno].slice(-TOPE));
      avisar();
    },
    abrir(projectId, turnId, ruta) {
      peticiones.set(projectId, { turnId, ruta, n: ++n });
      avisar();
    },
    peticion(projectId) {
      return peticiones.get(projectId) ?? null;
    },
  };
}

/** La instancia que comparten el Chat, su tarjeta y la lente. */
export const cambiosEnVivo = createCambiosEnVivo();
