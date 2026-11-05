// A TOOL ON THE PHONE (spec local 2026-11-04-herramientas-hechas-por-len, §4.14, §4.4): full screen over everything, in
// a frame on the phone's OWN private `.app` host (`POST /api/movil/tools/[id]/open`) — isolated like the canvas, never
// in the app's origin — with the app as its bridge's parent: the web's own bridge host (`createToolBridgeHost`), fed
// by the app's client (its key, openlen.com's address) and the workspace's colours in the phone's mode. What has an
// effect outside the tool the app draws and the person presses (confirmaciones.tsx); `sendPrompt` only fills the
// project's composer, and only for a `project` tool; a delivered file opens in the phone's viewer. A 401 from any call
// closes it (the app is already going back to «Entrar»).
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "use-intl";

import type { ClienteDeOpenLen } from "@/components/llamada/cliente";
import type { ViewerFile } from "@/components/viewer/viewer";
import { ALLOW_REMOTO, SANDBOX_REMOTO } from "@/components/workspace-v2/sandbox-del-lienzo";
import { createToolBridgeHost, type ToolChange } from "@/lib/tools/bridge/host";
import type { ToolContext, ToolJobAsk } from "@/lib/tools/bridge/protocol";
import { WORKSPACE_TOOL_THEME } from "@/lib/tools/bridge/workspace-theme";
import type { ToolJobView } from "@/lib/tools/jobs/types";
import { toolPromptDraft } from "@/lib/tools/prompt-draft";
import type { InstalledToolView } from "@/lib/tools/types";

import { abrirHerramienta } from "../api/herramientas";
import { useAtras } from "../atras";
import { BASE } from "../config";
import { PhoneViewer } from "../viewer/phone-viewer";
import { HojaDeCambio, HojaDeFicheros, HojaDeTrabajo, LineaDeEntregados, LineaDeTrabajos } from "./confirmaciones";
import "./herramientas.css";

/** What the tool is waiting on — one at a time, whatever its kind: a new question answers the open one «no», so the
 *  sheet on screen is always the one Android's back closes. */
type Pregunta = (
  | { tipo: "cambio"; change: ToolChange; resolve: (ok: boolean) => void }
  | { tipo: "trabajo"; job: ToolJobAsk; resolve: (ok: boolean) => void }
  | { tipo: "ficheros"; accept?: string; multiple: boolean; resolve: (files: File[] | null) => void }) & {
  /** Which question: a new pick starts its sheet afresh. */
  n?: number;
};
const responderNo = (p: Pregunta) => (p.tipo === "ficheros" ? p.resolve(null) : p.resolve(false));

/** The workspace's colours, light or dark as the phone's own theme (`data-theme` on <html>, tema.ts). */
function temaDeLaHerramienta(): ToolContext["theme"] {
  const mode = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  const font = getComputedStyle(document.body).fontFamily;
  return { mode, tokens: { ...WORKSPACE_TOOL_THEME[mode], ...(font ? { "--font-sans": font } : {}) } };
}

