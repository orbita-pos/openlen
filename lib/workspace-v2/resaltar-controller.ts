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

export interface ResaltarController {
  /** El lienzo se apunta. Devuelve la baja. */
  subscribe(fn: (indice: number) => void): () => void;
  /** El Chat pide señalar el hijo `indice` de `<body>`. */
  resaltar(indice: number): void;
}

export function createResaltarController(): ResaltarController {
  const listeners = new Set<(indice: number) => void>();
  return {
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    resaltar(indice) {
      // Un índice negativo es una sección QUITADA: ya no está en la página, así
      // que no hay nada que señalar. Se corta aquí y no en cada suscriptor.
      if (!Number.isInteger(indice) || indice < 0) return;
      for (const fn of listeners) {
        try {
          fn(indice);
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
