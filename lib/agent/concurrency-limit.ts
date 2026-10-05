/**
 * UN TOPE DE TAREAS A LA VEZ. La pieza 4 de Len 2.5 deja correr juntas las
 * llamadas seguras de una vuelta; DeepSeek deja la capacidad en manos de quien
 * la gasta («providers own their capacity controls»). Lo usa `usar_pagina`, que
 * arranca un Chromium por visita (§11 de la investigación: tope 2).
 */
export function createConcurrencyLimit(max: number): <T>(fn: () => Promise<T>) => Promise<T> {
  const tope = Math.max(1, Math.floor(max) || 1);
  let activas = 0;
  const cola: (() => void)[] = [];
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (activas >= tope) await new Promise<void>((resolve) => cola.push(resolve));
    activas++;
    try {
      return await fn();
    } finally {
      activas--;
      cola.shift()?.();
    }
  };
}
