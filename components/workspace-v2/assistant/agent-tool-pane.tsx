"use client";

// AN AGENT'S TOOL IN ITS PLACE ON THE WEB (spec local 2026-11-22-herramienta-dentro-del-agente, §2, §4): frames the
// tool's published version (`frameUrl`), answers its restricted bridge (`AGENT_TOOL_BRIDGE_METHODS`), opens one SSE
// follow stream on `data.subscribe` (restarting on every `data.subscribe` and reconnecting with backoff if the stream
// drops so a fresh baseline always arrives; stopping and removing the tab only on `event: gone`), fills the agent's
// composer without sending on `sendPrompt`, and offers the person-only «Quitar» menu with confirmation.
import { MoreHorizontal, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { AGENT_TOOL_BRIDGE_METHODS, createToolBridgeHost } from "@/lib/tools/bridge/host";
import type { DataChangedParams } from "@/lib/tools/bridge/protocol";

import { ALLOW_HERRAMIENTA_AGENTE, SANDBOX_HERRAMIENTA_AGENTE } from "../sandbox-del-lienzo";
import { readToolTheme } from "../tools/use-tool-bridge-host";
import { HER_QUIET, HER_ROW, HerSheet } from "./her-sheet";

export interface AgentToolListItem {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly frameUrl: string;
  /** The published version the tab shows (its context's `tool.version`). */
  readonly releaseSha?: string;
  readonly frameOrigin: string;
}

const RECONNECT_INITIAL_MS = 1_000;
const RECONNECT_MAX_MS = 15_000;

function parseDataChanged(raw: string): DataChangedParams | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const kind = (parsed as { kind?: unknown }).kind;
    if (kind === "baseline" || kind === "change") return parsed as DataChangedParams;
  } catch {
    // malformed SSE frame: ignored
  }
  return null;
}

