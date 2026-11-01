import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * Sigue respuestas y cambios de alto sólo mientras se está leyendo al final. Con `enfocar` (la clave de un
 * elemento del hilo, desde «Entregado»), en cuanto ese elemento está pintado lo trae a la vista y deja de
 * seguir el final, como quien sube a leerlo; `alEnfocar` avisa de que ya se hizo.
 */
export function useSeguirChat(abierto: boolean, contexto: string, cambio: unknown, enfocar?: string | null, alEnfocar?: () => void) {
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
  useLayoutEffect(() => {
    if (!abierto || !enfocar) return;
    const fila = [...(contenido.current?.querySelectorAll<HTMLElement>("[data-clave]") ?? [])].find((x) => x.dataset.clave === enfocar);
    if (!fila) return;
    siguiendo.current = false;
    fila.scrollIntoView({ block: "center" });
    setPuedeBajar(true);
    alEnfocar?.();
  }, [abierto, cambio, enfocar, alEnfocar]);
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
