// lib/agent/avance-del-turno.ts — guardar lo que el turno lleva, sin martillear la base.
//
// LEN 2.1 · EL TURNO SE GUARDA A MEDIDA QUE PASA (diagnóstico §4.4 punto 2).
// Desde que el turno no muere con el cliente, quien vuelve a mirarlo —otra
// pestaña, el móvil, la misma pestaña tras perder la red— lo lee de su fila
// (`status: en_curso`). Esa fila tiene que ir al día, pero el bucle emite un
// evento por cada trozo de texto: escribir en cada uno serían cientos de
// UPDATE por turno.
//
// La regla: como mucho una escritura cada `cadaMs`, nunca dos a la vez, y la
// última siempre sale (lo que cambie mientras una escritura vuela se guarda en
// la siguiente). Puro: no sabe qué escribe ni dónde.

export interface Avance {
  /** Algo cambió: habrá una escritura dentro de `cadaMs` como mucho. */
  tocar(): void;
  /** No más escrituras. Espera a la que esté en vuelo, para que el cierre del
   *  turno no se cruce con ella. */
  parar(): Promise<void>;
}

export function crearAvance(escribir: () => Promise<void>, cadaMs = 2000): Avance {
  let reloj: ReturnType<typeof setTimeout> | null = null;
  let enVuelo: Promise<void> | null = null;
  let pendiente = false;
  let parado = false;

  const programar = (): void => {
    if (reloj || parado) return;
    reloj = setTimeout(lanzar, cadaMs);
    (reloj as { unref?: () => void }).unref?.();
  };

  function lanzar(): void {
    reloj = null;
    if (parado) return;
    if (enVuelo) {
      pendiente = true;
      return;
    }
    // Fail-soft: una escritura que falla no puede costarle el turno a nadie.
    enVuelo = escribir()
      .catch(() => {})
      .finally(() => {
        enVuelo = null;
        if (pendiente && !parado) {
          pendiente = false;
          programar();
        }
      });
  }

  return {
    tocar: programar,
    async parar() {
      parado = true;
      if (reloj) clearTimeout(reloj);
      reloj = null;
      await enVuelo;
    },
  };
}