export function AgentToolPane({
  tool,
  locale,
  onPrompt,
  onRemoved,
  personName = "",
}: {
  tool: AgentToolListItem;
  locale: string;
  /** The signed-in person's name, for the tool's context (as an installed tool gets it). */
  personName?: string;
  onPrompt: (text: string) => void;
  onRemoved: (toolId: string) => void;
}) {
  const t = useTranslations("panelsChat");
  const iframe = useRef<HTMLIFrameElement>(null);
  const titleId = useId();
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  const latest = useRef({ tool, locale, onPrompt, onRemoved, personName });
  latest.current = { tool, locale, onPrompt, onRemoved, personName };

  // Follow stream lifecycle — kept in refs so `onDataSubscribe` stays strictly synchronous (Ruling T5 / M5-1).
  const followRef = useRef<{
    es: EventSource | null;
    timer: ReturnType<typeof setTimeout> | null;
    delayMs: number;
    stopped: boolean;
    gone: boolean;
  }>({ es: null, timer: null, delayMs: RECONNECT_INITIAL_MS, stopped: false, gone: false });

  const stopFollow = useCallback((permanent: boolean, gone = false) => {
    const f = followRef.current;
    if (permanent) f.stopped = true;
    if (gone) f.gone = true;
    if (f.timer !== null) {
      clearTimeout(f.timer);
      f.timer = null;
    }
    if (f.es) {
      f.es.close();
      f.es = null;
    }
  }, []);

  const hostRef = useRef<ReturnType<typeof createToolBridgeHost> | null>(null);

  const openFollow = useCallback(() => {
    const f = followRef.current;
    if (f.stopped) return;
    if (f.timer !== null) {
      clearTimeout(f.timer);
      f.timer = null;
    }
    if (f.es) {
      f.es.close();
      f.es = null;
    }
    if (typeof EventSource === "undefined") return;

    const toolId = latest.current.tool.id;
    const scheduleReconnect = () => {
      if (f.stopped || f.timer !== null) return;
      const wait = f.delayMs;
      f.delayMs = Math.min(RECONNECT_MAX_MS, f.delayMs * 2);
      f.timer = setTimeout(() => {
        f.timer = null;
        openFollow();
      }, wait);
    };

    let es: EventSource;
    try {
      es = new EventSource(`/api/agent-tools/${encodeURIComponent(toolId)}/follow`);
    } catch {
      scheduleReconnect();
      return;
    }
    f.es = es;

    const onBaseline = (e: Event) => {
      if (f.es !== es || f.stopped) return;
      f.delayMs = RECONNECT_INITIAL_MS;
      const data = parseDataChanged(String((e as MessageEvent).data ?? ""));
      if (data) hostRef.current?.notifyData(data);
    };
    const onChange = (e: Event) => {
      if (f.es !== es || f.stopped) return;
      const data = parseDataChanged(String((e as MessageEvent).data ?? ""));
      if (data) hostRef.current?.notifyData(data);
    };
    const onGone = () => {
      if (f.es !== es || f.stopped) return;
      stopFollow(true, true);
      latest.current.onRemoved(toolId);
    };

    es.addEventListener("baseline", onBaseline);
    es.addEventListener("change", onChange);
    es.addEventListener("gone", onGone);
    // Any drop or server-closed stream reconnects for a fresh baseline; only `gone` stops for good.
    es.onerror = () => {
      if (f.es !== es || f.stopped) return;
      es.close();
      f.es = null;
      scheduleReconnect();
    };
  }, [stopFollow]);

  // Synchronous onDataSubscribe: restarts the follow stream on every `data.subscribe` (initial load, reload, navigation),
  // unless the tool is already permanently `gone`.
  const onDataSubscribe = useCallback(() => {
    if (followRef.current.gone) return;
    followRef.current.stopped = false;
    followRef.current.delayMs = RECONNECT_INITIAL_MS;
    openFollow();
  }, [openFollow]);

  const host = useMemo(
    () =>
      createToolBridgeHost({
        frame: () => iframe.current?.contentWindow ?? null,
        frameOrigin: tool.frameOrigin,
        caller: { agentToolId: tool.id },
        methods: AGENT_TOOL_BRIDGE_METHODS,
        context: () => ({
          person: { name: latest.current.personName, locale: latest.current.locale },
          project: null,
          // The published version it shows (an older list without it: the version the frame's URL carries).
          tool: { id: latest.current.tool.id, version: latest.current.tool.releaseSha ?? new URL(latest.current.tool.frameUrl).searchParams.get("v") ?? "" },
          environment: "installed",
        }),
        theme: readToolTheme,
        onPrompt: (text) => latest.current.onPrompt(text),
        onConfirmChange: async () => false,
        onConfirmJob: async () => false,
        onPickFiles: async () => null,
        onDataSubscribe,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        locale,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tool.id, tool.frameOrigin, onDataSubscribe],
  );
  hostRef.current = host;

  useEffect(() => {
    followRef.current.stopped = false;
    const onMessage = (e: MessageEvent) => void host.onMessage(e);
    window.addEventListener("message", onMessage);
    const observer = new MutationObserver(() => host.notifyContext());
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => {
      window.removeEventListener("message", onMessage);
      observer.disconnect();
      stopFollow(true);
    };
  }, [host, stopFollow]);

  useEffect(() => {
    if (!menuOpen) return;
    const away = (e: PointerEvent) => {
      if (menuRef.current && e.target instanceof Node && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [menuOpen]);

  const confirmRemove = async () => {
    if (removing) return;
    setRemoving(true);
    setRemoveError(false);
    try {
      const res = await fetch(`/api/agent-tools/${encodeURIComponent(tool.id)}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) {
        setRemoveError(true);
        return;
      }
      stopFollow(true, true);
      setConfirmOpen(false);
      onRemoved(tool.id);
    } catch {
      setRemoveError(true);
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col pr-2 pb-2" data-agent-tool-pane={tool.id}>
      <div className="flex h-10 shrink-0 items-center justify-between px-2">
        <span className="truncate text-[13px] font-medium fg">{tool.title}</span>
        <div ref={menuRef} className="relative">
          <button
            ref={menuButtonRef}
            type="button"
            data-agent-tool-menu=""
            aria-expanded={menuOpen}
            aria-label={t("ownAssistant.tools.menu")}
            title={t("ownAssistant.tools.menu")}
            onClick={() => setMenuOpen((o) => !o)}
            className={`her-ring flex h-7 w-7 items-center justify-center rounded-full transition-colors ${menuOpen ? "bg-hover fg" : "fg-muted hover:bg-hover hover:fg"}`}
          >
            <MoreHorizontal size={16} aria-hidden="true" />
          </button>
          {menuOpen && (
            <div className="slide-down absolute right-0 top-full z-20 mt-1 w-44 rounded-[12px] border bd-strong bg-elev p-1 shadow-[0_12px_36px_-8px_rgba(0,0,0,0.45)]">
              <button
                type="button"
                data-agent-tool-remove=""
                onClick={() => {
                  menuButtonRef.current?.focus();
                  setMenuOpen(false);
                  setRemoveError(false);
                  setConfirmOpen(true);
                }}
                className={`${HER_ROW} text-red-500 hover:text-red-400`}
              >
                <Trash2 size={14} aria-hidden="true" />
                {t("ownAssistant.tools.remove")}
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-[14px] border bd bg-[var(--bg)]">
        <iframe
          ref={iframe}
          src={tool.frameUrl}
          title={tool.title}
          sandbox={SANDBOX_HERRAMIENTA_AGENTE}
          allow={ALLOW_HERRAMIENTA_AGENTE}
          className="h-full w-full border-0 bg-[var(--bg)]"
          data-tool-frame={tool.id}
          data-agent-tool-frame={tool.id}
        />
      </div>
      <HerSheet
        open={confirmOpen}
        onClose={() => !removing && setConfirmOpen(false)}
        dismissable={!removing}
        titleId={titleId}
        title={t("ownAssistant.tools.removeTitle", { title: tool.title })}
        note={t("ownAssistant.tools.removeBody", { title: tool.title })}
      >
        {removeError && <p className="mb-3 text-center text-[12px] text-red-500">{t("ownAssistant.tools.removeFailed")}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" disabled={removing} onClick={() => setConfirmOpen(false)} className={HER_QUIET}>
            {t("ownAssistant.tools.removeCancel")}
          </button>
          <button
            type="button"
            data-agent-tool-confirm-remove=""
            disabled={removing}
            onClick={() => void confirmRemove()}
            className="inline-flex h-9 items-center justify-center rounded-[10px] bg-red-600 px-4 text-[13px] font-semibold text-white transition hover:bg-red-500 active:scale-[0.98] disabled:opacity-45"
          >
            {t("ownAssistant.tools.removeConfirm")}
          </button>
        </div>
      </HerSheet>
    </div>
  );
}
