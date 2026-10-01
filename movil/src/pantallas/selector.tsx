// La hoja con tus páginas (tocar el nombre en la barra); reutiliza .lm-sheet
// y .lm-btn del prototipo. Aquí viven también el modo oscuro y «Salir».
import { useState } from "react";
import { useTranslations } from "use-intl";
import type { ProyectoEnLista } from "../api/proyectos";
import { aplicarTema, temaGuardado, type Tema } from "../tema";
import { useDeslizar } from "../deslizar";

export function Selector({ proyectos, actual, onElegir, onCerrar, onSalir }: {
  proyectos: ProyectoEnLista[]; actual: string | null; onElegir: (id: string) => void; onCerrar: () => void; onSalir: () => void;
}) {
  const t = useTranslations("movil.principal");
  const [tema, setTema] = useState<Tema>(temaGuardado);
  const deslizar = useDeslizar({ hacia: "abajo", alSoltar: onCerrar });
  const cambiarTema = () => {
    const otro: Tema = tema === "dark" ? "light" : "dark";
    aplicarTema(otro);
    setTema(otro);
  };
  return (
    <div ref={deslizar} className="lm-sheet lm-m lm-marca is-on" data-kind="listo" role="dialog" aria-label={t("tusPaginas")}>
      <button type="button" className="lm-grab" onClick={onCerrar} aria-label={t("encoger")} />
      <div className="lm-body">
        <p className="lm-msg">{t("tusPaginas")}</p>
        <div className="lm-actions" style={{ display: "grid", gap: 8 }}>
          {proyectos.map((p) => (
            <button key={p.id} type="button" className={`lm-btn ${p.id === actual ? "lm-pri" : "lm-sec"}`} onClick={() => onElegir(p.id)}>
              <span>{p.title}</span>
            </button>
          ))}
          <button type="button" className="lm-btn lm-sec" onClick={cambiarTema}>{tema === "dark" ? t("modoClaro") : t("modoOscuro")}</button>
          <button type="button" className="lm-btn lm-sec" onClick={onSalir}>{t("salir")}</button>
        </div>
      </div>
    </div>
  );
}
