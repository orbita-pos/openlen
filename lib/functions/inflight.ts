// lib/functions/inflight.ts — LAS LLAMADAS QUE AÚN NO SE HAN ANOTADO (pendiente
// de la fase 1). `use_page`/`view_page` leen las llamadas de su visita al
// acabarla, y la última se anota al cerrar su cuerpo: un instante después. Esto
// deja esperar a que se anoten, con tope (un stream que no acaba no cuelga a
// Len). Uno por PROCESO, en `globalThis`, como el motor.

import type { FunctionsEnvironment } from "./engines/types";

export class InflightCalls {
  readonly #n = new Map<string, number>();
  readonly #waiters = new Map<string, Set<() => void>>();

  start(projectId: string, env: FunctionsEnvironment): () => void {
    const k = `${projectId}|${env}`;
    this.#n.set(k, (this.#n.get(k) ?? 0) + 1);
    let hecho = false;
    return () => {
      if (hecho) return;
      hecho = true;
      const n = (this.#n.get(k) ?? 1) - 1;
      if (n > 0) {
        this.#n.set(k, n);
        return;
      }
      this.#n.delete(k);
      for (const w of this.#waiters.get(k) ?? []) w();
      this.#waiters.delete(k);
    };
  }

  settled(projectId: string, env: FunctionsEnvironment, timeoutMs: number): Promise<void> {
    const k = `${projectId}|${env}`;
    if (!this.#n.get(k)) return Promise.resolve();
    return new Promise((resolve) => {
      const set = this.#waiters.get(k) ?? new Set<() => void>();
      const fin = () => {
        clearTimeout(reloj);
        set.delete(fin);
        resolve();
      };
      const reloj = setTimeout(fin, timeoutMs);
      set.add(fin);
      this.#waiters.set(k, set);
    });
  }
}

const CLAVE = Symbol.for("openlen.functions.inflight");
type Global = typeof globalThis & { [CLAVE]?: InflightCalls };

export function inflightCalls(): InflightCalls {
  const g = globalThis as Global;
  return (g[CLAVE] ??= new InflightCalls());
}
