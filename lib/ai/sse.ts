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

export interface SseChannelOptions {
  /**
   * 🔴 CADA CUÁNTO LATIR SI EL TURNO NO TIENE NADA QUE DECIR. Ausente = sin
   * latido, que es como salía este canal hasta el 2026-09-15.
   *
   * EL CASO: un turno del Agente se quedó dentro de una medición que no volvía.
   * El stream siguió abierto y mudo, y a los 90 SEGUNDOS EXACTOS Caddy cortó la
   * respuesta a medias — `read_timeout 90s` en su transporte hacia Next
   * (infra/caddy/Caddyfile):
   *
   *   18:08:10  última señal del turno
   *   18:09:40  aborting with incomplete response · read tcp …:3000: i/o timeout
   *
   * El navegador llama a eso «network error» y el usuario lee que se ha caído
   * internet. No se había caído nada: se había callado el servidor. El muro no
   * es nuestro y no se negocia con él — se habla antes de que llegue.
   *
   * Crear ya latía por esto mismo (`keepalive` en app/api/generate/route.ts),
   * con su propio temporizador escrito a mano. Vive aquí para que la tercera
   * superficie no tenga que acordarse: es la misma razón por la que este
   * fichero existe.
   */
  readonly latidoMs?: number;
}

const ENCODER = new TextEncoder();

/** Un COMENTARIO SSE, no un evento. Sin línea `data:`, así que el lector del
 *  taller (chat-panel.tsx) lo descarta en su `if (!dataStr) continue` y ningún
 *  cliente puede confundirlo con trabajo. Lo único que hace es ocupar el cable. */
const LATIDO = ": latido\n\n";

export function sseChannel(
  controller: ReadableStreamDefaultController<Uint8Array>,
  options: SseChannelOptions = {},
): SseChannel {
  let closed = false;
  let reloj: ReturnType<typeof setInterval> | undefined;

  const escribir = (texto: string) => {
    if (closed) return;
    try {
      controller.enqueue(ENCODER.encode(texto));
    } catch {
      // El cliente se fue. Marcarlo cerrado es lo que evita que las etapas
      // siguientes sigan intentando escribir contra un socket muerto.
      closed = true;
      clearInterval(reloj);
    }
  };

  // SE REINICIA CON CADA SEÑAL DE AVANCE, no dispara a ciegas — es el vigía de
  // silencio de Claude Code (su corredor de `git` hace
  // `…` en cada línea de progreso). Un turno que habla
  // no necesita que le añadamos bytes; el latido es para el que se calla.
  const rearmar = () => {
    if (!options.latidoMs || closed) return;
    clearInterval(reloj);
    reloj = setInterval(() => escribir(LATIDO), options.latidoMs);
    (reloj as { unref?: () => void }).unref?.();
  };
  rearmar();

  return {
    emit(event, data) {
      if (closed) return;
      escribir(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      rearmar();
    },
    close(cleanup) {
      if (closed) return;
      closed = true;
      // ANTES que el `cleanup` del llamador: si éste lanza, el temporizador no
      // puede sobrevivir al turno latiendo contra un canal cerrado.
      clearInterval(reloj);
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
