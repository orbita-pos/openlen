// AN AGENT'S TOOLS ON THE PHONE (spec local 2026-11-22-herramienta-dentro-del-agente, §2, §4):
// header button in the agent's chat (only when it has tools), full-screen frame on the phone's own private label
// (`POST /api/movil/agent-tools/[id]/open`), restricted bridge (`AGENT_TOOL_BRIDGE_METHODS`), live SSE follow stream
// read via `cliente.pedir` + `crearLectorSse` (reconnecting for a fresh baseline on drop; stopping and removing only on
// `gone`), `sendPrompt` filling the chat composer without sending, and person-only remove with confirmation.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "use-intl";

import type { ClienteDeOpenLen } from "@/components/llamada/cliente";
import { ALLOW_REMOTO, SANDBOX_REMOTO } from "@/components/workspace-v2/sandbox-del-lienzo";
import { AGENT_TOOL_BRIDGE_METHODS, createToolBridgeHost } from "@/lib/tools/bridge/host";
import type { ToolContext } from "@/lib/tools/bridge/protocol";
import { WORKSPACE_TOOL_THEME } from "@/lib/tools/bridge/workspace-theme";

import { deleteAgentTool, followAgentTool, openAgentTool, type AgentToolItem } from "../api/agent-tools";
import { useAtras } from "../atras";
import { BASE } from "../config";
import { devolverFoco } from "../foco";
import { Icono } from "../iconos";
import "../herramientas/herramientas.css";
import "./agent-tools.css";

const RECONNECT_INITIAL_MS = 1_000;
const RECONNECT_MAX_MS = 15_000;

function temaDeLaHerramienta(): ToolContext["theme"] {
  const mode = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  const font = getComputedStyle(document.body).fontFamily;
  return { mode, tokens: { ...WORKSPACE_TOOL_THEME[mode], ...(font ? { "--font-sans": font } : {}) } };
}

