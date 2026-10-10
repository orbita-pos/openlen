import { useEffect, useRef } from "react";

// EL PROYECTO EN BLANCO (plans/crear-es-len, 2026-10-06): con el estado vacío
// en el centro, la barra lateral va plegada, como iba la entrada de Crear: el
// chat todavía no tiene nada que enseñar. Una vez por VISITA, para que
// abrirla a mano no se deshaga sola mientras sigues ahí.
//
// Por visita y no por proyecto: `/new` reutiliza el mismo proyecto en blanco,
// y recordarlo para siempre dejaba el chat abierto al volver desde otro
// proyecto donde se había abierto (visto en producción el 10/10). Al salir —a
// otro proyecto, o porque deja de estar en blanco— se olvida.
export function useCollapseWhileBlank(opts: { isBlank: boolean; projectId: string | null; collapse: () => void }): void {
  const { isBlank, projectId } = opts;
  const collapseRef = useRef(opts.collapse);
  collapseRef.current = opts.collapse;
  const collapsedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!isBlank || !projectId) {
      collapsedFor.current = null;
      return;
    }
    if (collapsedFor.current === projectId) return;
    collapsedFor.current = projectId;
    collapseRef.current();
  }, [isBlank, projectId]);
}
