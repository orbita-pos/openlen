// LOS TURNOS QUE LEN EMPEZÓ DESDE UN HILO DEL CÓDIGO (`@Len`, lib/projects/hilos.ts).
//
// Como en Claude Tag, el turno arranca EN EL SERVIDOR al publicar el mensaje
// (lib/agent/turnos-desde-el-servidor.ts): no espera a ningún panel. La lente
// «Código» anuncia aquí su fila y, si el chat está abierto, lo pinta en marcha
// y lo sigue en vivo; si no, lo encontrará al abrirse (viene en curso con la
// conversación). El patrón de `abrir-fichero.ts`: un objeto de módulo con su
// `subscribe`.

export interface TurnoDelHilo {
  readonly filaId: string;
  /** Lo que se escribió, tal cual: lo que enseña el chat. */
  readonly texto: string;
  readonly origen: { readonly hiloId: string; readonly ruta: string; readonly linea: number };
}

export interface TurnosDelHilo {
  subscribe(fn: () => void): () => void;
  anunciar(projectId: string, turno: TurnoDelHilo): void;
  /** El primero sin recoger, sin sacarlo. */
  primero(projectId: string): TurnoDelHilo | null;
  /** Lo saca el chat al pintarlo. */
  recogido(projectId: string, turno: TurnoDelHilo): void;
}

export function createTurnosDelHilo(): TurnosDelHilo {
  const colas = new Map<string, TurnoDelHilo[]>();
  const oyentes = new Set<() => void>();
  const avisar = () => oyentes.forEach((f) => f());
  return {
    subscribe(fn) {
      oyentes.add(fn);
      return () => oyentes.delete(fn);
    },
    anunciar(projectId, turno) {
      colas.set(projectId, [...(colas.get(projectId) ?? []), turno]);
      avisar();
    },
    primero(projectId) {
      return colas.get(projectId)?.[0] ?? null;
    },
    recogido(projectId, turno) {
      const cola = colas.get(projectId) ?? [];
      const resto = cola.filter((p) => p !== turno);
      if (resto.length === cola.length) return;
      if (resto.length > 0) colas.set(projectId, resto);
      else colas.delete(projectId);
      avisar();
    },
  };
}

export const turnosDelHilo = createTurnosDelHilo();
