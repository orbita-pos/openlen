// THE PHONE'S «HERRAMIENTAS» (spec local 2026-11-04-herramientas-hechas-por-len, §4.14): the person's `rail` tools,
// beside «Entregado» and «Tareas». The phone uses tools and never manages them — switching off, removing or restoring
// stay on the web —, so the list shows only the ones that can open, read again every time the tab opens. On the Free
// plan it says what the web says (`plan_required`, §4.13). It wears Gestión's look, like «Entregado».
import { useEffect, useState } from "react";
import { useTranslations } from "use-intl";

import type { ClienteDeOpenLen } from "@/components/llamada/cliente";
import type { InstalledToolView } from "@/lib/tools/types";

import { useAtras } from "../atras";
import { iconoDeHerramienta, listarHerramientas, sePuedeAbrir, type HerramientasDeLaPersona } from "../api/herramientas";
import "../gestion/gestion.css";
import "../overview/overview.css";
import "./herramientas.css";

/** A tool's icon, fetched with the key; nothing while it loads or when it has none. */
export function IconoDeHerramienta({ cliente, tool }: { cliente: ClienteDeOpenLen; tool: InstalledToolView }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let made: string | null = null;
    void iconoDeHerramienta(cliente, tool).then((url) => {
      made = url;
      if (alive) setSrc(url);
      else if (url) URL.revokeObjectURL(url);
    });
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [cliente, tool]);
  return <span className="herr-icono" aria-hidden="true">{src ? <img src={src} alt="" /> : null}</span>;
}

export function ToolsTab({
  cliente,
  idioma,
  onCerrar,
  onAbrir,
}: {
  cliente: ClienteDeOpenLen;
  idioma: string;
  onCerrar: () => void;
  onAbrir: (tool: InstalledToolView) => void;
}) {
  const t = useTranslations("movil.herramientas");
  const [list, setList] = useState<HerramientasDeLaPersona | "off" | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useAtras(true, onCerrar);
  useEffect(() => {
    let alive = true;
    setFailed(false);
    listarHerramientas(cliente, idioma).then((x) => alive && setList(x), () => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [cliente, idioma, attempt]);

  const rail = list && list !== "off" ? list.tools.filter((x) => x.placement === "rail" && sePuedeAbrir(x)) : [];
  return (
    <section className="app-gestion app-resumen lm-m lm-marca" role="dialog" aria-modal="true" aria-labelledby="herramientas-titulo">
      <header>
        <div>
          <p className="gestion-ceja">Len</p>
          <h1 id="herramientas-titulo">{t("titulo")}</h1>
        </div>
        <button className="gestion-cerrar" onClick={onCerrar} aria-label={t("cerrar")}>
          ×
        </button>
      </header>
      <div className="gestion-cuerpo">
        {failed ? (
          <div className="gestion-error" role="alert">
            <strong>{t("error")}</strong>
            <button onClick={() => setAttempt((n) => n + 1)}>{t("reintentar")}</button>
          </div>
        ) : list === null ? (
          <p role="status">{t("cargando")}</p>
        ) : list === "off" ? (
          <p>{t("vacio")}</p>
        ) : !list.paid ? (
          <p>{t("tools.planRequired")}</p>
        ) : rail.length === 0 ? (
          <p>{t("vacio")}</p>
        ) : (
          <ul className="resumen-lista">
            {rail.map((tool) => (
              <li key={tool.id}>
                <button type="button" className="resumen-fila herr-fila" data-tool-row="" onClick={() => onAbrir(tool)}>
                  <IconoDeHerramienta cliente={cliente} tool={tool} />
                  <span>
                    <b>{tool.title}</b>
                    <small>{tool.description}</small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
