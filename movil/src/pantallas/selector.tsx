// La hoja con tus páginas (tocar el nombre en la barra); reutiliza .lm-sheet
// y .lm-btn del prototipo. Aquí viven también el modo oscuro y «Salir».
import { useState, useRef, useEffect, type ReactNode } from "react";
import { useTranslations } from "use-intl";
import type { ProyectoEnLista } from "../api/proyectos";
import { aplicarTema, temaGuardado, type Tema } from "../tema";
import { devolverFoco } from "../foco";
import { useDeslizar } from "../deslizar";
import { Icono } from "../iconos";

export function Selector({ proyectos, actual, onElegir, onCerrar, onSalir, atajos, children, descripcion }: {
  proyectos: ProyectoEnLista[]; actual: string | null; onElegir: (id: string) => void; onCerrar: () => void; onSalir: () => void; children?: ReactNode;
  descripcion?: (p: ProyectoEnLista) => string | undefined;
  /** Access to tools and the overview across projects. */
  atajos?: ReactNode;
}) {
  const t = useTranslations("movil.principal");
  const [tema, setTema] = useState<Tema>(temaGuardado);
  const deslizar = useDeslizar({ hacia: "abajo", alSoltar: onCerrar, desde: ".lm-grab" });
  const dialogo = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const antes = document.activeElement as HTMLElement | null;
    dialogo.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
    return () => devolverFoco(antes);
  }, []);
  const cambiarTema = () => {
    const otro: Tema = tema === "dark" ? "light" : "dark";
    aplicarTema(otro);
    setTema(otro);
  };
  return (
    <div ref={el => { dialogo.current = el; return deslizar?.(el); }} className="lm-sheet is-on app-selector" data-kind="listo" role="dialog" aria-modal="true" aria-labelledby="selector-proyectos-titulo" onKeyDown={e => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onCerrar(); }
      if (e.key === "Tab") {
        const bs = [...(dialogo.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
        if (e.shiftKey && document.activeElement === bs[0]) { e.preventDefault(); bs.at(-1)?.focus(); }
        if (!e.shiftKey && document.activeElement === bs.at(-1)) { e.preventDefault(); bs[0]?.focus(); }
      }
    }}>
      <button type="button" className="lm-grab" onClick={onCerrar} aria-label={t("encoger")} />
      <h2 id="selector-proyectos-titulo" className="app-selector-titulo">{t("tusProyectos")}</h2>
      <div className="lm-body">
        <ul className="app-selector-lista" role="list">
          {proyectos.map((p) => {
            const activo = p.id === actual;
            const detalle = descripcion?.(p);
            return (
              <li key={p.id} data-proyecto={p.id}>
                <button type="button" className="app-selector-fila" aria-current={activo ? "page" : undefined} onClick={() => onElegir(p.id)}>
                  <span className="app-selector-icono"><Icono nombre="proyecto" /></span>
                  <span className="app-selector-texto">
                    <span>{p.title}</span>
                    {detalle && <small>{detalle}</small>}
                  </span>
                  <span className="app-selector-indicador"><Icono nombre={activo ? "check" : "back"} /></span>
                </button>
              </li>
            );
          })}
        </ul>
        {atajos && <div className="app-selector-atajos">{atajos}</div>}
        <div className="app-selector-cuenta">
          <button type="button" className="lm-btn lm-sec" onClick={cambiarTema}>{tema === "dark" ? t("modoClaro") : t("modoOscuro")}</button>
          {children}
          <button type="button" className="lm-btn lm-sec" onClick={onSalir}>{t("salir")}</button>
        </div>
      </div>
    </div>
  );
}
