import { useTranslations } from "use-intl";
import type { Avisos } from "./use-avisos";
import "./avisos.css";

export function ControlAvisos({ avisos }: { avisos: Avisos }) {
  const t = useTranslations("movil.avisos");
  const ocupado = avisos.estado === "cargando" || avisos.estado === "activando";
  return <section className="len-avisos" aria-label={t("titulo")}>
    <div className="len-avisos-fila"><strong>{t("titulo")}</strong>
      {avisos.estado !== "noDisponible" && <button type="button" disabled={ocupado} aria-pressed={avisos.estado === "activos"} onClick={() => void (avisos.estado === "activos" ? avisos.desactivar() : avisos.activar())}>{t(ocupado ? "espera" : avisos.estado === "activos" ? "desactivar" : "activar")}</button>}
    </div>
    <p role="status">{t(avisos.estado)}</p>
    {avisos.recibido && <div className="len-avisos-recibido"><strong>{avisos.recibido.titulo}</strong><p>{avisos.recibido.cuerpo}</p><button type="button" onClick={() => void avisos.abrirRecibido()}>{t("abrir")}</button></div>}
  </section>;
}
