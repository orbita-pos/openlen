/**
 * El canal de eventos que las tres puertas de IA abren hacia el navegador.
 *
 * Estaba escrito tres veces —crear, el Chat y el Agente— con el mismo `emit`
 * carácter por carácter y un cierre que sólo difería en qué temporizador
 * apagaba. Tres copias de la misma regla: **una vez cerrado, nada más sale**;
 * escribir en un controlador cerrado lanza, y esa excepción viajaba hasta el
 * catch exterior de la ruta abortando un turno que ya había terminado bien.
 */
export interface SseChannel {
  /** No hace nada si el canal ya está cerrado. Nunca lanza. */
  emit(event: string, data: unknown): void;
  /** Idempotente. `cleanup` corre una sola vez, antes de cerrar. */
  close(cleanup?: () => void): void;
  /** Para las guardas de "¿sigo vivo?" en medio de un bucle largo. */
  readonly isClosed: boolean;
}

const ENCODER = new TextEncoder();

export function sseChannel(
  controller: ReadableStreamDefaultController<Uint8Array>,
): SseChannel {
  let closed = false;
  return {
    emit(event, data) {
      if (closed) return;
      try {
        controller.enqueue(
          ENCODER.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      } catch {
        // El cliente se fue. Marcarlo cerrado es lo que evita que las etapas
        // siguientes sigan intentando escribir contra un socket muerto.
        closed = true;
      }
    },
    close(cleanup) {
      if (closed) return;
      closed = true;
      cleanup?.();
      try {
        controller.close();
      } catch {
        /* already closed */
      }
    },
    get isClosed() {
      return closed;
    },
  };
}

/** Las tres rutas devolvían este mismo JSON con tres helpers distintos. */
export function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