export function PantallaHerramienta({
  cliente,
  tool,
  persona,
  proyecto,
  idioma,
  onCerrar,
  onPrompt,
}: {
  cliente: ClienteDeOpenLen;
  tool: InstalledToolView;
  persona: { name: string };
  /** The project it is opened in (a `project` tool); null for a `rail` tool. */
  proyecto: { id: string; title: string } | null;
  idioma: string;
  onCerrar: () => void;
  /** Fills the project's composer with the quoted draft; null where there is no chat (a `rail` tool). */
  onPrompt: ((draft: string) => void) | null;
}) {
  const t = useTranslations("movil.herramientas");
  const [marco, setMarco] = useState<{ url: string; origin: string } | { error: string } | null>(null);
  const [intento, setIntento] = useState(0);
  const iframe = useRef<HTMLIFrameElement>(null);
  const [pregunta, setPregunta] = useState<Pregunta | null>(null);
  const [iniciados, setIniciados] = useState<ToolJobView[]>([]);
  // What the tool delivered: it waits in the bottom line for the person's tap — the tool never opens the viewer itself.
  const [entregados, setEntregados] = useState<ViewerFile[]>([]);
  const [visor, setVisor] = useState<ViewerFile | null>(null);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const latest = useRef({ onCerrar, onPrompt, proyecto, persona, idioma });
  latest.current = { onCerrar, onPrompt, proyecto, persona, idioma };
  useAtras(true, onCerrar);

  useEffect(() => {
    let alive = true;
    setMarco(null);
    void abrirHerramienta(cliente, tool.id).then((m) => {
      if (!alive) return;
      if ("error" in m && m.error === "unauthorized") latest.current.onCerrar();
      else setMarco(m);
    });
    return () => {
      alive = false;
    };
  }, [cliente, tool.id, intento]);

  const serie = useRef(0);
  const preguntar = (p: Pregunta) =>
    setPregunta((prev) => {
      if (prev) responderNo(prev);
      return { ...p, n: ++serie.current };
    });
  const origin = marco && "url" in marco ? marco.origin : null;
  const conChat = onPrompt !== null;
  const host = useMemo(() => {
    if (!origin) return null;
    const pedir = async (url: RequestInfo | URL, init?: RequestInit) => {
      const res = await cliente.pedir(String(url), init);
      if (res.status === 401) latest.current.onCerrar();
      return res;
    };
    return createToolBridgeHost({
      frame: () => iframe.current?.contentWindow ?? null,
      frameOrigin: origin,
      caller: { installationId: tool.id },
      context: () => ({
        person: { name: latest.current.persona.name, locale: latest.current.idioma },
        project: latest.current.proyecto,
        tool: { id: tool.id, version: tool.releaseSha },
        environment: "installed",
      }),
      theme: temaDeLaHerramienta,
      onPrompt: conChat
        ? (text) => {
            latest.current.onPrompt?.(toolPromptDraft(text, tool.title));
            latest.current.onCerrar();
          }
        : null,
      // A newer question answers the one before it «no», whatever its kind: the frame only ever waits on the latest.
      onConfirmChange: (change) => new Promise<boolean>((resolve) => preguntar({ tipo: "cambio", change, resolve })),
      onConfirmJob: (job) => new Promise<boolean>((resolve) => preguntar({ tipo: "trabajo", job, resolve })),
      onPickFiles: (pick) => new Promise<File[] | null>((resolve) => preguntar({ tipo: "ficheros", ...pick, resolve })),
      onJobStarted: (job) => setIniciados((js) => [...js, job]),
      onDelivered: (f) => setEntregados((fs) => [...fs, { name: f.name, url: f.url, size: f.size }]),
      fetchImpl: pedir as typeof fetch,
      linkOrigin: BASE,
      timeZone,
      locale: idioma,
    });
  }, [origin, cliente, tool.id, tool.releaseSha, tool.title, conChat, timeZone, idioma]);

  useEffect(() => {
    if (!host) return;
    const onMessage = (e: MessageEvent) => void host.onMessage(e);
    window.addEventListener("message", onMessage);
    // The phone's theme changed (tema.ts sets `data-theme`): the tool hears its context again.
    const observer = new MutationObserver(() => host.notifyContext());
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      window.removeEventListener("message", onMessage);
      observer.disconnect();
    };
  }, [host]);

  // Closed with a question open: the tool hears «no», never waits on a screen that is gone.
  const abierta = useRef(pregunta);
  abierta.current = pregunta;
  useEffect(
    () => () => {
      if (abierta.current) responderNo(abierta.current);
    },
    [],
  );

  const responder = (si: boolean, files: File[] | null = null) => {
    if (pregunta?.tipo === "ficheros") pregunta.resolve(si ? files : null);
    else pregunta?.resolve(si);
    setPregunta(null);
  };

  return createPortal(
    <section className="herr-pantalla" role="dialog" aria-modal="true" aria-label={tool.title} data-herr-pantalla="">
      <header className="herr-barra">
        <button type="button" aria-label={t("volver")} onClick={onCerrar}>
          ‹
        </button>
        <b>{tool.title}</b>
      </header>
      <div className="herr-cuerpo">
        {marco === null ? (
          <p className="herr-estado" role="status">
            {t("cargando")}
          </p>
        ) : "error" in marco ? (
          // Gone (switched off or removed on the web) and the Free plan won't change by trying again; anything else may.
          <div className="herr-estado" role="alert">
            {marco.error === "not_found" ? (
              <p>{t("yaNoEsta")}</p>
            ) : marco.error === "plan_required" ? (
              <p>{t("tools.planRequired")}</p>
            ) : (
              <>
                <p>{t("noAbre")}</p>
                <button type="button" data-herr-reintentar="" onClick={() => setIntento((n) => n + 1)}>
                  {t("reintentar")}
                </button>
              </>
            )}
          </div>
        ) : (
          <iframe ref={iframe} data-herr-marco="" src={marco.url} title={tool.title} sandbox={SANDBOX_REMOTO} allow={ALLOW_REMOTO} />
        )}
        {origin && <LineaDeTrabajos cliente={cliente} installationId={tool.id} idioma={idioma} timeZone={timeZone} iniciados={iniciados} onVer={setVisor} />}
        {entregados.length > 0 && <LineaDeEntregados ficheros={entregados} onVer={setVisor} onCerrar={() => setEntregados([])} />}
      </div>
      {pregunta?.tipo === "cambio" && (
        <HojaDeCambio
          herramienta={tool.title}
          proyecto={pregunta.change.projectTitle ?? (proyecto?.id === pregunta.change.projectId ? proyecto.title : pregunta.change.projectId)}
          cambio={pregunta.change}
          onAplicar={() => responder(true)}
          onCancelar={() => responder(false)}
        />
      )}
      {pregunta?.tipo === "trabajo" && <HojaDeTrabajo herramienta={tool.title} trabajo={pregunta.job} idioma={idioma} onEjecutar={() => responder(true)} onCancelar={() => responder(false)} />}
      {pregunta?.tipo === "ficheros" && (
        <HojaDeFicheros
          key={pregunta.n}
          herramienta={tool.title}
          accept={pregunta.accept}
          multiple={pregunta.multiple}
          onElegidos={(files) => responder(true, files)}
          onCancelar={() => responder(false)}
        />
      )}
      {visor && <PhoneViewer cliente={cliente} file={visor} onClose={() => setVisor(null)} />}
    </section>,
    document.body,
  );
}
