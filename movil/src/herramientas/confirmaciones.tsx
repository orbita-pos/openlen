// WHAT THE PHONE APP DRAWS AROUND A TOOL (spec local 2026-11-04-herramientas-hechas-por-len, §4.4, §4.6, §4.14): the app
// can't see the clicks inside the tool's frame, and the tool's code was written by Len, so anything with an effect
// outside the tool is drawn here, by OpenLen, and pressed by the person — a production write of another project
// (option B), a job that spends credits, the files a job may receive — and the line of each job this screen started,
// with «Detener». The web's own words (`movil.herramientas.tools`, read from wsChrome). Each sheet takes its own entry
// in the back history: Android's back closes the sheet and answers the tool «no» before it closes the tool.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "use-intl";

import type { ClienteDeOpenLen } from "@/components/llamada/cliente";
import type { ViewerFile } from "@/components/viewer/viewer";
import { changeValueText } from "@/lib/backend/change-value-text";
import type { ToolChange } from "@/lib/tools/bridge/host";
import type { ToolJobAsk } from "@/lib/tools/bridge/protocol";
import { TERMINAL_JOB_STATUSES, UPLOADS_PER_PICK, type ToolJobView } from "@/lib/tools/jobs/types";

import { useAtras } from "../atras";

/** Credits from centicredits, as the web's confirmation shows them: at most two decimals. */
export function creditos(centis: number, idioma: string): string {
  return new Intl.NumberFormat(idioma, { maximumFractionDigits: 2 }).format(centis / 100);
}

function Hoja({ marca, titulo, subtitulo, onCancelar, children }: { marca: string; titulo: string; subtitulo: string; onCancelar: () => void; children: ReactNode }) {
  useAtras(true, onCancelar);
  const id = `herr-hoja-${marca}`;
  return (
    <div className="herr-velo" onClick={(e) => e.target === e.currentTarget && onCancelar()}>
      <div className="herr-hoja" role="dialog" aria-modal="true" aria-labelledby={id} {...{ [`data-herr-${marca}`]: "" }}>
        <h2 id={id}>{titulo}</h2>
        <p className="herr-sub">{subtitulo}</p>
        {children}
      </div>
    </div>
  );
}

/** The row, by its key: `id = 12`. */
const claveDe = (key: Readonly<Record<string, unknown>>) =>
  Object.entries(key)
    .map(([col, value]) => `${col} = ${String(value)}`)
    .join(", ");

export function HojaDeCambio({ herramienta, proyecto, cambio, onAplicar, onCancelar }: { herramienta: string; proyecto: string; cambio: ToolChange; onAplicar: () => void; onCancelar: () => void }) {
  const t = useTranslations("movil.herramientas.tools");
  return (
    <Hoja marca="cambio" titulo={t("change.title", { tool: herramienta, table: cambio.table, project: proyecto })} subtitulo={t("change.subtitle")} onCancelar={onCancelar}>
      <p className="herr-clave">{claveDe(cambio.key)}</p>
      <ul className="herr-columnas">
        {Object.entries(cambio.set).map(([col, value]) => (
          <li key={col}>
            <code>{col}</code>
            <s>{changeValueText(cambio.before[col])}</s>
            <span aria-hidden="true">→</span>
            <b>{changeValueText(value)}</b>
          </li>
        ))}
      </ul>
      <div className="herr-acciones">
        <button type="button" data-herr-cancelar="" onClick={onCancelar}>
          {t("change.cancel")}
        </button>
        <button type="button" className="is-pri" data-herr-aplicar="" onClick={onAplicar}>
          {t("change.apply")}
        </button>
      </div>
    </Hoja>
  );
}

