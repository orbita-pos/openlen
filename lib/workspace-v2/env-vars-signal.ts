// CAMBIARON LAS VARIABLES DE ENTORNO (spec local 2026-10-10): el diálogo lo
// avisa y el lienzo vuelve a subir su documento, que lleva el `import.meta.env`
// de borrador. Sin esto la app del lienzo seguiría con los valores de antes
// hasta el siguiente cambio de código. El patrón de `abrir-fichero.ts`: un
// objeto de módulo que uno escribe y otro escucha.
import { useSyncExternalStore } from "react";

const versions = new Map<string, number>();
const listeners = new Set<() => void>();

export function notifyEnvVarsChanged(projectId: string): void {
  versions.set(projectId, (versions.get(projectId) ?? 0) + 1);
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      // Un suscriptor que revienta no se lleva a los demás.
    }
  }
}

export function subscribeEnvVars(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function envVarsVersion(projectId: string | null): number {
  return projectId ? (versions.get(projectId) ?? 0) : 0;
}

export function useEnvVarsVersion(projectId: string | null): number {
  return useSyncExternalStore(subscribeEnvVars, () => envVarsVersion(projectId), () => 0);
}
