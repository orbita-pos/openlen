// El gesto de atrás de Android (Jesús, 01/10): cierra lo que esté abierto en
// vez de sacarte de la app. Cada cosa abierta mete una entrada en el
// historial (la misma URL); atrás la saca, llega `popstate` y se cierra.
// Sirve igual en Chrome que en la app instalada: mientras el WebView tenga
// historial, Capacitor hace `goBack()` (AppPlugin.java de @capacitor/app).
import { useEffect, useLayoutEffect, useRef } from "react";

const CLAVE = "lenCapa";
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
    const mio = nivel() + 1;
    history.pushState({ ...((history.state as object | null) ?? {}), [CLAVE]: mio }, "");
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
      if (!porAtras && nivel() === mio) history.back();
    };
  }, [abierto]);
}
