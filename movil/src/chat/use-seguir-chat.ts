import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/** Sigue respuestas y cambios de alto sólo mientras se está leyendo al final. */
export function useSeguirChat(abierto: boolean, contexto: string, cambio: unknown) {
  const log = useRef<HTMLDivElement>(null);
  const contenido = useRef<HTMLDivElement>(null);
  const siguiendo = useRef(true);
  const [puedeBajar, setPuedeBajar] = useState(false);
  const alFinal = useCallback(() => {
    siguiendo.current = true;
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
    setPuedeBajar(false);
  }, []);
  useLayoutEffect(() => { if (abierto) alFinal(); }, [abierto, contexto, alFinal]);
  useLayoutEffect(() => { if (abierto && siguiendo.current) alFinal(); }, [abierto, cambio, alFinal]);
  useEffect(() => {
    const el = log.current, interior = contenido.current;
    if (!el || !interior) return;
    const leerPosicion = () => {
      siguiendo.current = el.scrollHeight - el.clientHeight - el.scrollTop < 40;
      setPuedeBajar(!siguiendo.current);
    };
    const cambioDeAlto = () => {
      if (!abierto) return;
      if (siguiendo.current) alFinal();
    };
    const observador = new ResizeObserver(cambioDeAlto);
    observador.observe(el); observador.observe(interior);
    el.addEventListener("scroll", leerPosicion, { passive: true });
    return () => { observador.disconnect(); el.removeEventListener("scroll", leerPosicion); };
  }, [abierto, contexto, alFinal]);
  return { log, contenido, puedeBajar, alFinal };
}