export function HojaDeTrabajo({ herramienta, trabajo, idioma, onEjecutar, onCancelar }: { herramienta: string; trabajo: ToolJobAsk; idioma: string; onEjecutar: () => void; onCancelar: () => void }) {
  const t = useTranslations("movil.herramientas.tools");
  return (
    <Hoja marca="trabajo" titulo={t("jobs.confirm.title", { tool: herramienta, job: trabajo.title })} subtitulo={t("jobs.confirm.subtitle")} onCancelar={onCancelar}>
      <ul className="herr-cifras">
        <li>{t("jobs.confirm.minutes", { minutes: trabajo.maxMinutes })}</li>
        <li>{t("jobs.confirm.credits", { credits: creditos(trabajo.mostCentis, idioma) })}</li>
      </ul>
      {trabajo.files.length > 0 && (
        <>
          <p className="herr-sub">{t("jobs.confirm.files")}</p>
          <ul className="herr-columnas">
            {trabajo.files.map((f) => (
              <li key={f.id}>
                <code>{f.name}</code>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="herr-acciones">
        <button type="button" data-herr-cancelar="" onClick={onCancelar}>
          {t("jobs.confirm.cancel")}
        </button>
        <button type="button" className="is-pri" data-herr-ejecutar="" onClick={onEjecutar}>
          {t("jobs.confirm.run")}
        </button>
      </div>
    </Hoja>
  );
}

/** OpenLen's own file picker: the tool never reads the phone's files; it gets only the ones the person chose here. */
export function HojaDeFicheros({ herramienta, accept, multiple, onElegidos, onCancelar }: { herramienta: string; accept?: string; multiple: boolean; onElegidos: (files: File[]) => void; onCancelar: () => void }) {
  const t = useTranslations("movil.herramientas.tools");
  const [elegidos, setElegidos] = useState<File[]>([]);
  const tope = multiple ? UPLOADS_PER_PICK : 1;
  return (
    <Hoja marca="ficheros" titulo={t("files.pick.title", { tool: herramienta })} subtitulo={t("files.pick.subtitle")} onCancelar={onCancelar}>
      <label className="herr-elegir">
        {t("files.pick.choose")}
        <input type="file" accept={accept} multiple={multiple} onChange={(e) => setElegidos(Array.from(e.currentTarget.files ?? []).slice(0, tope))} />
      </label>
      {elegidos.length > 0 && (
        <ul className="herr-columnas">
          {elegidos.map((f, i) => (
            <li key={`${f.name}-${i}`}>
              <code>{f.name}</code>
            </li>
          ))}
        </ul>
      )}
      <div className="herr-acciones">
        <button type="button" data-herr-cancelar="" onClick={onCancelar}>
          {t("files.pick.cancel")}
        </button>
        <button type="button" className="is-pri" data-herr-usar="" disabled={elegidos.length === 0} onClick={() => onElegidos(elegidos)}>
          {t("files.pick.use")}
        </button>
      </div>
    </Hoja>
  );
}

const SEGUIR_CADA_MS = 2_000;
const vivo = (j: ToolJobView) => !TERMINAL_JOB_STATUSES.includes(j.status);
/** m:ss, or h:mm:ss past an hour — the web's line. */
const transcurrido = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const two = (n: number) => String(n).padStart(2, "0");
  return s >= 3600 ? `${Math.floor(s / 3600)}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}` : `${Math.floor(s / 60)}:${two(s % 60)}`;
};

/** The line of each job of this tool: the ones this screen started and the ones already running when it opened, followed
 *  every 2 s with «Detener»; once settled, how it ended and its files, opened in the phone's viewer. */
export function LineaDeTrabajos({
  cliente,
  installationId,
  idioma,
  timeZone,
  iniciados,
  onVer,
}: {
  cliente: ClienteDeOpenLen;
  installationId: string;
  idioma: string;
  timeZone: string;
  iniciados: readonly ToolJobView[];
  onVer: (file: ViewerFile) => void;
}) {
  const t = useTranslations("movil.herramientas.tools");
  const [vistas, setVistas] = useState<Record<string, ToolJobView>>({});
  const [encontrados, setEncontrados] = useState<ToolJobView[]>([]);
  const [cerrados, setCerrados] = useState<ReadonlySet<string>>(new Set());
  const [ahora, setAhora] = useState(() => Date.now());
  const query = new URLSearchParams({ installationId, locale: idioma, timeZone }).toString();
  const leer = useRef(async (ruta: string, init?: RequestInit) => {
    const res = await cliente.pedir(ruta, init).catch(() => null);
    return res?.ok ? ((await res.json().catch(() => ({}))) as Record<string, unknown>) : null;
  });

  useEffect(() => {
    let alive = true;
    void leer.current(`/api/tools/jobs?${query}`).then((r) => {
      if (alive && Array.isArray(r?.jobs)) setEncontrados((r.jobs as ToolJobView[]).filter(vivo));
    });
    return () => {
      alive = false;
    };
  }, [query]);

  const todos = [...iniciados, ...encontrados.filter((f) => !iniciados.some((j) => j.id === f.id))].map((j) => vistas[j.id] ?? j).filter((j) => !cerrados.has(j.id));
  const siguiendo = todos.filter(vivo).map((j) => j.id).join(",");

  useEffect(() => {
    if (!siguiendo) return;
    const tick = setInterval(() => {
      setAhora(Date.now());
      for (const id of siguiendo.split(",")) {
        void leer.current(`/api/tools/jobs/${encodeURIComponent(id)}?${query}`).then((r) => {
          if (r?.job && typeof r.job === "object") setVistas((v) => ({ ...v, [id]: r.job as ToolJobView }));
        });
      }
    }, SEGUIR_CADA_MS);
    return () => clearInterval(tick);
  }, [siguiendo, query]);

  if (todos.length === 0) return null;
  const detener = async (id: string) => {
    const r = await leer.current(`/api/tools/jobs/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ installationId, locale: idioma, timeZone }),
    });
    if (r?.job && typeof r.job === "object") setVistas((v) => ({ ...v, [id]: r.job as ToolJobView }));
  };
  return (
    <div className="herr-linea" data-herr-linea="">
      {todos.map((j) => (
        <div key={j.id} className="herr-trabajo">
          <b>{j.title}</b>
          {vivo(j) ? (
            <>
              <small>
                {transcurrido(ahora - Date.parse(j.startedAt))}
                {j.progress ? ` · ${j.progress}` : ""}
              </small>
              <button type="button" data-herr-detener="" disabled={j.status === "stopping"} onClick={() => void detener(j.id)}>
                {j.status === "stopping" ? t("jobs.running.stopping") : t("jobs.running.stop")}
              </button>
            </>
          ) : (
            <>
              <small>{t(`jobs.running.${j.status}`)}</small>
              {j.delivered.map((f) => (
                <button key={f.url} type="button" onClick={() => onVer({ name: f.name, url: f.url, size: f.size })}>
                  {f.name}
                </button>
              ))}
              <button type="button" onClick={() => setCerrados((c) => new Set([...c, j.id]))}>
                {t("jobs.running.dismiss")}
              </button>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
