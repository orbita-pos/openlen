import { useLayoutEffect, useState, type ReactNode } from "react";
import { movimientoReducido } from "./movimiento";
import "./panel-animado.css";
import { useDeslizar } from "./deslizar";

type Contenido = { contexto: string; children: ReactNode; nivel: number; paso: string };
/** Conserva sólo la última pantalla durante su salida; nunca cruza proyectos. */
export function PanelAnimado({ children, contexto, nivel, paso = "", onVolver }: { children: ReactNode; contexto: string; nivel: number; paso?: string; onVolver?: () => void }) {
  const [retenido, setRetenido] = useState<Contenido | null>(null);
  const [sinSalida, setSinSalida] = useState(false);
  const actual = children ? { children, contexto, nivel, paso } : !sinSalida && retenido?.contexto === contexto ? retenido : null;
  const saliendo = !children && actual !== null;
  const deslizar = useDeslizar({ hacia: "derecha", rapido: true, clave: `${contexto}:${paso}`, activo: !!onVolver && !saliendo,
    alSoltar: () => { setSinSalida(true); onVolver?.(); },
  });
  useLayoutEffect(() => {
    if (children) {
      if (sinSalida) setSinSalida(false);
      if (retenido?.children !== children || retenido.contexto !== contexto || retenido.nivel !== nivel || retenido.paso !== paso) setRetenido({ children, contexto, nivel, paso });
      return;
    }
    if (!retenido) return;
    if (sinSalida || retenido.contexto !== contexto || movimientoReducido()) { setRetenido(null); return; }
    const terminar = () => setRetenido(null);
    const tiempo = window.setTimeout(terminar, 200);
    const preferencia = window.matchMedia("(prefers-reduced-motion: reduce)");
    const alCambiar = () => { if (preferencia.matches) terminar(); };
    preferencia.addEventListener("change", alCambiar);
    return () => { clearTimeout(tiempo); preferencia.removeEventListener("change", alCambiar); };
  }, [children, contexto, nivel, paso, retenido, sinSalida]);
  if (!actual) return null;
  return <div className={`app-panel-motion${saliendo ? " is-exiting" : ""}`} style={{ zIndex: actual.nivel }} inert={saliendo} aria-hidden={saliendo || undefined}>
    <div className="app-panel-gesture" ref={onVolver ? deslizar : undefined}>{actual.children}</div>
  </div>;
}
