// La cara de Len: la MISMA de la web (brand/len-cara/cara.js), con sus estados
// (saludando, escuchando, mirando, pensando, avisando, terminado, reposo…).
// Como en el prototipo, el estado va también al host (`data-st`): su CSS pinta
// la cara gris en «error», que cara.js hace con sus atributos y el naranja
// taparía. `props`: "compact" en la llamada, "none" en la barra y la hoja.
import { useEffect, useLayoutEffect, useRef } from "react";
import { escucharLook, leerLook, sanearLook, type Look } from "./personalizacion/preferencia";

export function Cara({ estado, className, props = "none", look }: { estado: string; className: string; props?: "compact" | "none"; look?: Look }) {
  const host = useRef<HTMLDivElement>(null);
  const cara = useRef<MotorDeCara | null>(null);
  const ultimo = useRef({ estado, props, look });
  useLayoutEffect(() => { ultimo.current = { estado, props, look }; });
  useEffect(() => {
    let vivo = true;
    const actualizarLook = () => {
      if (!window.LenCara) return;
      const api = window.LenCara;
      cara.current?.setLook?.(ultimo.current.look ? sanearLook(ultimo.current.look, api) : leerLook(api), !api.reduced);
    };
    const dejarDeEscuchar = escucharLook(actualizarLook);
    void import("@/brand/len-cara/cara.js").then(() => {
      const h = host.current;
      if (!vivo || !h || !window.LenCara || cara.current) return;
      const actual = ultimo.current;
      h.dataset.st = actual.estado;
      cara.current = window.LenCara.create(h, { props: actual.props, state: actual.estado, look: actual.look ? sanearLook(actual.look, window.LenCara) : leerLook(window.LenCara), onchange: (s) => (h.dataset.st = s) });
    }).catch(() => { /* La cara es decorativa: las acciones siguen disponibles. */ });
    return () => {
      vivo = false;
      dejarDeEscuchar();
    };
    // Se crea una vez; el estado lo mueve el efecto de abajo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    cara.current?.set(estado);
  }, [estado]);
  useEffect(() => {
    const api = window.LenCara;
    if (api) cara.current?.setLook?.(look ? sanearLook(look, api) : leerLook(api), !api.reduced);
  }, [look]);
  return <div ref={host} className={className} aria-hidden />;
}
