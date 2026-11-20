// LA APP VUELVE AL PRIMER PLANO (spec local 2026-11-17-oauth-de-conectores-mcp, §10.1). Se sale al navegador del sistema
// —p. ej. a iniciar sesión en un conector— y al volver hay que mirar qué pasó. Teléfono: `appStateChange` de
// @capacitor/app, que es lo que de verdad avisa de eso. Navegador de la PC (desarrollo): el foco de la ventana y la
// visibilidad de la página. Aparte de plataforma.ts, que importa Capacitor, para poder probarlo sin él: lo de fuera
// entra por `DepsDeVolver`, como en entrada.ts.

export interface DepsDeVolver {
  enWeb: boolean;
  /** Teléfono: `App.addListener("appStateChange", fn)` de @capacitor/app. */
  escucharEstadoDeLaApp(fn: (estado: { isActive: boolean }) => void): Promise<{ remove(): Promise<void> | void }>;
  ventana: EventTarget;
  documento: EventTarget & { visibilityState: string };
}

/** `fn` corre cada vez que la app vuelve al primer plano; lo que devuelve la deja de oír. */
export function volverAlPrimerPlano(d: DepsDeVolver, fn: () => void): () => void {
  if (d.enWeb) {
    const volvio = () => {
      if (d.documento.visibilityState !== "hidden") fn();
    };
    d.ventana.addEventListener("focus", volvio);
    d.documento.addEventListener("visibilitychange", volvio);
    return () => {
      d.ventana.removeEventListener("focus", volvio);
      d.documento.removeEventListener("visibilitychange", volvio);
    };
  }
  const oyente = d.escucharEstadoDeLaApp(({ isActive }) => {
    if (isActive) fn();
  });
  // Sin plugin o sin permiso no hay nada que quitar, y tampoco es un error que nadie esté esperando.
  void oyente.catch(() => {});
  return () => {
    void oyente.then((o) => o.remove()).catch(() => {});
  };
}
