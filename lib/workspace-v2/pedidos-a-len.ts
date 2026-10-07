// LO QUE SE LE PIDE A LEN DESDE UN HILO DEL CÓDIGO (`@Len`, lib/projects/hilos.ts).
//
// La lente «Código» deja aquí el pedido y el chat —que es quien habla con Len—
// lo atiende: lo manda como un mensaje más, con el `hiloId`, para que el turno
// se vea en el chat como cualquier otro y Len conteste además en el hilo al
// cerrarlo. Si Len ya está trabajando, el pedido espera aquí a que acabe (dos
// turnos a la vez sobre el mismo proyecto serían dos Len editándolo). El
// patrón de `abrir-fichero.ts`: un objeto de módulo con su `subscribe`.

export interface PedidoALen {
  readonly texto: string;
  readonly hiloId: string;
}

export interface PedidosALen {
  subscribe(fn: () => void): () => void;
  pedir(projectId: string, pedido: PedidoALen): void;
  /** El primero que espera, sin sacarlo. */
  primero(projectId: string): PedidoALen | null;
  /** Lo saca quien lo atiende. */
  atendido(projectId: string, pedido: PedidoALen): void;
}

export function createPedidosALen(): PedidosALen {
  const colas = new Map<string, PedidoALen[]>();
  const oyentes = new Set<() => void>();
  const avisar = () => oyentes.forEach((f) => f());
  return {
    subscribe(fn) {
      oyentes.add(fn);
      return () => oyentes.delete(fn);
    },
    pedir(projectId, pedido) {
      colas.set(projectId, [...(colas.get(projectId) ?? []), pedido]);
      avisar();
    },
    primero(projectId) {
      return colas.get(projectId)?.[0] ?? null;
    },
    atendido(projectId, pedido) {
      const cola = colas.get(projectId) ?? [];
      const resto = cola.filter((p) => p !== pedido);
      if (resto.length === cola.length) return;
      if (resto.length > 0) colas.set(projectId, resto);
      else colas.delete(projectId);
      avisar();
    },
  };
}

export const pedidosALen = createPedidosALen();