export function PantallaHerramientaDeAgente({
  cliente,
  tool,
  idioma,
  onCerrar,
  onPrompt,
  onRemoved,
}: {
  cliente: ClienteDeOpenLen;
  tool: AgentToolItem;
  idioma: string;
  onCerrar: () => void;
  onPrompt: (text: string) => void;
  onRemoved: (toolId: string) => void;
}) {
  const t = useTranslations("movil.agentTools");
  const [marco, setMarco] = useState<{ url: string; origin: string } | { error: string } | null>(null);
  const [intento, setIntento] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState(false);
  const iframe = useRef<HTMLIFrameElement>(null);
  const backBtn = useRef<HTMLButtonElement>(null);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const latest = useRef({ tool, idioma, onCerrar, onPrompt, onRemoved, marco, confirmOpen, removing });
  latest.current = { tool, idioma, onCerrar, onPrompt, onRemoved, marco, confirmOpen, removing };

  const closeScreen = useCallback(() => {
    const m = latest.current.marco;
    if (m && "error" in m && m.error === "not_found") latest.current.onRemoved(latest.current.tool.id);
    latest.current.onCerrar();
  }, []);

  useAtras(true, closeScreen);
  useAtras(confirmOpen, () => {
    if (!latest.current.removing) setConfirmOpen(false);
  });

  // Move focus into the full-screen dialog on mount and restore it on close; capture Escape at window level so it
  // dismisses only the topmost layer (confirm sheet -> tool screen) and never leaks to the chat underneath.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    backBtn.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.isComposing) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (latest.current.confirmOpen) {
        if (!latest.current.removing) setConfirmOpen(false);
      } else {
        closeScreen();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      devolverFoco(before);
    };
  }, [closeScreen]);

  useEffect(() => {
    let alive = true;
    setMarco(null);
    void openAgentTool(cliente, tool.id).then((m) => {
      if (!alive) return;
      if ("error" in m && m.error === "unauthorized") latest.current.onCerrar();
      else setMarco(m);
    });
    return () => {
      alive = false;
    };
  }, [cliente, tool.id, intento]);

  // Follow stream lifecycle — kept in refs so `onDataSubscribe` stays strictly synchronous (Ruling T5 / M5-1).
  const followRef = useRef<{
    ctrl: AbortController | null;
    timer: ReturnType<typeof setTimeout> | null;
    gen: number;
    delayMs: number;
    stopped: boolean;
    gone: boolean;
  }>({ ctrl: null, timer: null, gen: 0, delayMs: RECONNECT_INITIAL_MS, stopped: false, gone: false });

  const stopFollow = useCallback((permanent: boolean, gone = false) => {
    const f = followRef.current;
    f.gen += 1;
    if (permanent) f.stopped = true;
    if (gone) f.gone = true;
    if (f.timer !== null) {
      clearTimeout(f.timer);
      f.timer = null;
    }
    if (f.ctrl) {
      f.ctrl.abort();
      f.ctrl = null;
    }
  }, []);

  const hostRef = useRef<ReturnType<typeof createToolBridgeHost> | null>(null);

  const openFollow = useCallback(() => {
    const f = followRef.current;
    if (f.stopped || f.gone) return;
    if (f.timer !== null) {
      clearTimeout(f.timer);
      f.timer = null;
    }
    if (f.ctrl) {
      f.ctrl.abort();
      f.ctrl = null;
    }
    const gen = ++f.gen;
    const ctrl = new AbortController();
    f.ctrl = ctrl;
    const toolId = latest.current.tool.id;

    void followAgentTool(cliente, toolId, {
      signal: ctrl.signal,
      onData: (params) => {
        if (f.gen !== gen || f.stopped) return;
        if (params.kind === "baseline") f.delayMs = RECONNECT_INITIAL_MS;
        hostRef.current?.notifyData(params);
      },
      onGone: () => {
        if (f.gen !== gen || f.stopped) return;
        stopFollow(true, true);
        latest.current.onRemoved(toolId);
        latest.current.onCerrar();
      },
      onUnauthorized: () => {
        if (f.gen !== gen || f.stopped) return;
        stopFollow(true);
        latest.current.onCerrar();
      },
    })
      .then((outcome) => {
        if (f.gen !== gen || f.stopped || f.gone) return;
        if (outcome === "ended") {
          const wait = f.delayMs;
          f.delayMs = Math.min(RECONNECT_MAX_MS, f.delayMs * 2);
          f.timer = setTimeout(() => {
            f.timer = null;
            openFollow();
          }, wait);
        }
      })
      .catch(() => {
        // Never allow unhandled rejections out of the follow loop.
      });
  }, [cliente, stopFollow]);

  // Synchronous onDataSubscribe: restarts the follow stream on every `data.subscribe` (initial load, reload, navigation),
  // unless the tool is already permanently `gone`.
  const onDataSubscribe = useCallback(() => {
    if (followRef.current.gone) return;
    followRef.current.stopped = false;
    followRef.current.delayMs = RECONNECT_INITIAL_MS;
    openFollow();
  }, [openFollow]);

  const origin = marco && "url" in marco ? marco.origin : null;
  const url = marco && "url" in marco ? marco.url : "";
  const host = useMemo(() => {
    if (!origin) return null;
    const pedir = async (reqUrl: RequestInfo | URL, init?: RequestInit) => {
      const res = await cliente.pedir(String(reqUrl), init);
      if (res.status === 401) latest.current.onCerrar();
      return res;
    };
    return createToolBridgeHost({
      frame: () => iframe.current?.contentWindow ?? null,
      frameOrigin: origin,
      caller: { agentToolId: tool.id },
      methods: AGENT_TOOL_BRIDGE_METHODS,
      context: () => ({
        person: { name: "", locale: latest.current.idioma },
        project: null,
        tool: { id: latest.current.tool.id, version: url },
        environment: "installed",
      }),
      theme: temaDeLaHerramienta,
      onPrompt: (text) => {
        latest.current.onPrompt(text);
        latest.current.onCerrar();
      },
      onConfirmChange: async () => false,
      onConfirmJob: async () => false,
      onPickFiles: async () => null,
      onDataSubscribe,
      fetchImpl: pedir as typeof fetch,
      linkOrigin: BASE,
      timeZone,
      locale: latest.current.idioma,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin, url, cliente, tool.id, timeZone, onDataSubscribe]);
  hostRef.current = host;

  useEffect(() => {
    if (!host) return;
    followRef.current.stopped = false;
    const onMessage = (e: MessageEvent) => void host.onMessage(e);
    window.addEventListener("message", onMessage);
    const observer = new MutationObserver(() => host.notifyContext());
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      window.removeEventListener("message", onMessage);
      observer.disconnect();
      stopFollow(true);
    };
  }, [host, stopFollow]);

  const confirmRemove = async () => {
    if (removing) return;
    setRemoving(true);
    setRemoveError(false);
    try {
      const ok = await deleteAgentTool(cliente, tool.id);
      if (!ok) {
        setRemoveError(true);
        return;
      }
      stopFollow(true, true);
      setConfirmOpen(false);
      latest.current.onRemoved(tool.id);
      latest.current.onCerrar();
    } finally {
      setRemoving(false);
    }
  };

  return createPortal(
    <section
      className="herr-pantalla lm-m"
      role="dialog"
      aria-modal="true"
      aria-label={tool.title}
      data-agent-tool-screen={tool.id}
    >
      <header className="herr-barra">
        <button ref={backBtn} type="button" aria-label={t("volver")} onClick={closeScreen}>
          ‹
        </button>
        <b>{tool.title}</b>
        <button
          type="button"
          className="herr-quitar"
          data-agent-tool-remove=""
          onClick={() => {
            setRemoveError(false);
            setConfirmOpen(true);
          }}
        >
          {t("quitar")}
        </button>
      </header>
      <div className="herr-cuerpo">
        {marco === null ? (
          <p className="herr-estado" role="status">
            {t("cargando")}
          </p>
        ) : "error" in marco ? (
          <div className="herr-estado" role="alert">
            {marco.error === "not_found" ? (
              <p>{t("yaNoEsta")}</p>
            ) : (
              <>
                <p>{t("noAbre")}</p>
                <button type="button" data-agent-tool-retry="" onClick={() => setIntento((n) => n + 1)}>
                  {t("reintentar")}
                </button>
              </>
            )}
          </div>
        ) : (
          <iframe
            ref={iframe}
            data-agent-tool-frame={tool.id}
            src={marco.url}
            title={tool.title}
            sandbox={SANDBOX_REMOTO}
            allow={ALLOW_REMOTO}
          />
        )}
      </div>
      {confirmOpen && (
        <div
          className="herr-velo"
          role="dialog"
          aria-modal="true"
          aria-label={t("quitarTitulo", { title: tool.title })}
          data-agent-tool-confirm-sheet=""
          onClick={(e) => {
            if (e.target === e.currentTarget && !removing) setConfirmOpen(false);
          }}
        >
          <div className="herr-hoja">
            <h2>{t("quitarTitulo", { title: tool.title })}</h2>
            <p className="herr-sub">{t("quitarCuerpo", { title: tool.title })}</p>
            {removeError && (
              <p className="herr-error" role="alert">
                {t("quitarFallo")}
              </p>
            )}
            <div className="herr-acciones">
              <button type="button" disabled={removing} onClick={() => setConfirmOpen(false)}>
                {t("quitarCancelar")}
              </button>
              <button
                type="button"
                className="is-danger"
                data-agent-tool-confirm-remove=""
                disabled={removing}
                onClick={() => void confirmRemove()}
              >
                {t("quitarConfirmar")}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>,
    document.body,
  );
}

/** Header button in the agent's chat on the phone: hidden when the agent has no tools; opens directly when there is one,
 *  or shows a bottom sheet to pick when there are several. */
export function BotonHerramientasDeAgente({
  abierto = true,
  cliente,
  tools,
  idioma,
  onPrompt,
  onRemoved,
}: {
  abierto?: boolean;
  cliente: ClienteDeOpenLen;
  tools: readonly AgentToolItem[];
  idioma: string;
  onPrompt: (text: string) => void;
  onRemoved: (toolId: string) => void;
}) {
  const t = useTranslations("movil.agentTools");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [active, setActive] = useState<AgentToolItem | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  useAtras(pickerOpen, () => setPickerOpen(false));

  // Move focus into the picker sheet on open and handle Escape at capture phase so it never closes the chat underneath.
  useEffect(() => {
    if (!pickerOpen) return;
    const before = document.activeElement as HTMLElement | null;
    pickerRef.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.isComposing) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setPickerOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      devolverFoco(before);
    };
  }, [pickerOpen]);

  // If the chat closes underneath, dismiss any open picker or tool screen.
  useEffect(() => {
    if (!abierto) {
      setPickerOpen(false);
      setActive(null);
    }
  }, [abierto]);

  // If the open tool disappears from the refreshed list, close it cleanly.
  useEffect(() => {
    if (active && !tools.some((x) => x.id === active.id)) setActive(null);
  }, [active, tools]);

  // If tools become empty while picker is open, dismiss picker.
  useEffect(() => {
    if (pickerOpen && tools.length === 0) setPickerOpen(false);
  }, [pickerOpen, tools.length]);

  if (tools.length === 0 && !active) return null;

  return (
    <>
      {tools.length > 0 && (
        <button
          type="button"
          className="ch-btn"
          data-agent-tools-btn=""
          aria-label={tools.length === 1 ? tools[0].title : t("boton")}
          onClick={() => {
            if (tools.length === 1) setActive(tools[0]);
            else setPickerOpen(true);
          }}
        >
          <Icono nombre="proyecto" />
        </button>
      )}
      {pickerOpen &&
        createPortal(
          <div
            ref={pickerRef}
            className="herr-velo lm-m"
            role="dialog"
            aria-modal="true"
            aria-label={t("elegirTitulo")}
            data-agent-tools-picker=""
            onClick={(e) => {
              if (e.target === e.currentTarget) setPickerOpen(false);
            }}
          >
            <div className="herr-hoja">
              <h2>{t("elegirTitulo")}</h2>
              <ul className="herr-lista">
                {tools.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      data-agent-tool-pick={item.id}
                      onClick={() => {
                        setPickerOpen(false);
                        setActive(item);
                      }}
                    >
                      {item.title}
                    </button>
                  </li>
                ))}
              </ul>
              <div className="herr-acciones">
                <button type="button" onClick={() => setPickerOpen(false)}>
                  {t("cerrar")}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
      {active && (
        <PantallaHerramientaDeAgente
          key={active.id}
          cliente={cliente}
          tool={active}
          idioma={idioma}
          onCerrar={() => setActive(null)}
          onPrompt={onPrompt}
          onRemoved={(id) => {
            setActive((cur) => (cur?.id === id ? null : cur));
            onRemoved(id);
          }}
        />
      )}
    </>
  );
}
