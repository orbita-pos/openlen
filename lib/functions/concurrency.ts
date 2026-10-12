// lib/functions/concurrency.ts — LAS LLAMADAS A LA VEZ DE CADA PROYECTO (spec
// local 2026-10-11, Parte 3). En memoria: la app es UN proceso en UNA caja (si
// un día son varios, esto pasa a Postgres como el rate-limit).

export class ConcurrencyLimiter {
  readonly #enCurso = new Map<string, number>();

  /** Una plaza si hay; devuelve con qué soltarla (soltar dos veces no suelta dos). */
  tryAcquire(key: string, max: number): (() => void) | null {
    const n = this.#enCurso.get(key) ?? 0;
    if (n >= max) return null;
    this.#enCurso.set(key, n + 1);
    let suelta = false;
    return () => {
      if (suelta) return;
      suelta = true;
      const m = (this.#enCurso.get(key) ?? 1) - 1;
      if (m <= 0) this.#enCurso.delete(key);
      else this.#enCurso.set(key, m);
    };
  }

  inFlight(key: string): number {
    return this.#enCurso.get(key) ?? 0;
  }
}
