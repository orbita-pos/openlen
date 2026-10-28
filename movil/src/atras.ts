// El gesto de atrás de Android (Jesús, 01/10): cierra lo que esté abierto en
// vez de sacarte de la app. Cada cosa abierta mete una entrada en el
// historial (la misma URL); atrás la saca, llega `popstate` y se cierra.
// Sirve igual en Chrome que en la app instalada: mientras el WebView tenga
// historial, Capacitor hace `goBack()` (AppPlugin.java de @capacitor/app).
import { useEffect, useLayoutEffect, useRef } from "react";

const CLAVE = "lenCapa";
const IDENTIDAD = "lenCapaId";
let serie = Date.now();
const retiradas = new Set<number>();
let escuchaRetiradas = false;
const identidad = () => (history.state as Record<string, unknown> | null)?.[IDENTIDAD];
const nivel = (): number => {
  const v = (history.state as Record<string, unknown> | null)?.[CLAVE];
  return typeof v === "number" ? v : 0;
};

export function useAtras(abierto: boolean, cerrar: () => void) {
  const ultimo = useRef(cerrar);
  useLayoutEffect(() => {
    ultimo.current = cerrar;
  });

  useEffect(() => {
    if (!abierto) return;
    // Cada capa con su nivel: con dos abiertas, atrás cierra sólo la de arriba.
    if (!escuchaRetiradas) {
      escuchaRetiradas = true;
      addEventListener("popstate", () => {
        const id = identidad();
        // Un panel puede terminar su salida debajo de un chat recién abierto.
        // Esa entrada ya no representa nada visible: Atrás la salta también.
        if (typeof id === "number" && retiradas.delete(id)) history.back();
        if (nivel() === 0) retiradas.clear();
      });
    }
    const mio = nivel() + 1, id = ++serie;
    history.pushState({ ...((history.state as object | null) ?? {}), [CLAVE]: mio, [IDENTIDAD]: id }, "");
    let porAtras = false;
    const alVolver = () => {
      if (nivel() >= mio) return;
      porAtras = true;
      ultimo.current();
    };
    addEventListener("popstate", alVolver);
    return () => {
      removeEventListener("popstate", alVolver);
      // Cerrada con el dedo o con un botón: su entrada sobra, y si se quedara,
      // el siguiente atrás no haría nada visible.
      if (!porAtras) queueMicrotask(() => {
        // React puede montar el siguiente panel en este mismo commit. Esperar
        // a sus efectos evita que un back pendiente borre su entrada nueva.
        if (identidad() === id) history.back();
        else if (nivel() > mio) retiradas.add(id);
      });
    };
  }, [abierto]);
}
