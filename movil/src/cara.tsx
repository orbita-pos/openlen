// La cara de Len: la MISMA de la web (brand/len-cara/cara.js), con sus estados
// (saludando, escuchando, mirando, pensando, avisando, terminado, reposo…).
// Como en el prototipo, el estado va también al host (`data-st`): su CSS pinta
// la cara gris en «error», que cara.js hace con sus atributos y el naranja
// taparía. `props`: "compact" en la llamada, "none" en la barra y la hoja.
import { useEffect, useRef } from "react";

export function Cara({ estado, className, props = "none" }: { estado: string; className: string; props?: "compact" | "none" }) {
  const host = useRef<HTMLDivElement>(null);
  const cara = useRef<MotorDeCara | null>(null);
  useEffect(() => {
    let vivo = true;
    void import("@/brand/len-cara/cara.js").then(() => {
      const h = host.current;
      if (!vivo || !h || !window.LenCara || cara.current) return;
      h.dataset.st = estado;
      cara.current = window.LenCara.create(h, { props, state: estado, onchange: (s) => (h.dataset.st = s) });
    });
    return () => {
      vivo = false;
    };
    // Se crea una vez; el estado lo mueve el efecto de abajo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    cara.current?.set(estado);
  }, [estado]);
  return <div ref={host} className={className} aria-hidden />;
}
