// LOS COMANDOS DE LEN EN VIVO, del Chat a la lente «Terminal» del lienzo (F6a
// de plans/len-agente-2026).
//
// El panel de Chat lee el stream de /api/agent y el lienzo pinta la lente; entre
// los dos está `page.tsx`, y es el mismo patrón que `resaltar-controller.ts`: un
// objeto de módulo al que el Chat empuja y la lente se suscribe.
//
// A diferencia de aquél, éste GUARDA lo recibido (por proyecto, mientras dure la
// pestaña): la lente puede abrirse a mitad de turno y tiene que ver los
// comandos que ya pasaron. Lo de turnos anteriores no vive aquí: lo trae
// `GET /api/projects/[id]/terminal`, y `sinLosYaGuardados` quita de aquí lo que
// esa ruta ya devuelve, para no enseñarlo dos veces.

export interface ComandoEnVivo {
  readonly command: string;
  readonly salida: string;
  readonly exitCode: number;
}

/** Tope por proyecto: la lente no es un registro infinito. */
const TOPE = 200;

export interface TerminalEnVivo {
  subscribe(fn: () => void): () => void;
  /** La lista del proyecto; la MISMA referencia mientras no cambie (para `useSyncExternalStore`). */
  comandos(projectId: string): readonly ComandoEnVivo[];
  empujar(projectId: string, comando: ComandoEnVivo): void;
  /** Quita lo que ya está en el historial guardado (mismo comando y misma salida). */
  sinLosYaGuardados(projectId: string, guardados: readonly { command: string; salida: string | null }[]): void;
}

const VACIA: readonly ComandoEnVivo[] = [];

export function createTerminalEnVivo(): TerminalEnVivo {
  const porProyecto = new Map<string, readonly ComandoEnVivo[]>();
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
    comandos(projectId) {
      return porProyecto.get(projectId) ?? VACIA;
    },
    empujar(projectId, comando) {
      const antes = porProyecto.get(projectId) ?? VACIA;
      porProyecto.set(projectId, [...antes, comando].slice(-TOPE));
      avisar();
    },
    sinLosYaGuardados(projectId, guardados) {
      const antes = porProyecto.get(projectId);
      if (!antes?.length) return;
      const ya = new Set(guardados.map((g) => `${g.command}\u0000${g.salida ?? ""}`));
      const quedan = antes.filter((c) => !ya.has(`${c.command}\u0000${c.salida}`));
      if (quedan.length === antes.length) return;
      porProyecto.set(projectId, quedan);
      avisar();
    },
  };
}

/** La instancia que comparten el Chat y la lente. */
export const terminalEnVivo = createTerminalEnVivo();
