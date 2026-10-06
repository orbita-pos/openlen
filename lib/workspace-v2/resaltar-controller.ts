// EL PUENTE ENTRE EL CHAT Y EL LIENZO para señalar una sección.
//
// El panel de Chat sabe QUÉ secciones cambió el turno (`diff-de-turno.ts`) y no
// tiene el iframe; `preview-area.tsx` tiene el iframe y no sabe nada del turno.
// Entre los dos hay `page.tsx`, 3.500 líneas, y enhebrar una llamada por ahí
// para esto sería pagar mucho por poco.
//
// Es el MISMO patrón que ya usa el barrido «Rayo X» (`scan-controller.ts`): un
// objeto de módulo al que el lienzo se suscribe y el Chat empuja. Se copia
// porque ya está probado en producción, no por comodidad.
//
// Deliberadamente tonto: sin estado, sin cola, sin reintentos. Si nadie está
// suscrito —el lienzo no está montado— el aviso se pierde y no pasa nada; el
// usuario ve el panel igual y no hay a dónde ir de todas formas.

/** El hijo `n` de `<body>`, o —para una sección de dentro de un contenedor— la
 *  ruta de hijo en hijo desde `<body>` (`SeccionCambiada.ruta`). */
export type DestinoDeResalte = number | readonly number[];

export interface ResaltarController {
  /** El lienzo se apunta. Devuelve la baja. */
  subscribe(fn: (destino: DestinoDeResalte) => void): () => void;
  /** El Chat pide señalar una sección. */
  resaltar(destino: DestinoDeResalte): void;
}

const posicion = (n: number) => Number.isInteger(n) && n >= 0;

export function createResaltarController(): ResaltarController {
  const listeners = new Set<(destino: DestinoDeResalte) => void>();
  return {
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    resaltar(destino) {
      // Un índice negativo es una sección QUITADA: ya no está en la página, así
      // que no hay nada que señalar. Se corta aquí y no en cada suscriptor. Una
      // ruta, igual: vacía o con un paso que no es una posición, no va a nada.
      const valido = typeof destino === "number" ? posicion(destino) : destino.length > 0 && destino.every(posicion);
      if (!valido) return;
      for (const fn of listeners) {
        try {
          fn(destino);
        } catch {
          // Un suscriptor que revienta no puede llevarse a los demás por
          // delante, ni al turno que acaba de terminar.
        }
      }
    },
  };
}

/** La instancia que comparten el Chat y el lienzo. */
export const resaltarController = createResaltarController();
