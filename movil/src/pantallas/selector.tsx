// La hoja con tus páginas (tocar el nombre en la barra); reutiliza .lm-sheet
// y .lm-btn del prototipo. Aquí viven también el modo oscuro y «Salir».
import { useState, useRef, useEffect, type ReactNode } from "react";
import { useTranslations } from "use-intl";
import type { ProyectoEnLista } from "../api/proyectos";
import { aplicarTema, temaGuardado, type Tema } from "../tema";
import { devolverFoco } from "../foco";
import { useDeslizar } from "../deslizar";

export function Selector({ proyectos, actual, onElegir, onCerrar, onSalir, children }: {
  proyectos: ProyectoEnLista[]; actual: string | null; onElegir: (id: string) => void; onCerrar: () => void; onSalir: () => void; children?: ReactNode;
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
    <div ref={el => { dialogo.current = el; return deslizar?.(el); }} className="lm-sheet lm-m lm-marca is-on app-selector" data-kind="listo" role="dialog" aria-modal="true" aria-label={t("tusPaginas")} onKeyDown={e => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onCerrar(); }
      if (e.key === "Tab") {
        const bs = [...(dialogo.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
        if (e.shiftKey && document.activeElement === bs[0]) { e.preventDefault(); bs.at(-1)?.focus(); }
        if (!e.shiftKey && document.activeElement === bs.at(-1)) { e.preventDefault(); bs[0]?.focus(); }
      }
    }}>
      <button type="button" className="lm-grab" onClick={onCerrar} aria-label={t("encoger")} />
      <div className="lm-body">
        <p className="lm-msg">{t("tusPaginas")}</p>
        <div className="lm-actions" style={{ display: "grid", gap: 8 }}>
          {proyectos.map((p) => (
            <button key={p.id} type="button" className={`lm-btn ${p.id === actual ? "lm-pri" : "lm-sec"}`} aria-current={p.id === actual ? "page" : undefined} onClick={() => onElegir(p.id)}>
              <span>{p.title}</span>
            </button>
          ))}
          <button type="button" className="lm-btn lm-sec" onClick={cambiarTema}>{tema === "dark" ? t("modoClaro") : t("modoOscuro")}</button>
          {children}
          <button type="button" className="lm-btn lm-sec" onClick={onSalir}>{t("salir")}</button>
        </div>
      </div>
    </div>
  );
}
