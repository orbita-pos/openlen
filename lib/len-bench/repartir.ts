// lib/len-bench/repartir.ts — qué casos van a dev y cuáles al sellado.
//
// Al azar, POR NIVEL y con SEMILLA (plans/len-2/diseno.md §3.6): la misma
// proporción de N1/N2/N3 en los dos juegos, para que la calibración medida en
// dev valga para el sellado, que no se corre hasta la fase 4. La semilla queda
// escrita en plans/len-2/reparto.md: el reparto se puede rehacer y auditar.
// (El corredor de evals de Claude Code no elige casos: esto no lo cubre.)

import type { Nivel } from "./tipos";

/** mulberry32 sembrado con FNV-1a de la semilla: el mismo texto, la misma serie. */
function prng(semilla: string): () => number {
  let h = 2166136261;
  for (const ch of semilla) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function repartir(casos: readonly { id: string; nivel: Nivel }[], semilla: string): { dev: string[]; sellado: string[] } {
  const azar = prng(semilla);
  const dev: string[] = [];
  const sellado: string[] = [];
  for (const nivel of ["N1", "N2", "N3"] as const) {
    // Ordenados antes de barajar: el reparto no depende del orden de entrada.
    const ids = casos
      .filter((c) => c.nivel === nivel)
      .map((c) => c.id)
      .sort();
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(azar() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    const nDev = Math.round((ids.length * 2) / 3);
    dev.push(...ids.slice(0, nDev));
    sellado.push(...ids.slice(nDev));
  }
  return { dev, sellado };
}
