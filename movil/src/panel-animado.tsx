import { useLayoutEffect, useState, type ReactNode } from "react";
import { movimientoReducido } from "./movimiento";
import "./panel-animado.css";

type Contenido = { contexto: string; children: ReactNode; nivel: number };
/** Conserva sólo la última pantalla durante su salida; nunca cruza proyectos. */
export function PanelAnimado({ children, contexto, nivel }: { children: ReactNode; contexto: string; nivel: number }) {
  const [retenido, setRetenido] = useState<Contenido | null>(null);
  const actual = children ? { children, contexto, nivel } : retenido?.contexto === contexto ? retenido : null;
  const saliendo = !children && actual !== null;
  useLayoutEffect(() => {
    if (children) {
      if (retenido?.children !== children || retenido.contexto !== contexto || retenido.nivel !== nivel) setRetenido({ children, contexto, nivel });
      return;
    }
    if (!retenido) return;
    if (retenido.contexto !== contexto || movimientoReducido()) { setRetenido(null); return; }
    const terminar = () => setRetenido(null);
    const tiempo = window.setTimeout(terminar, 200);
    const preferencia = window.matchMedia("(prefers-reduced-motion: reduce)");
    const alCambiar = () => { if (preferencia.matches) terminar(); };
    preferencia.addEventListener("change", alCambiar);
    return () => { clearTimeout(tiempo); preferencia.removeEventListener("change", alCambiar); };
  }, [children, contexto, nivel, retenido]);
  if (!actual) return null;
  return <div className={`app-panel-motion${saliendo ? " is-exiting" : ""}`} style={{ zIndex: actual.nivel }} inert={saliendo} aria-hidden={saliendo || undefined}>
    {actual.children}
  </div>;
}
