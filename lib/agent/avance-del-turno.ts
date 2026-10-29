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
//
// LEN 3.1 · Y LO QUE VIO EL MODELO, EN CUANTO CAMBIA (`soon`): es lo que el turno
// siguiente necesita si un deploy mata éste, y esperar la ventana de `cadaMs`
// era perder hasta 2 s de llamadas. Claude Code escribe cada entrada de su
// transcripción con una cola que vacía cada 100 ms, y la vacía entera al
// apagarse (`flush`).

export interface Avance {
  /** Algo cambió: habrá una escritura dentro de `cadaMs` como mucho. */
  tocar(): void;
  /** Cambió lo que vio el modelo: la escritura sale ya (o, si hay una en vuelo,
   *  en cuanto aterrice). */
  soon(): void;
  /** El proceso se va: espera a la que vuela y escribe lo que haya, ya. */
  flush(): Promise<void>;
  /** No más escrituras. Espera a la que esté en vuelo, para que el cierre del
   *  turno no se cruce con ella. */
  parar(): Promise<void>;
}

export function crearAvance(escribir: () => Promise<void>, cadaMs = 2000): Avance {
  let reloj: ReturnType<typeof setTimeout> | null = null;
  /** Cuándo salta `reloj`: uno que salta antes no se aplaza. */
  let vence = 0;
  let enVuelo: Promise<void> | null = null;
  /** Lo que cambió mientras una escritura volaba: tras cuánto sale la siguiente. */
  let pendiente: number | null = null;
  let parado = false;

  const programar = (ms: number): void => {
    if (parado) return;
    const at = Date.now() + ms;
    if (reloj) {
      if (vence <= at) return;
      clearTimeout(reloj);
    }
    vence = at;
    reloj = setTimeout(lanzar, ms);
    (reloj as { unref?: () => void }).unref?.();
  };

  const una = (): Promise<void> => {
    // Fail-soft: una escritura que falla no puede costarle el turno a nadie.
    const vuelo = escribir()
      .catch(() => {})
      .finally(() => {
        enVuelo = null;
        if (pendiente !== null && !parado) {
          const ms = pendiente;
          pendiente = null;
          programar(ms);
        }
      });
    enVuelo = vuelo;
    return vuelo;
  };

  function lanzar(): void {
    reloj = null;
    if (parado) return;
    if (enVuelo) {
      pendiente = Math.min(pendiente ?? cadaMs, cadaMs);
      return;
    }
    void una();
  }

  return {
    tocar: () => programar(cadaMs),
    soon() {
      if (parado) return;
      if (enVuelo) {
        pendiente = 0;
        return;
      }
      programar(0);
    },
    async flush() {
      if (parado) return;
      if (reloj) clearTimeout(reloj);
      reloj = null;
      pendiente = null;
      while (enVuelo) await enVuelo;
      if (parado) return;
      await una();
    },
    async parar() {
      parado = true;
      if (reloj) clearTimeout(reloj);
      reloj = null;
      await enVuelo;
    },
  };
}
