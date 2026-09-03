// Chat tab — primary design surface for flat (template-clone / paste)
// projects. When the panel is mounted with `flatProjectId` + `onFlatHtmlUpdate`,
// it talks to /api/templates/ai-design (Gemini streaming SSE) and drip-feeds
// the iframe via `onFlatHtmlUpdate`. Other states (loading, no project)
// render a skeleton or empty card — never a mock conversation.

"use client";

import { useLocale, useTranslations } from "next-intl";
import {
  noCreditsText,
  notifyCreditBalanceChanged,
} from "@/lib/credits-client";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  Crosshair,
  ImageIcon,
  Detener,
  Loader,
  SendUp,
  LenMark,
  TriangleAlert,
  Wand,
  WandSparkles,
  X,
} from "../icons";
import { ReplaceAssetModal } from "../replace-asset-modal";
import { AgentActionCard, type AgentAction } from "../agent-action-card";

/** Un mensaje del historial reproducido. Los dos campos de herramienta viajan
 *  sólo en los turnos que de verdad usaron una — ver el comentario largo donde
 *  se arma `history`. El servidor los VALIDA contra el catálogo real; nada de
 *  lo que manda el navegador se ejecuta. */
export interface HistoryEntry {
  role: "user" | "assistant";
  content: string;
  functionCalls?: { name: string; args: Record<string, unknown> }[];
  functionResponses?: { name: string; response: Record<string, unknown> }[];
}
import { AgentConfirmCard, type AgentConfirm } from "../agent-confirm-card";
import {
  ejecutarUndo,
  mismaPagina,
  planDeUndo,
  type FalloDeUndo,
} from "./undo-turn";
import { cierreDeTurno } from "./turno-cerrado";
import type { StoredChatTurn } from "@/lib/projects/types";
import type { SitePageSummary } from "@/lib/projects/site-pages";
import type { AgentErrorCode } from "@/lib/agent/loop";
import { CHAT_HISTORY_TURNS } from "@/lib/chat/history-window";
import { scanController, scanFxUnavailable } from "@/lib/workspace-v2/scan-controller";
import { resaltarController } from "@/lib/workspace-v2/resaltar-controller";
import { seccionesCambiadas, MAX_SECCIONES } from "@/lib/workspace-v2/diff-de-turno";
import type { OpDescrita } from "@/lib/agent/ops-descritas";

export interface ScopedSelection {
  hint: string;
  /** CSS-selector breadcrumb (`section:nth-of-type(3) > h1:nth-of-type(1)`)
   *  built by the iframe section-select script. The API resolves this to a
   *  specific `data-op-id` so the model gets a hard target, not a fuzzy text hint. */
  path: string;
}

export interface AttachedImage {
  url: string;
  alt?: string;
}

interface ChatPanelProps {
  /** When provided (a flat project is loaded), the chat operates the real
   *  AI design surface — Gemini streaming + per-turn Undo. */
  flatProjectId?: string;
  flatProjectHtml?: string;
  /** Multi-page: slug of the site page the canvas is editing (null/absent =
   *  home). Forwarded to ai-design + the undo PATCH so chat edits land in
   *  the right document slot. */
  flatProjectPage?: string | null;
  onFlatHtmlUpdate?: (
    newHtml: string,
    page?: string | null,
    untrusted?: boolean,
  ) => void;
  /** Persisted transcript — seeds the chat so a reload / tab switch
   *  restores the conversation. */
  flatProjectChat?: StoredChatTurn[];
  /** Fired after a turn is persisted — the parent refetches so its mirror
   *  and other tabs (via BroadcastChannel) converge. */
  onChatChange?: () => void;
  /** Mirrors the chat's streaming state to the parent so the preview can
   *  overlay the page-building loader while the model redesigns. */
  onRedesigningChange?: (active: boolean) => void;
  /** True while the parent is still fetching `/api/projects/<id>` — render
   *  a skeleton so a brief flash of the empty/fallback state doesn't appear
   *  during reload. */
  projectLoading?: boolean;
  /** Section-select coordination — the parent owns the toggle so the iframe
   *  (in PreviewArea) can be told when to enter selection mode. The chat
   *  panel surfaces a toggle button and a chip; the parent listens for the
   *  postMessage and writes `scopedSelection`. */
  sectionSelectMode?: boolean;
  onToggleSectionSelect?: (active: boolean) => void;
  scopedSelection?: ScopedSelection | null;
  onClearScope?: () => void;
  /** Open the Autofill modal. Renders a labeled "Autofill" pill in the
   *  composer when provided. Pass undefined to hide (e.g., non-flat projects). */
  onAutofill?: () => void;
  /** External push of composer draft text — used by the post-swap chip
   *  to suggest a context-aware prompt. Set non-null to apply; chat-
   *  panel calls `onPendingDraftConsumed` once it has copied the value
   *  into its local state so the parent can null it out. */
  pendingDraft?: string | null;
  onPendingDraftConsumed?: () => void;
  /** Multi-page: the site's subpages + a switcher, so the composer can offer a
   *  "which page am I editing" picker that jumps to the chosen page. */
  sitePages?: SitePageSummary[];
}

export function ChatPanel({
  flatProjectId,
  flatProjectHtml,
  flatProjectPage = null,
  onFlatHtmlUpdate,
  flatProjectChat,
  onChatChange,
  onRedesigningChange,
  projectLoading = false,
  sectionSelectMode = false,
  onToggleSectionSelect,
  scopedSelection = null,
  onClearScope,
  onAutofill,
  pendingDraft = null,
  onPendingDraftConsumed,
  sitePages = [],
}: ChatPanelProps) {
  if (flatProjectId && onFlatHtmlUpdate) {
    return (
      <AIDesignChat
        page={flatProjectPage}
        sitePages={sitePages}
        // Page-aware key: switching ?page=<slug> remounts the chat so the
        // transcript reseeds to THAT page's turns (not the whole project's).
        key={`${flatProjectId}:${flatProjectPage ?? ""}`}
        projectId={flatProjectId}
        projectHtml={flatProjectHtml ?? ""}
        onLocalUpdate={onFlatHtmlUpdate}
        initialChat={flatProjectChat}
        onChatChange={onChatChange}
        onRedesigningChange={onRedesigningChange}
        sectionSelectMode={sectionSelectMode}
        onToggleSectionSelect={onToggleSectionSelect}
        scopedSelection={scopedSelection}
        onClearScope={onClearScope}
        onAutofill={onAutofill}
        pendingDraft={pendingDraft}
        onPendingDraftConsumed={onPendingDraftConsumed}
      />
    );
  }
  if (projectLoading) return <ChatLoadingSkeleton />;
  return <ChatNoProjectState />;
}

function ChatLoadingSkeleton() {
  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 min-h-0 px-3 py-3 space-y-3 overflow-hidden">
        <div className="flex gap-2 flex-row-reverse">
          <div className="shrink-0 h-6 w-6 rounded-full bg-zinc-200/70 dark:bg-zinc-800/60 animate-pulse" />
          <div className="h-8 w-1/2 rounded-2xl bg-zinc-200/70 dark:bg-zinc-800/60 animate-pulse" />
        </div>
        <div className="flex gap-2">
          <div className="shrink-0 h-6 w-6 rounded-full bg-zinc-200/70 dark:bg-zinc-800/60 animate-pulse" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-5/6 rounded bg-zinc-200/70 dark:bg-zinc-800/60 animate-pulse" />
            <div className="h-3 w-3/5 rounded bg-zinc-200/70 dark:bg-zinc-800/60 animate-pulse" />
          </div>
        </div>
      </div>
      <div className="shrink-0 px-3 pb-3">
        <div className="h-[68px] rounded-xl bg-zinc-200/70 dark:bg-zinc-800/60 animate-pulse" />
      </div>
    </div>
  );
}

function ChatNoProjectState() {
  const t = useTranslations("panelsChat");
  return (
    <div className="h-full flex items-center justify-center px-6 py-8 text-center">
      <div className="max-w-[220px]">
        <div className="mx-auto mb-3 inline-flex h-9 w-9 items-center justify-center rounded-md ring-1 ring-[color:var(--border)] bg-elev text-accent">
          <LenMark size={14} />
        </div>
        <p className="text-[11.5px] fg-muted leading-relaxed">
          {t("noProject.title")}
        </p>
        <p className="mt-1.5 text-[10.5px] fg-faint leading-relaxed">
          {t("noProject.subtitle")}
        </p>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// AI Design Chat — Gemini streaming, flat projects only.
// ════════════════════════════════════════════════════════════════════════════

type TurnStatus = "streaming" | "applied" | "error" | "reverted";

interface DesignTurn {
  id: string;
  userText: string;
  /** Image attached to this turn — rendered in the user bubble as proof
   *  it was actually sent with the message. */
  attachedImage?: AttachedImage;
  /**
   * El elemento al que se acotó ESTE turno — misma prueba que la imagen.
   *
   * Se limpia del compositor al enviar (acotar es una decisión de un mensaje,
   * no un modo), y sin dejar rastro en el turno eso se siente como que se
   * perdió: marcas `div.video-placeholder`, mandas, la pastilla desaparece y ya
   * no hay forma de saber si viajó. Aquí queda escrito lo que se mandó.
   */
  scope?: ScopedSelection;
  assistantReasoning: string;
  status: TurnStatus;
  errorText?: string;
  /** HTML before this turn ran — used to revert via Undo. */
  preEditHtml: string;
  /** Site page this turn edited (null = home), snapshotted at send time.
   *  Undo/Retry target THIS page — the canvas may have switched since.
   *  undefined = pre-multipage turn; falls back to the current page. */
  page?: string | null;
  /** Modo Agente: las páginas que el turno ESCRIBIÓ de verdad, una por evento
   *  `html`. `trabajar_en_pagina` puede mover el documento activo a mitad del
   *  turno, y sólo hay UNA preimagen (la de `page`). Si aquí aparece otra
   *  página, Deshacer no puede cumplir lo que promete y no se ofrece — ver
   *  ./undo-turn. Local: los turnos restaurados no traen preimagen y ya
   *  esconden el botón por otro motivo. */
  paginasTocadas?: (string | null)[];
  /** El turno se cortó DESPUÉS de haber cambiado la página. Se pinta como
   *  aviso sobre un turno aplicado, no como error: el cambio ya vive en la
   *  base y decir «falló» manda al usuario a repetirlo. */
  avisoTurno?: string;
  /** El servidor rechazó el último Deshacer. El turno SIGUE aplicado. */
  undoFallo?: FalloDeUndo;
  /** Deshacer en vuelo — el botón espera al servidor antes de cantar nada. */
  undoEnCurso?: boolean;
  postEditHtml?: string;
  /** Agent-mode tool cards for this turn (leer_estado → editar_pagina → …).
   *  Empty/absent for ai-design turns. F2-T11: persisted (final states only)
   *  so a reload rehydrates the same cards the live turn had — see the
   *  `persistTurn` comment in `send()` for the upsert-on-persist rule. */
  actions?: AgentAction[];
  /** Agent-mode publish gate (Task 7) — a `confirm` SSE event lands here and
   *  renders an interactive AgentConfirmCard. The card survives the turn's
   *  `done` (it finalizes to applied but the card stays tappable). Local-only,
   *  never persisted (F2-T11 decision) — see the `persistTurn` comment for why. */
  confirm?: AgentConfirm;
  /** Agent-mode: the turn finished without any `html` event (answer-only or
   *  settings-only) — no document changed, so the footer suppresses the
   *  Applied/Undo affordances. F2-T11: persisted, so a restored turn suppresses
   *  the footer exactly like the live one did. */
  noDocChange?: boolean;
  /** Cuántas ediciones aplicó el turno de verdad, sumadas de los eventos
   *  `action` (`applied.appliedCount` en el servidor). Ya viajaba a la etiqueta
   *  de la versión —«Agente (3 ops): …»— y no a lo que el usuario mira.
   *  Ausente ⇒ el pie no dice nada del número, como antes. */
  appliedAt?: number;
  /** ms-epoch when the turn started — drives the elapsed-time label
   *  shown next to "Designing your page…" so the user has signal that
   *  the model is still chewing through HTML. */
  startedAt?: number;
  /** Total HTML chars received from the stream so far. Surfaced in the
   *  streaming footer as forward-motion proof. */
  streamedChars?: number;
}

/** Two turns are on the same document when their page slugs match, treating
 *  null/undefined (pre-multipage + home) as the home document. Una sola
 *  definición, compartida con la decisión de Deshacer (./undo-turn). */
const samePage = mismaPagina;

const QUICK_PROMPT_KEYS: ReadonlyArray<string> = [
  "quickPrompts.premium",
  "quickPrompts.linear",
  "quickPrompts.brutalist",
  "quickPrompts.playful",
  "quickPrompts.rewriteHero",
  "quickPrompts.testimonials",
];

const FLUSH_INTERVAL_MS = 800;
const FLUSH_CHAR_BUDGET = 2000;

// F4 Task 7 — kill-switch fallback: flips true the first time /api/agent
// reports `code: "agent_off"` (server env OPENLEN_AGENT=0). Module state
// (not component state) so it survives an AIDesignChat remount — switching
// pages remounts the chat via the `key` in ChatPanel above — while still
// resetting on a hard reload, which is what "rest of the browser session"
// means here. Once true, `send()` skips the agent branch outright and goes
// straight to classic ai-design for every later turn in this session.
let agentKilledThisSession = false;

// Agent-mode: upsert one card into an ordered list of tool cards — replace a
// trailing `running` card for the same tool instead of stacking a duplicate,
// otherwise append. Pure so it's shared between the live React-state upsert
// (`upsertAction`) and `send()`'s local accumulator, which needs the same
// final list (independent of React's render/flush timing) to hand to
// `persistTurn` once the turn settles.
function upsertActionInto(
  actions: AgentAction[] | undefined,
  action: AgentAction,
): AgentAction[] {
  const next = actions ? [...actions] : [];
  const last = next[next.length - 1];
  if (last && last.tool === action.tool && last.status === "running") {
    next[next.length - 1] = action;
  } else {
    next.push(action);
  }
  return next;
}

function AIDesignChat({
  page = null,
  projectId,
  projectHtml,
  onLocalUpdate,
  initialChat,
  onChatChange,
  onRedesigningChange,
  sectionSelectMode = false,
  onToggleSectionSelect,
  scopedSelection = null,
  onClearScope,
  onAutofill,
  pendingDraft = null,
  onPendingDraftConsumed,
  sitePages = [],
}: {
  projectId: string;
  projectHtml: string;
  page?: string | null;
  /** Write a document's html into the parent's project state. `page`
   *  pins the slot (null = home); undefined = whatever page is active. */
  /** `untrusted` marca el HTML que todavía NO pasó por el sanitizador del
   *  servidor: el drip crudo de un rewrite Modo B. Viaja junto al html (y no
   *  como señal aparte) para que no puedan desincronizarse — el preview lo
   *  usa para pintar bajo CSP y sin instrumentar. */
  onLocalUpdate: (
    newHtml: string,
    page?: string | null,
    untrusted?: boolean,
  ) => void;
  initialChat?: StoredChatTurn[];
  onChatChange?: () => void;
  onRedesigningChange?: (active: boolean) => void;
  sectionSelectMode?: boolean;
  onToggleSectionSelect?: (active: boolean) => void;
  scopedSelection?: ScopedSelection | null;
  onClearScope?: () => void;
  onAutofill?: () => void;
  pendingDraft?: string | null;
  onPendingDraftConsumed?: () => void;
  sitePages?: SitePageSummary[];
}) {
  const t = useTranslations("panelsChat");
  // Agent-mode messages live under the wsPage namespace (shared with the
  // AgentActionCard); pulled separately from the panelsChat translator.
  const tAgent = useTranslations("wsPage.agent");
  // The credit wall names a day, so it needs the reader's locale to say it.
  const locale = useLocale();
  // Seed from the persisted transcript so a reload / tab-switch remount
  // restores the conversation. Restored turns carry no HTML snapshot — their
  // inline Undo is hidden (the Versions tab covers older revisions).
  // UNA SOLA CHARLA PARA TODO EL SITIO.
  //
  // Esto se filtraba por página: cambiabas a /nosotros y la conversación
  // arrancaba de cero — mismo proyecto, misma sesión, mismo minuto. Y no era
  // sólo lo que se veía: `turnsRef` sale de aquí, y `turnsRef` es lo que se le
  // manda al modelo como historia, así que el Agente también perdía la charla.
  //
  // El filtro tenía una razón buena —que un turno sobre la Home no se confunda
  // con una edición de /nosotros— y esa razón ya está resuelta AGUAS ABAJO: el
  // turno de otra página viaja ETIQUETADO con su slug (busca `deOtraPagina`).
  // De hecho ese etiquetado ya estaba escrito y no podía ejecutarse nunca,
  // porque este filtro se había llevado los turnos antes de llegar allí.
  //
  // El transcript en la base SIEMPRE fue uno solo por proyecto, con su `page`
  // por turno. Era esto lo que lo partía.
  const [turns, setTurns] = useState<DesignTurn[]>(() =>
    (initialChat ?? []).map(restoreTurn),
  );
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  // Agent mode — DEFAULT ON since graduation (alpha ruling 2026-07-08):
  // el Agente OpenLen es el chat. `ol:agent = "0"` is the per-browser
  // opt-out back to classic ai-design (testing/emergencies). Read once on
  // mount for the UI (hides the ModelPicker the agent route ignores); the
  // send() path re-reads localStorage at call time.
  const [agentModeUI, setAgentModeUI] = useState(true);
  useEffect(() => {
    try {
      setAgentModeUI(window.localStorage.getItem("ol:agent") !== "0");
    } catch {
      /* storage blocked — default stays agent */
    }
  }, []);
  const [attachedImage, setAttachedImage] = useState<AttachedImage | null>(null);
  const [imageModalOpen, setImageModalOpen] = useState(false);

  const taRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const projectHtmlRef = useRef(projectHtml);
  projectHtmlRef.current = projectHtml;
  // Multi-page: the slug chat edits land on. Ref so in-flight sends/undos
  // read the value at call time.
  const pageRef = useRef(page);
  pageRef.current = page;

  const turnsRef = useRef<DesignTurn[]>(turns);
  turnsRef.current = turns;

  // Kept in a ref so the persist effect can call the latest callback without
  // listing it as a dependency (which would re-run the effect — and re-POST —
  // on every parent render).
  const onChatChangeRef = useRef(onChatChange);
  onChatChangeRef.current = onChatChange;

  const onRedesigningChangeRef = useRef(onRedesigningChange);
  onRedesigningChangeRef.current = onRedesigningChange;

  const abortRef = useRef<AbortController | null>(null);
  // EL TURNO EN MARCHA, para poder corregirle el rumbo. Lo manda el servidor
  // como primer evento del SSE; sin el no hay a donde escribir.
  const turnoIdRef = useRef<string | null>(null);

  // Bumps every 15s so "Applied · 12s ago" stays accurate without
  // per-message timers.
  const [, setNowTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setNowTick((n) => n + 1), 15_000);
    return () => window.clearInterval(id);
  }, []);

  // Bumps every 1s WHILE a turn is mid-stream so the elapsed-time label
  // in the streaming footer refreshes live. Cheaper than a global ticker
  // — only runs when there's something to count.
  useEffect(() => {
    if (!sending) return;
    const id = window.setInterval(() => setNowTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [sending]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // Mirror streaming state to the parent so the preview can overlay the
  // page-building loader while the model redesigns — but ONLY when the scan
  // effect can't render (kill switch / reduced motion). Otherwise the loader
  // would sit at z-40 over the iframe and hide the scan sweep entirely.
  // Cleanup forces it off if the chat unmounts mid-stream (a tab switch
  // aborts the request).
  useEffect(() => {
    onRedesigningChangeRef.current?.(sending && scanFxUnavailable());
    return () => onRedesigningChangeRef.current?.(false);
  }, [sending]);

  // Convergence — reconcile the server transcript into local turns. When
  // another tab (or device) appends a turn, a refetch lands it in `initialChat`
  // and we merge: server turns are the authority for settled history; a turn
  // still streaming in THIS tab is local-only and kept. `initialChat` is read
  // through a ref so the effect depends only on the content signature.
  const initialChatRef = useRef(initialChat);
  initialChatRef.current = initialChat;
  const initialChatSig = (initialChat ?? [])
    .map((s) => `${s.id}:${s.status}`)
    .join("|");
  const chatSeededRef = useRef(false);
  useEffect(() => {
    if (!chatSeededRef.current) {
      // First run = the useState seed; nothing to reconcile.
      chatSeededRef.current = true;
      return;
    }
    const server = initialChatRef.current ?? [];
    setTurns((prev) => {
      const prevById = new Map(prev.map((t) => [t.id, t]));
      const serverIds = new Set(server.map((s) => s.id));
      // Server turns first (chronological, the authority). Keep the local
      // DesignTurn where we have it — it carries preEditHtml for in-session
      // Undo — but take status from the server (another tab may have undone
      // it). Restore turns we've never seen.
      const merged: DesignTurn[] = server.map((s) => {
        const local = prevById.get(s.id);
        return local ? { ...local, status: s.status } : restoreTurn(s);
      });
      // Local turns the server hasn't got yet — the in-flight streaming turn,
      // or one whose append POST is still landing. Append after.
      for (const t of prev) {
        if (!serverIds.has(t.id)) merged.push(t);
      }
      return merged;
    });
  }, [initialChatSig]);

  // External draft push (post-swap "Update copy?" chip flow). Apply once,
  // focus the textarea so the user can edit or hit Send, then consume.
  useEffect(() => {
    if (!pendingDraft) return;
    setDraft(pendingDraft);
    // Defer focus until the textarea has the new value applied.
    queueMicrotask(() => {
      taRef.current?.focus();
      // Place caret at end so the user can keep typing if they want.
      const el = taRef.current;
      if (el) el.setSelectionRange(el.value.length, el.value.length);
    });
    onPendingDraftConsumed?.();
  }, [pendingDraft, onPendingDraftConsumed]);

  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [draft]);

  const lastSig = useMemo(
    () =>
      turns
        .map(
          (t) =>
            `${t.id}:${t.assistantReasoning.length}:${t.status}:${t.actions?.length ?? 0}`,
        )
        .join("|"),
    [turns],
  );
  useLayoutEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lastSig, sending]);

  const updateTurn = useCallback((id: string, patch: Partial<DesignTurn>) => {
    setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  const appendReasoning = useCallback((id: string, text: string) => {
    setTurns((prev) =>
      prev.map((t) =>
        t.id === id
          ? { ...t, assistantReasoning: t.assistantReasoning + text }
          : t,
      ),
    );
  }, []);

  // Agent-mode: upsert a tool card. Each tool call emits `running` then
  // `done`/`error` — replace the trailing `running` card for that tool
  // instead of stacking a duplicate; otherwise append a new card.
  const upsertAction = useCallback((id: string, action: AgentAction) => {
    setTurns((prev) =>
      prev.map((t) =>
        t.id === id
          ? { ...t, actions: upsertActionInto(t.actions, action) }
          : t,
      ),
    );
  }, []);

  // Append a settled turn to the server transcript (append-only log), then
  // signal the parent — it refetches + BroadcastChannels other tabs into sync.
  const persistTurn = useCallback(
    async (turn: StoredChatTurn) => {
      try {
        await fetch(`/api/projects/${projectId}/chat`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(turn),
        });
        onChatChangeRef.current?.();
      } catch {
        /* soft — a missed append only costs this turn from the transcript */
      }
    },
    [projectId],
  );

  // Classic ai-design network+SSE leg — extracted out of `send()` so it has
  // TWO callers: the normal (non-agent) path below, and the agent branch's
  // F4 Task 7 kill-switch fallback (agent reports `code: "agent_off"` →
  // silently re-run THIS SAME turn through here instead of showing an
  // error). Callers own `sending`/`abortRef` lifecycle (their own
  // try/finally) — this function only ever resolves, never throws, so a
  // caller's own catch never fires because of it.
  const runAiDesignTurn = useCallback(
    async (opts: {
      turnId: string;
      prompt: string;
      preEditHtml: string;
      turnPage: string | null;
      history: HistoryEntry[];
      /** Turnos que tiene la conversación ENTERA (no los que caben). Sólo para
       *  que el modelo sepa que no lo ve todo y pueda decir «no me acuerdo». */
      historyTotal: number;
      turnScope: { hint: string; path: string } | null;
      turnImage: { url: string; alt?: string } | null;
      abort: AbortController;
    }) => {
      const { turnId, prompt, preEditHtml, turnPage, history, historyTotal, turnScope, turnImage, abort } = opts;
      // Rayo X — idempotent: a no-op if the agent branch already started the
      // loop before falling back here (F4 Task 7 kill-switch replay).
      scanController.start();
      const htmlBuf = { value: "" };
      let accumulatedReasoning = "";
      let lastFlushedLen = 0;
      let flushTimer: number | null = null;
      const flushHtml = () => {
        if (htmlBuf.value.length > lastFlushedLen) {
          lastFlushedLen = htmlBuf.value.length;
          // Salida CRUDA del modelo: ai-design sanitiza al final, sobre el
          // `done`, así que esto va marcado como no confiable.
          onLocalUpdate(htmlBuf.value, turnPage, true);
        }
      };
      const scheduleFlush = () => {
        if (flushTimer !== null) return;
        flushTimer = window.setTimeout(() => {
          flushTimer = null;
          flushHtml();
        }, FLUSH_INTERVAL_MS);
      };
      const clearFlush = () => {
        if (flushTimer !== null) {
          window.clearTimeout(flushTimer);
          flushTimer = null;
        }
      };

      try {
        const res = await fetch("/api/templates/ai-design", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            projectId,
            currentHtml: preEditHtml,
            prompt,
            history,
          historyTotal,
            ...(turnPage ? { page: turnPage } : {}),
            ...(turnScope ? { scope: turnScope } : {}),
            ...(turnImage ? { attachedImage: turnImage } : {}),
          }),
          signal: abort.signal,
        });

        if (!res.ok || !res.body) {
          const errPayload = await res
            .json()
            .catch(() => ({ error: `HTTP ${res.status}` }));
          scanController.cancel();
          // EL CÓDIGO GANA A LA PROSA. El servidor manda `code` para los fallos
          // que un usuario puede provocar de verdad, y aquí se compone en SU
          // idioma. Sin esto, `errPayload.error` se pintaba TAL CUAL — así que
          // una página grande le decía «Page too large for an agent turn» a un
          // usuario japonés, en los 10 locales.
          //
          // Lista explícita y no `t("errors." + code)`: una clave dinámica
          // convierte un código nuevo sin traducir en un fallo de next-intl en
          // tiempo de ejecución, y además no se puede grepear.
          const CODIGO_A_CLAVE: Record<string, string> = {
            pageTooLarge: "errors.pageTooLarge",
            noTaggableElements: "errors.noTaggableElements",
          };
          const clave =
            typeof errPayload?.code === "string" ? CODIGO_A_CLAVE[errPayload.code] : undefined;
          updateTurn(turnId, {
            status: "error",
            errorText: clave
              ? t(clave)
              : typeof errPayload?.error === "string"
                ? errPayload.error
                : t("errors.requestFailed", { status: res.status }),
          });
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let sseBuf = "";
        let finalHtml: string | null = null;
        let errorMessage: string | null = null;

        outer: while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          sseBuf += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = sseBuf.indexOf("\n\n")) >= 0) {
            const block = sseBuf.slice(0, nl);
            sseBuf = sseBuf.slice(nl + 2);
            let evName = "message";
            let dataStr = "";
            for (const line of block.split("\n")) {
              if (line.startsWith("event: ")) {
                evName = line.slice(7).trim();
              } else if (line.startsWith("data: ")) {
                dataStr += line.slice(6);
              }
            }
            if (!dataStr) continue;
            let payload: unknown;
            try {
              payload = JSON.parse(dataStr);
            } catch {
              continue;
            }

            if (evName === "reasoning_chunk") {
              const text =
                payload &&
                typeof (payload as { text?: unknown }).text === "string"
                  ? (payload as { text: string }).text
                  : "";
              if (text) {
                appendReasoning(turnId, text);
                accumulatedReasoning += text;
              }
            } else if (evName === "html_chunk") {
              const text =
                payload &&
                typeof (payload as { text?: unknown }).text === "string"
                  ? (payload as { text: string }).text
                  : "";
              if (text) {
                htmlBuf.value += text;
                setTurns((prev) =>
                  prev.map((t) =>
                    t.id === turnId
                      ? {
                          ...t,
                          streamedChars: (t.streamedChars ?? 0) + text.length,
                        }
                      : t,
                  ),
                );
                // Drip the iframe only when the model is emitting a full
                // HTML document (Mode B / rewrite). Mode A emits <edits>
                // XML — painting those chunks as srcDoc would break the
                // visual mid-stream. We sniff the first ~20 chars of
                // accumulated content to decide.
                const head = htmlBuf.value.trimStart().slice(0, 24);
                const looksLikeOps = /^<edits[\s>]/i.test(head);
                if (!looksLikeOps && !turnScope) {
                  if (
                    htmlBuf.value.length - lastFlushedLen >=
                    FLUSH_CHAR_BUDGET
                  ) {
                    clearFlush();
                    flushHtml();
                  } else {
                    scheduleFlush();
                  }
                }
              }
            } else if (evName === "done") {
              const data = payload as { html?: string; reasoning?: string };
              if (typeof data.html === "string") finalHtml = data.html;
              if (typeof data.reasoning === "string") {
                accumulatedReasoning = data.reasoning;
                updateTurn(turnId, { assistantReasoning: data.reasoning });
              }
              break outer;
            } else if (evName === "error") {
              const data = payload as { message?: string; code?: unknown };
              errorMessage =
                creditWallText(data.code, payload, locale, tAgent) ??
                (typeof data.message === "string"
                  ? data.message
                  : t("errors.generic"));
              break outer;
            }
          }
        }

        clearFlush();

        if (errorMessage) {
          scanController.cancel();
          if (lastFlushedLen > 0) onLocalUpdate(preEditHtml, turnPage);
          updateTurn(turnId, { status: "error", errorText: errorMessage });
          return;
        }

        if (!finalHtml) {
          scanController.cancel();
          if (lastFlushedLen > 0) onLocalUpdate(preEditHtml, turnPage);
          updateTurn(turnId, {
            status: "error",
            errorText: t("errors.noFinalHtml"),
          });
          return;
        }

        scanController.finish(() => {
          onLocalUpdate(finalHtml, turnPage);
          updateTurn(turnId, {
            status: "applied",
            postEditHtml: finalHtml,
            appliedAt: Date.now(),
          });
          // Append the settled turn to the server transcript — append-only, so
          // it's safe even with the same project open in another tab.
          void persistTurn({
            id: turnId,
            userText: prompt,
            attachedImage: turnImage ?? undefined,
            assistantReasoning: accumulatedReasoning,
            status: "applied",
            page: turnPage,
          });
        });
        notifyCreditBalanceChanged();
      } catch (err) {
        clearFlush();
        scanController.cancel();
        // Roll the iframe back to the pre-edit page — a cancel/abort lands here
        // mid Mode-B drip and would otherwise leave a truncated document onscreen
        // (the error/noFinalHtml branches above already revert; this one didn't).
        if (lastFlushedLen > 0) onLocalUpdate(preEditHtml, turnPage);
        if (abort.signal.aborted) {
          updateTurn(turnId, {
            status: "error",
            errorText: t("errors.cancelled"),
          });
        } else {
          updateTurn(turnId, {
            status: "error",
            errorText:
              err instanceof Error ? err.message : t("errors.network"),
          });
        }
      }
    },
    [appendReasoning, onLocalUpdate, persistTurn, projectId, t, updateTurn],
  );

  const send = useCallback(
    async (rawPrompt: string, imageOverride?: AttachedImage | null) => {
      const prompt = rawPrompt.trim();
      if (!prompt || sending) return;
      if (prompt.length > 2000) return;

      // imageOverride lets Retry re-send the failed turn's original image;
      // undefined = use the live composer image, null = explicitly none.
      const img = imageOverride !== undefined ? imageOverride : attachedImage;
      // Snapshot the page scope at send time — preEditHtml is THIS page's
      // document, and the drip / apply / revert / undo legs must all write
      // back to the same slot even if the user switches pages mid-stream.
      // (Retry intentionally re-targets whatever page is active when it
      // fires: it snapshots fresh preEditHtml + page, same as a new send.)
      const turnPage = pageRef.current;
      const preEditHtml = projectHtmlRef.current;
      const turnId =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `t-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      const newTurn: DesignTurn = {
        id: turnId,
        userText: prompt,
        attachedImage: img ?? undefined,
        // El alcance viaja EN el turno, no sólo en la petición: es la misma
        // prueba que la imagen. Se lee AQUÍ, antes de que el envío lo suelte
        // del compositor unas líneas más abajo.
        scope: scopedSelection ?? undefined,
        assistantReasoning: "",
        status: "streaming",
        preEditHtml,
        page: turnPage,
        startedAt: Date.now(),
        streamedChars: 0,
      };

      setTurns((prev) => [...prev, newTurn]);
      setDraft("");
      // The attached image flows into this request via turnImage; clearing
      // here means the next prompt starts fresh. Users can re-attach if they
      // want the same image again.
      setAttachedImage(null);
      // EL ELEMENTO MARCADO SE VA CON SU TURNO, igual que la imagen.
      //
      // Se quedaba pegado: marcabas `div.video-placeholder`, mandabas tu
      // mensaje, y el SIGUIENTE turno seguía acotado a un elemento que ya no
      // querías — sin más aviso que una pastilla que a esas alturas ya habías
      // dejado de mirar. Acotar es una decisión de ESTE mensaje, no un modo.
      //
      // Va aquí y no después a propósito: `turnScope`, unas líneas abajo, lee
      // `scopedSelection` del cierre de ESTE render, así que la petición en
      // vuelo conserva su objetivo — que es la disciplina que su propio
      // comentario ya declaraba para cuando el usuario lo limpia a mano a
      // media respuesta.
      onClearScope?.();
      setSending(true);

      // EL HISTORIAL, CON LA FORMA QUE DE VERDAD TUVO.
      //
      // Antes esto emitía dos mensajes planos por turno y tiraba las llamadas a
      // herramientas. Efecto MEDIDO el 2026-08-22, mismo prompt y misma página,
      // variando sólo el historial: con las llamadas puestas el Agente editó
      // 10 de 12 veces; sin ellas, 1 de 12 — y en los 11 fallos respondió
      // «Listo ✅ añadí el teléfono» sobre una página intacta.
      //
      // La causa es que le reescribíamos su propio pasado para que pareciera
      // que nunca usó una herramienta, y a los pocos turnos lo copiaba. Es la
      // regla que la documentación de la API enuncia para las llamadas en
      // paralelo — reproducir mal el historial entrena el comportamiento
      // futuro — llevada al extremo.
      //
      // El resultado que se reproduce es el RESUMEN de la tarjeta, no la carga
      // real: los resultados de verdad son documentos HTML enteros y mandar
      // seis turnos de eso reventaría el contexto. Estructura sí, carga no.
      // LA CHARLA NO SE REINICIA AL CAMBIAR DE PAGINA.
      //
      // Antes el historial se filtraba con `samePage`: pasabas de la home a
      // /menu y la conversacion arrancaba de CERO — mismo proyecto, misma
      // sesion, mismo minuto. Para el usuario eso es «no me conoce», y es de
      // las cosas que mas se notan.
      //
      // El filtro existia por una razon buena —que un turno sobre la home no
      // confunda una edicion de /menu— pero la cura correcta no es esconder el
      // turno: es DECIR de que pagina fue. Lo mismo que hace el bloque de
      // cambios unas lineas mas abajo.
      const relevantes = turnsRef.current.filter(
        (t) => t.status === "applied" || t.status === "reverted",
      );
      // Cuántos turnos tiene la charla de VERDAD. Viaja aparte para que el
      // modelo pueda decir «de eso ya no me acuerdo» en vez de contestar con el
      // turno más viejo que le quede a mano — que es lo que hacía, con total
      // seguridad y equivocándose (medido el 2026-08-22).
      const historyTotal = relevantes.length;
      const history = relevantes
        .slice(-CHAT_HISTORY_TURNS)
        .flatMap((t) => {
          // 🔴 LO QUE FALLÓ TAMBIÉN CUENTA. Esto filtraba a `status === "done"`,
          // así que una herramienta que falló no viajaba en el historial de
          // NINGUNA forma: el modelo no la veía fallar, la veía no existir. Y
          // unas líneas más abajo, las que sí viajaban se marcaban `ok: true` a
          // mano — o sea que el recuerdo que el modelo tiene de sus propios
          // turnos era «todo salió bien, siempre».
          //
          // Con eso, el turno siguiente vuelve a intentar exactamente lo que
          // acaba de no funcionar, y el modelo cierra contándole al usuario un
          // arreglo que nadie hizo. Ahora viaja lo que terminó —con su
          // resultado de verdad— y sólo se queda fuera lo que aún corría.
          const hechas = (t.actions ?? []).filter((a) => a.status !== "running");
          // El turno de OTRA pagina viaja etiquetado: el modelo necesita saber
          // que aquello no fue sobre el documento que tiene delante.
          const deOtraPagina = !samePage(t.page, turnPage);
          const etiqueta = deOtraPagina
            ? `[en la página "${t.page ?? "inicio"}"] `
            : "";
          const turno: HistoryEntry[] = [
            { role: "user", content: `${etiqueta}${t.userText}` },
            {
              role: "assistant",
              content: t.assistantReasoning || "",
              ...(hechas.length
                ? { functionCalls: hechas.map((a) => ({ name: a.tool, args: {} })) }
                : {}),
            },
          ];
          // El mensaje de respuestas va INMEDIATAMENTE después: el serializador
          // del proveedor empareja llamadas y respuestas por POSICIÓN, y una
          // respuesta sin llamada que la reclame degrada a texto suelto.
          if (hechas.length) {
            turno.push({
              role: "user",
              content: "",
              functionResponses: hechas.map((a) => ({
                name: a.tool,
                // El resultado DE VERDAD, no un `true` escrito a mano.
                response: { ok: a.status !== "error", resumen: a.summary },
              })),
            });
          }
          return turno;
        });

      // Snapshot the scope at send time — if the user clears or re-picks
      // mid-stream, the in-flight request keeps the original target. Shared
      // by both the agent and ai-design branches (F2 Task 8 parity).
      const turnScope = scopedSelection
        ? {
            hint: scopedSelection.hint,
            path: scopedSelection.path,
          }
        : null;
      // Same snapshot discipline for any attached image — the in-flight
      // request keeps the one that was set when Send fired.
      const turnImage = img ? { url: img.url, alt: img.alt } : null;

      // Agent mode (flag-gated) — talk to /api/agent instead of ai-design.
      // Same SSE reader/line-parse shape as below, different event dispatch:
      // `text` feeds the assistant prose, `action` upserts tool cards, `html`
      // refreshes the preview via the SAME onLocalUpdate path done.html uses.
      // Default ON post-graduation; "0" opts a browser back to classic
      // ai-design. On blocked storage we also default to the agent — it is
      // the product now; ai-design remains the explicit opt-out path.
      // F4 Task 7: `agentKilledThisSession` short-circuits this to false the
      // moment the server has told us (once) OPENLEN_AGENT=0 — every later
      // send in this browser session skips straight to ai-design, no repeat
      // round-trip to a route we already know refuses.
      let agentMode = !agentKilledThisSession;
      try {
        agentMode =
          agentMode &&
          (typeof window === "undefined" ||
            window.localStorage.getItem("ol:agent") !== "0");
      } catch {
        /* storage blocked — default stays agent; must not wedge the composer */
      }
      if (agentMode) {
        // F4: the agent is multi-page now (route validates `page` against
        // data.pages, tools write the active slot with W1 pins) — the
        // pre-flight home-only block that used to live here is gone.
        const abort = new AbortController();
        abortRef.current = abort;
        let accumulatedReasoning = "";
        // LO QUE ESCRIBISTE A MEDIA FAENA, para que sobreviva a un F5.
        //
        // El `↳` se pintaba sólo en el estado de React y `persistTurn` guardaba
        // `prompt` a secas, así que al recargar la transcripción volvía a ser
        // «hazla brutalista» seguido de un Len contestando que deshizo el
        // brutalista — exactamente el «escribes, desaparece, y le ves cambiar
        // de rumbo sin saber por qué» que el `↳` existe para evitar. Y pesa más
        // de lo que parece: esta transcripción es la que viaja como `history`
        // en los turnos siguientes, o sea que Len recordaba la instrucción que
        // el dueño retiró y no la que la sustituyó.
        const correcciones: string[] = [];
        let latestAgentHtml: string | null = null;
        // Cada evento `html` deja aquí la página que escribió. Es lo único que
        // permite saber, al cerrar el turno, si la única preimagen que tenemos
        // (la de `turnPage`) cubre de verdad lo que cambió.
        const paginasTocadas: (string | null)[] = [];
        // ¿El turno llegó a cambiar algo de forma DURABLE? Lo dice el servidor
        // en el terminal; `latestAgentHtml` es el respaldo para el caso en que
        // el `done` no llegue (la ruta reventó tras pintar el documento).
        let mutoDurable = false;
        // `null` = ninguna herramienta se pronunció (turnos de charla, de
        // ajustes, o herramientas que no tocan el documento). Sólo pasa a
        // `false` si alguna DIJO `sin_cambio` y ninguna dijo lo contrario: un
        // turno con dos edits, uno vacío y otro real, sí cambió la página.
        let huboCambioReal: boolean | null = null;

        let topeAlcanzado: "turn_limit" | "tool_limit" | null = null;
        /** Cuántos turnos vio Len de cuántos tiene la charla. Presente sólo
         *  cuando de verdad se quedó algo fuera de la ventana. */
        let ventana: { visibles: number; totales: number } | null = null;
        let errorMessage: string | null = null;
        // F4 Task 7 — set when the route's kill-switch fires (`code:
        // "agent_off"`): NOT an error to show the user, a signal to
        // silently re-run this exact turn through classic ai-design below.
        let fellBackToAiDesign = false;
        // Tracked alongside `upsertAction`'s React-state upsert (same rule,
        // via the shared `upsertActionInto` helper) so the turn's final card
        // states are available synchronously for `persistTurn` below —
        // reading them back off `turns` state here would race React's flush.
        let finalActions: AgentAction[] = [];
        try {
          scanController.start();
          const res = await fetch("/api/agent", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              projectId,
              prompt,
              history,
              historyTotal,
              // Same value + same conditional shape ai-design sends below —
              // absent/empty means home, cloned for parity.
              ...(turnPage ? { page: turnPage } : {}),
              ...(turnScope ? { scope: turnScope } : {}),
              ...(turnImage ? { attachedImage: turnImage } : {}),
            }),
            signal: abort.signal,
          });

          if (!res.ok || !res.body) {
            const errPayload = await res
              .json()
              .catch(() => ({ error: `HTTP ${res.status}` }));
            scanController.cancel();
            updateTurn(turnId, {
              status: "error",
              errorText:
                typeof errPayload?.error === "string"
                  ? errPayload.error
                  : t("errors.requestFailed", { status: res.status }),
            });
            return;
          }

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let sseBuf = "";

          agentOuter: while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            sseBuf += decoder.decode(value, { stream: true });
            let nl: number;
            while ((nl = sseBuf.indexOf("\n\n")) >= 0) {
              const block = sseBuf.slice(0, nl);
              sseBuf = sseBuf.slice(nl + 2);
              let evName = "message";
              let dataStr = "";
              for (const line of block.split("\n")) {
                if (line.startsWith("event: ")) {
                  evName = line.slice(7).trim();
                } else if (line.startsWith("data: ")) {
                  dataStr += line.slice(6);
                }
              }
              if (!dataStr) continue;
              let payload: unknown;
              try {
                payload = JSON.parse(dataStr);
              } catch {
                continue;
              }

              if (evName === "turno") {
                const id = strField(payload, "turnoId");
                if (id) turnoIdRef.current = id;
              } else if (evName === "direccion") {
                // LO QUE ESCRIBISTE A MEDIA FAENA, de vuelta por el stream. Se
                // pega al texto del turno para que quede EN LA CONVERSACION: si
                // no, escribes, desaparece, y ves al Agente cambiar de rumbo
                // sin saber por que.
                const texto = strField(payload, "texto");
                if (texto) {
                  correcciones.push(texto);
                  setTurns((prev) =>
                    prev.map((t) =>
                      t.id === turnId ? { ...t, userText: `${t.userText}\n↳ ${texto}` } : t,
                    ),
                  );
                }
              } else if (evName === "text") {
                const text = strField(payload, "text");
                if (text) {
                  appendReasoning(turnId, text);
                  accumulatedReasoning += text;
                }
              } else if (evName === "action") {
                const p = payload as {
                  tool?: unknown;
                  status?: unknown;
                  summary?: unknown;
                };
                const tool = typeof p.tool === "string" ? p.tool : "";
                const status =
                  p.status === "running" ||
                  p.status === "done" ||
                  p.status === "error"
                    ? p.status
                    : "done";
                // Cap to the transcript's persisted limit (chat route's
                // ActionSchema) — a model-written editar_pagina resumen can run
                // long, and an over-limit summary would 400 the whole
                // persistTurn and silently drop the turn on reload.
                const summary =
                  typeof p.summary === "string" ? p.summary.slice(0, 200) : "";
                // EL HECHO QUE EL SERVIDOR YA CONOCÍA. `cambio` sale de comparar
                // el documento por hash antes y después (`calcularCambio`), y
                // hasta hoy sólo se le contaba al modelo. Sin él, un turno que
                // no movió un byte pintaba «Aplicado · Deshacer» igual, porque
                // `updatedHtml` se emite siempre que la herramienta va bien.
                const cambio = strField(payload, "cambio");
                if (cambio === "cambio") huboCambioReal = true;
                else if (cambio === "sin_cambio" && huboCambioReal === null) {
                  huboCambioReal = false;
                }
                const edits = (payload as { edits?: unknown } | null)?.edits;
                const ops = (payload as { ops?: unknown } | null)?.ops;
                if (tool) {
                  const action: AgentAction = {
                    tool,
                    status,
                    summary,
                    // Cuelgan de la ACCIÓN porque es lo único del turno que se
                    // guarda como JSON — ver el comentario en `AgentAction`.
                    ...(typeof edits === "number" && Number.isFinite(edits) ? { edits } : {}),
                    ...(Array.isArray(ops) && ops.length ? { ops: ops as OpDescrita[] } : {}),
                  };
                  upsertAction(turnId, action);
                  finalActions = upsertActionInto(finalActions, action);
                }

              } else if (evName === "html") {
                const html = strField(payload, "html");
                if (html) {
                  latestAgentHtml = html;
                  // F4-T4: the html event carries its OWN page (loop.ts —
                  // outcome.page from session.page at write time), because
                  // trabajar_en_pagina can move the active document mid-turn:
                  // a later html event in the same turn may target a
                  // different page than the one the turn started on. Paint
                  // whichever slot the server says, not turnPage — any
                  // non-string payload.page (shouldn't happen; loop.ts always
                  // sends null or a string) falls back to home rather than
                  // silently dropping the paint.
                  const evPage =
                    payload &&
                    typeof payload === "object" &&
                    typeof (payload as { page?: unknown }).page === "string"
                      ? (payload as { page: string }).page
                      : null;
                  paginasTocadas.push(evPage);
                  scanController.applyDuring(() => onLocalUpdate(html, evPage));
                }
              } else if (evName === "confirm") {
                // The publish gate — attach a confirm card to this turn. It
                // stays interactive after the turn's `done` finalizes it (the
                // user's tap is the only thing that publishes). F2-T11:
                // intentionally never persisted — see the `persistTurn`
                // comment below for the decision.
                const c = payload as {
                  action?: unknown;
                  subdominio?: unknown;
                  idiomas?: unknown;
                  republicar?: unknown;
                };
                const subdominio =
                  typeof c.subdominio === "string" ? c.subdominio : "";
                if (c.action === "publicar" && subdominio) {
                  const idiomas = Array.isArray(c.idiomas)
                    ? c.idiomas.filter((x): x is string => typeof x === "string")
                    : [];
                  updateTurn(turnId, {
                    confirm: {
                      action: "publicar",
                      subdominio,
                      idiomas,
                      republicar: c.republicar === true,
                    },
                  });
                }
              } else if (evName === "done") {
                // Terminal — always finalizes the turn, even when it trails
                // an `error` event (the loop can emit both in one turn).
                // `mutoDurable`: alguna herramienta ya escribió en la base.
                if ((payload as { mutoDurable?: unknown } | null)?.mutoDurable === true) {
                  mutoDurable = true;
                }
                // SE QUEDÓ SIN CUERDA. El bucle agotó un tope y redactó un
                // cierre elegante, así que NO hay evento `error` y el turno
                // llegaba aquí pintado de verde sobre una faena a medias.
                const tope = (payload as { topeAlcanzado?: unknown } | null)?.topeAlcanzado;
                if (tope === "turn_limit" || tope === "tool_limit") topeAlcanzado = tope;
                // LA CONVERSACIÓN NO CABE ENTERA. Vienen los dos números y la
                // frase se compone aquí, en el idioma del usuario — el servidor
                // manda datos, no prosa.
                const v = (payload as { ventana?: unknown } | null)?.ventana;
                if (
                  v && typeof v === "object" &&
                  typeof (v as { visibles?: unknown }).visibles === "number" &&
                  typeof (v as { totales?: unknown }).totales === "number"
                ) {
                  ventana = v as { visibles: number; totales: number };
                }
                break agentOuter;
              } else if (evName === "error") {
                const code = (payload as { code?: unknown } | null)?.code;
                if (code === "agent_off") {
                  // F4 Task 7 — kill-switch: the route refused before doing
                  // any work and this is its only event (no `done` follows).
                  // Never show this to the user — flag it and stop reading;
                  // the fallback runs once the loop below exits.
                  fellBackToAiDesign = true;
                  agentKilledThisSession = true;
                  break agentOuter;
                }
                // Do NOT break — a `done` may still follow to close the turn.
                // F2-T10: prefer the localized string for a known `code`;
                // fall back to the server's Spanish `message` (exact prior
                // behavior) when the code is absent or unrecognized.
                errorMessage =
                  creditWallText(code, payload, locale, tAgent) ??
                  (isAgentErrorCode(code)
                    ? tAgent(`errors.${code}`)
                    : strField(payload, "message") || t("errors.generic"));
              }
            }
          }

          if (fellBackToAiDesign) {
            // F4 Task 7 — the SAME turn, the SAME abort controller, routed
            // through classic ai-design instead. No error surfaces; the
            // outer try/finally below still owns abortRef/sending cleanup.
            await runAiDesignTurn({
              turnId,
              prompt,
              preEditHtml,
              turnPage,
              history,
              historyTotal,
              turnScope,
              turnImage,
              abort,
            });
            return;
          }

          // UN TURNO QUE YA MUTÓ NO PUEDE TERMINAR EN ROJO.
          //
          // Una herramienta guarda y el stream siguiente se cae (503, cancelado
          // o max_tokens): el turno se pintaba rojo, no se persistía en la
          // transcripción y no dejaba Undo — con el cambio ya vivo en la base.
          // El usuario pulsaba «Reintentar» y aplicaba el mismo cambio DOS
          // veces. Es el mismo arreglo que el Chat clásico lleva desde el 24/08
          // (`cambioDurable` en ai-design); esta superficie se quedó sin él.
          const cierre = cierreDeTurno({
            errorMessage,
            // `errors.turn_limit` y `errors.tool_limit` ya existen en los 10
            // idiomas: el tope se contaba como error cuando lo era, y como nada
            // cuando el bucle cerraba con elegancia. Ahora se dice siempre.
            avisoDeTope: topeAlcanzado ? tAgent(`errors.${topeAlcanzado}`) : null,
            // El corte de la ventana, dicho con los dos números: «ve 12 de 20»
            // es algo que el usuario puede USAR —resumirle lo importante, o
            // empezar otra conversación—; «memoria recortada» es una disculpa.
            avisoDeVentana: ventana
              ? tAgent("ventana", { visibles: ventana.visibles, totales: ventana.totales })
              : null,
            mutoDurable,
            hayDocumentoNuevo: latestAgentHtml !== null,
          });
          if (cierre.kind === "error") {
            scanController.cancel();
            updateTurn(turnId, { status: "error", errorText: cierre.texto });
            return;
          }

          // Turn concluded well — the `done` event closed the SSE loop above
          // without a kill-switch or in-band error. Any still-pending
          // applyDuring() paint from the last `html` event (Rule 2) runs
          // immediately inside finish(); a turn with no `html` event at all
          // (leer_estado/charla) has no pending paint, so this is the bare
          // "close the busy state" pass the brief calls for.
          scanController.finish();
          updateTurn(turnId, {
            status: "applied",
            appliedAt: Date.now(),
            // ¿CAMBIÓ ALGO DE VERDAD? Dos correcciones, una sola condición.
            //
            // (a) Un `editar_pagina` que devuelve `sin_cambio` SEGUÍA emitiendo
            //     su evento `html` —`updatedHtml` se devuelve siempre que la
            //     herramienta va bien—, así que el pie pintaba «Aplicado ·
            //     Deshacer» sobre un turno que no movió un byte. Y Versiones no
            //     dejaba fila, porque `createVersion` deduplica por HTML
            //     idéntico: las dos superficies se contradecían y sólo una se
            //     ve desde el Chat. Ahora el servidor dice el hecho y se cree.
            //
            // (b) Al revés: `activar_modulo` y compañía mutan de forma durable
            //     SIN emitir html, y el pie decía «No cambió nada de la página»
            //     sobre un turno que sí cambió cosas. `mutoDurable` ya viajaba
            //     en el terminal y sólo se usaba para elegir rojo o ámbar.
            //
            // `noDocChange` deja de significar «no llegó html» y pasa a
            // significar lo que su etiqueta ya prometía: la página no cambió.
            ...(latestAgentHtml !== null ? { postEditHtml: latestAgentHtml } : {}),
            ...(huboCambioReal === false || (latestAgentHtml === null && !mutoDurable)
              ? { noDocChange: true }
              : {}),
            // Lo que el turno escribió DE VERDAD. `page` de abajo sigue siendo
            // la página en la que empezó (de donde viene la preimagen); estas
            // son las que tocó. Cuando no coinciden, Deshacer no puede cumplir.
            paginasTocadas: [...paginasTocadas],
            // Se guardó, pero el turno se cortó antes de cerrar. Aplicado CON
            // aviso: el cambio está y el usuario tiene que saber que quedó a
            // medias.
            ...(cierre.kind === "aplicado-con-aviso"
              ? { avisoTurno: cierre.aviso }
              : {}),
          });
          void persistTurn({
            id: turnId,
            // El mismo texto que se está viendo en pantalla — mismo `↳`, mismo
            // orden. Sin correcciones es `prompt` y nada más, byte a byte.
            userText: [prompt, ...correcciones.map((c) => `↳ ${c}`)].join("\n"),
            attachedImage: img ?? undefined,
            // El aviso viaja a la transcripción: al recargar, el turno tiene
            // que seguir contando que se cortó. Sin esto el usuario ve un turno
            // aplicado y limpio sobre un trabajo a medias.
            assistantReasoning:
              cierre.kind === "aplicado-con-aviso"
                ? `${accumulatedReasoning}${accumulatedReasoning ? "\n\n" : ""}${tAgent("cortado", { reason: cierre.aviso })}`
                : accumulatedReasoning,
            status: "applied",
            // F4-T4: parity with the ai-design branch below — pin to the
            // page the turn STARTED on (snapshotted at send time, same as
            // preEditHtml) so Undo PATCHes the same slot preEditHtml came
            // from. A mid-turn trabajar_en_pagina switch can make a later
            // `html` event target a different page (painted live via its own
            // `page` above); this turn-level bookkeeping intentionally still
            // anchors to turnPage, exactly like ai-design's single-page turns.
            page: turnPage,
            // F2-T11: persist the turn's final card states (a trailing
            // `running` card, if the stream ended mid-tool-call, persists
            // as-is — matches what the live turn showed). Confirm cards are
            // deliberately NOT included here: on restore a confirmed-publish
            // already produced its own persisted "✓ Publicada…" turn (see
            // handlePublished below), and an unconfirmed confirm card is
            // stale by the time of a reload — showing it as interactive again
            // would let a second, out-of-date publish tap fire.
            ...(finalActions.length > 0 ? { actions: finalActions } : {}),
            ...(latestAgentHtml === null ? { noDocChange: true } : {}),
          });
          notifyCreditBalanceChanged();
        } catch (err) {
          scanController.cancel();
          if (abort.signal.aborted) {
            updateTurn(turnId, {
              status: "error",
              errorText: t("errors.cancelled"),
            });
          } else {
            updateTurn(turnId, {
              status: "error",
              errorText:
                err instanceof Error ? err.message : t("errors.network"),
            });
          }
        } finally {
          if (abortRef.current === abort) abortRef.current = null;
          setSending(false);
        }
        return;
      }

      const abort = new AbortController();
      abortRef.current = abort;
      try {
        await runAiDesignTurn({
          turnId,
          prompt,
          preEditHtml,
          turnPage,
          history,
          historyTotal,
          turnScope,
          turnImage,
          abort,
        });
      } finally {
        if (abortRef.current === abort) abortRef.current = null;
        setSending(false);
      }
    },
    [
      appendReasoning,
      attachedImage,
      onClearScope,
      onLocalUpdate,
      persistTurn,
      projectId,
      runAiDesignTurn,
      scopedSelection,
      sending,
      t,
      tAgent,
      updateTurn,
      upsertAction,
    ],
  );

  const handleRetry = useCallback(
    (turn: DesignTurn) => {
      setTurns((prev) => prev.filter((t) => t.id !== turn.id));
      // Re-send with the turn's ORIGINAL image (the live composer was cleared
      // after the first send), so a vision/image edit retries as the same request.
      void send(turn.userText, turn.attachedImage ?? null);
    },
    [send],
  );

  const handleCancel = useCallback(() => {
    // Aborting triggers the catch branch in `send`, which marks the turn
    // as error with text "Cancelled." and reverts any partial iframe drip.
    abortRef.current?.abort();
  }, []);

  const handleUndo = useCallback(
    async (turn: DesignTurn) => {
      // Una sola decisión, la misma que pinta el botón (ver TurnFooter):
      // turno aplicado, con preimagen, y sin haber tocado otra página.
      // Restored (pre-reload) turns carry no preEditHtml — their revisions
      // are reachable via the Versions tab, not this inline Undo.
      const plan = planDeUndo(turn, pageRef.current ?? null);
      if (plan.kind !== "restaurar") return;
      if (turn.undoEnCurso) return;

      updateTurn(turn.id, { undoEnCurso: true, undoFallo: undefined });
      // El PATCH va PRIMERO. Antes se pintaba y se decía «Revertido» de
      // entrada, y la respuesta se tiraba: un 401/404/413/500 resuelve el
      // `fetch` con normalidad, así que ni siquiera había excepción que
      // capturar. La página volvía sólo en el iframe y el cambio reaparecía
      // al recargar. Ahora nada se afirma hasta que el servidor lo confirma.
      const ok = await ejecutarUndo(plan, {
        projectId,
        // Envuelto, no `fetch` a pelo: desatado del `window` algunos motores
        // lo rechazan con «Illegal invocation».
        fetchImpl: (...args) => fetch(...args),
        pintar: (html, page) => onLocalUpdate(html, page),
        marcarRevertido: () =>
          updateTurn(turn.id, { status: "reverted", undoEnCurso: false }),
        marcarFallo: (fallo) =>
          updateTurn(turn.id, { undoEnCurso: false, undoFallo: fallo }),
      });
      if (!ok) return;
      try {
        await fetch(`/api/projects/${projectId}/chat`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ turnId: turn.id, status: "reverted" }),
        });
        onChatChangeRef.current?.();
      } catch {
        /* soft */
      }
    },
    [onLocalUpdate, projectId, updateTurn],
  );

  // Publish gate success — the AgentConfirmCard tapped through and the real
  // endpoint published. Append a local assistant turn ("✓ Publicada …") AND
  // persist it so the confirmation survives a reload (the card itself is
  // ephemeral, rebuilt from the SSE `confirm` event and gone on reload).
  const handlePublished = useCallback(
    (url: string) => {
      const noteId =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `pub-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const userText = tAgent("confirm.publish");
      const assistantReasoning = tAgent("confirm.published", { url });
      setTurns((prev) => [
        ...prev,
        {
          id: noteId,
          userText,
          assistantReasoning,
          status: "applied",
          preEditHtml: "",
          page: null,
          noDocChange: true,
          appliedAt: Date.now(),
        },
      ]);
      void persistTurn({
        id: noteId,
        userText,
        assistantReasoning,
        status: "applied",
        page: null,
        // F2-T11: this synthetic note never touches a document either — same
        // suppression rule as the agent-branch persistTurn above.
        noDocChange: true,
      });
    },
    [persistTurn, tAgent],
  );

  // Latest turn is "streaming" but reasoning hasn't started — the AI bubble
  // would render empty, so swap it for the typing-dots bubble instead.
  const latest = turns[turns.length - 1];
  const showThinkingDots =
    sending &&
    latest &&
    latest.status === "streaming" &&
    latest.assistantReasoning.length === 0 &&
    (latest.actions?.length ?? 0) === 0;

  return (
    <div className="flex flex-col h-full">
      <MemoriaDeLen projectId={projectId} />
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto nice-scroll px-3 py-3 space-y-3"
      >
        {turns.length === 0 ? (
          <EmptyState onPick={(p) => setDraft(p)} disabled={sending} />
        ) : (
          turns.map((t) => (
            <TurnView
              key={t.id}
              turn={t}
              paginaActual={page ?? null}
              projectId={projectId}
              onUndo={handleUndo}
              onRetry={handleRetry}
              onCancel={handleCancel}
              onPublished={handlePublished}
              hideAIBubble={t.id === latest?.id && showThinkingDots}
            />
          ))
        )}
        {showThinkingDots && <ThinkingBubble />}
      </div>
      <Composer
        value={draft}
        onChange={setDraft}
        onSubmit={() => {
          // EL BOTON SIGUE A LA CAJA. Con el turno corriendo, lo que escribes
          // no abre otro turno: corrige el que hay. Sin texto no se llega aqui
          // — ahi el boton es el cuadrado y llama a `onStop`.
          if (sending) {
            const texto = draft.trim();
            const turnoId = turnoIdRef.current;
            if (!texto || !turnoId) return;
            // NO SE LIMPIA POR ADELANTADO. La primera version limpiaba la caja
            // y devolvia el texto desde un `.catch` — pero `.catch` solo salta
            // con un fallo de RED: un 404 (el turno acabo entre tu clic y la
            // peticion) se resuelve bien, el catch no corre, y tu correccion
            // desaparecia sin decir nada. Justo lo que el comentario presumia
            // de evitar.
            //
            // Se limpia SOLO cuando el servidor confirma. Si algo falla, el
            // texto se queda donde estaba: verlo seguir ahi es el aviso.
            void fetch("/api/agent/dirigir", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ turnoId, texto }),
            })
              .then((r) => {
                // Y solo si no has seguido escribiendo mientras iba.
                if (r.ok) setDraft((d) => (d.trim() === texto ? "" : d));
              })
              .catch(() => {});
            return;
          }
          void send(draft);
        }}
        onStop={() => abortRef.current?.abort()}
        sending={sending}
        textareaRef={taRef}
        sectionSelectMode={sectionSelectMode}
        onToggleSectionSelect={onToggleSectionSelect}
        scopedSelection={scopedSelection}
        onClearScope={onClearScope}
        onAutofill={onAutofill}
        attachedImage={attachedImage}
        onAttachImage={() => setImageModalOpen(true)}
        onClearAttachedImage={() => setAttachedImage(null)}
        agentMode={agentModeUI}
      />
      <ReplaceAssetModal
        open={imageModalOpen}
        kind={imageModalOpen ? "image" : null}
        projectId={projectId}
        onClose={() => setImageModalOpen(false)}
        onPick={(payload) => {
          if (payload.url) {
            setAttachedImage({
              url: payload.url,
              alt: payload.alt,
            });
          }
          setImageModalOpen(false);
        }}
      />
    </div>
  );
}

function EmptyState({
  onPick,
  disabled,
}: {
  onPick: (prompt: string) => void;
  disabled: boolean;
}) {
  const t = useTranslations("panelsChat");
  return (
    <div className="pt-2">
      <div className="text-center mb-4">
        <div className="mx-auto mb-2.5 inline-flex h-9 w-9 items-center justify-center rounded-md ring-1 ring-[color:var(--border)] bg-elev text-accent">
          <LenMark size={15} />
        </div>
        <h3 className="text-[14px] font-semibold fg leading-tight">
          {t("empty.title")}
        </h3>
        <p className="mt-1 text-[11px] fg-faint leading-relaxed">
          {t("empty.subtitle")}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {QUICK_PROMPT_KEYS.map((key) => {
          const label = t(key);
          return (
            <button
              key={key}
              type="button"
              disabled={disabled}
              onClick={() => onPick(label)}
              className="text-left text-[11.5px] fg leading-tight px-2.5 py-2 rounded-md ring-1 ring-[color:var(--border)] bg-[color:var(--bg)] hover:bg-hover hover:ring-[color:var(--border-strong)] transition disabled:opacity-50"
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TurnView({
  turn,
  paginaActual,
  projectId,
  onUndo,
  onRetry,
  onCancel,
  onPublished,
  hideAIBubble,
}: {
  turn: DesignTurn;
  /** Página que muestra el lienzo ahora — sólo la usan los turnos
   *  pre-multipágina, que no traen `page` propio. */
  paginaActual: string | null;
  projectId: string;
  onUndo: (turn: DesignTurn) => void;
  onRetry: (turn: DesignTurn) => void;
  onCancel: () => void;
  onPublished: (url: string) => void;
  hideAIBubble: boolean;
}) {
  const t = useTranslations("panelsChat");
  // DE QUÉ PÁGINA FUE ESTE TURNO.
  //
  // La charla es una sola para todo el sitio, así que en un sitio de tres
  // páginas los turnos se mezclan. Al modelo eso ya se le dice —el turno viaja
  // etiquetado con su slug— y al usuario había que decírselo también, o
  // unificar la charla cambia una confusión por otra.
  //
  // Sólo se marca lo que NO es la página que estás mirando: marcarlo todo sería
  // ruido en el caso corriente, que es un sitio de una página.
  const paginaDelTurno = turn.page ?? paginaActual;
  const deOtraPagina = !mismaPagina(turn.page, paginaActual);
  return (
    <div className="space-y-2">
      {deOtraPagina && (
        <div className="flex justify-end">
          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] ui-small fg-faint border bd">
            {paginaDelTurno ? `/${paginaDelTurno}` : t("turn.homePage")}
          </span>
        </div>
      )}
      <div className="flex gap-2 flex-row-reverse">
        <span className="shrink-0 inline-flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold bg-gradient-to-br from-[#FF7E55] to-[#C72E10] text-white">
          J
        </span>
        <div className="min-w-0 max-w-[80%] text-right">
          <div className="inline-block max-w-full rounded-2xl px-3 py-2 text-left bg-accent-soft text-accent border border-[color:var(--accent)]/30">
            {turn.attachedImage && (
              <div className="mb-1.5 flex items-center gap-1.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={turn.attachedImage.url}
                  alt=""
                  className="h-9 w-9 rounded object-cover ring-1 ring-[color:var(--accent)]/30"
                />
                <span className="text-[10px] fg-faint ui-small">
                  {t("turn.imageSent")}
                </span>
              </div>
            )}
            {turn.scope && (
              <div className="mb-1.5 flex items-center gap-1.5">
                <Crosshair size={11} className="shrink-0 text-accent" />
                <span className="truncate font-mono text-[10.5px] fg-faint ui-small min-w-0">
                  {turn.scope.hint}
                </span>
              </div>
            )}
            <div className="text-[12.5px] fg leading-relaxed whitespace-pre-wrap break-words">
              {turn.userText}
            </div>
          </div>
        </div>
      </div>

      {!hideAIBubble && (
        <div className="flex gap-2">
          <span className="shrink-0 inline-flex h-6 w-6 items-center justify-center text-[var(--accent-strong)]">
            <LenMark size={22} />
          </span>
          <div className="min-w-0 max-w-[85%] space-y-1.5">
            {turn.actions && turn.actions.length > 0 && (
              <div className="space-y-1">
                {turn.actions.map((a, i) => (
                  <AgentActionCard key={`${a.tool}-${i}`} action={a} />
                ))}
              </div>
            )}
            <div className="inline-block max-w-full rounded-2xl px-3 py-2 text-left bg-elev border bd">
              {turn.assistantReasoning.length > 0 && (
                <div className="text-[12.5px] fg leading-relaxed whitespace-pre-wrap break-words">
                  {turn.assistantReasoning}
                </div>
              )}
              <TurnFooter
                turn={turn}
                paginaActual={paginaActual}
                onUndo={onUndo}
                onRetry={onRetry}
                onCancel={onCancel}
                hasText={turn.assistantReasoning.length > 0}
              />
            </div>
            {turn.confirm && (
              <AgentConfirmCard
                projectId={projectId}
                confirm={turn.confirm}
                onPublished={onPublished}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function TurnFooter({
  turn,
  paginaActual,
  onUndo,
  onRetry,
  onCancel,
  hasText,
}: {
  turn: DesignTurn;
  paginaActual: string | null;
  onUndo: (turn: DesignTurn) => void;
  onRetry: (turn: DesignTurn) => void;
  onCancel: () => void;
  hasText: boolean;
}) {
  const t = useTranslations("panelsChat");
  const marginClass = hasText ? "mt-2" : "";
  if (turn.status === "streaming") {
    const elapsedSec = turn.startedAt
      ? Math.max(0, Math.floor((Date.now() - turn.startedAt) / 1000))
      : 0;
    const chars = turn.streamedChars ?? 0;
    const phaseLabel =
      chars > 0
        ? t("streaming.writingPage", { chars: formatChars(chars, t) })
        : t("streaming.designing");
    return (
      <div
        className={`${marginClass} inline-flex items-center gap-2 rounded-md bg-app border bd px-1.5 py-0.5 text-[10.5px] fg-faint ui-small`}
      >
        <Loader size={10} className="animate-spin text-[var(--accent)]" />
        <span>{phaseLabel}</span>
        <span className="fg-faint tabular">· {elapsedSec}s</span>
        <button
          type="button"
          onClick={onCancel}
          className="text-accent hover:underline"
        >
          {t("streaming.cancel")}
        </button>
      </div>
    );
  }
  if (turn.status === "applied") {
    // Turno del Agente que no cambió el documento. «Aplicado · Deshacer»
    // serían los verbos equivocados — pero CALLAR era peor.
    //
    // MEDIDO el 2026-08-22: el Agente puede responder «Listo ✅ añadí el
    // teléfono en el pie» sin haber llamado a una sola herramienta, y la página
    // queda intacta. El usuario lee «Listo ✅» y se lo cree. `noDocChange` ya
    // se calculaba y su único efecto era esconder el botón.
    //
    // Se dice en TODO turno sin cambios, incluidos los que sólo responden una
    // pregunta: ahí también es verdad y no estorba. Juzgar la prosa para
    // adivinar si «prometió» algo sería adivinar; esto es un hecho.
    if (turn.noDocChange) {
      return (
        <div className={marginClass}>
          <div className="inline-flex items-center gap-1.5 rounded-md bg-app border bd px-1.5 py-0.5 text-[10.5px] fg-faint ui-small">
            <span>{t("noChange.label")}</span>
          </div>
          <AvisoDeTurno texto={turn.avisoTurno} />
        </div>
      );
    }
    // La MISMA llamada que ejecuta el Deshacer decide si el botón se pinta —
    // no dos condiciones que puedan discrepar. Sin preimagen (turno restaurado
    // de otra sesión) o con otra página tocada, no hay botón: en el primer caso
    // no hay nada que restaurar, en el segundo restaurar sería mentir.
    const plan = planDeUndo(turn, paginaActual);
    return (
      <div className={marginClass}>
        <div className="inline-flex items-center gap-2 rounded-md bg-app border bd px-1.5 py-0.5 text-[10.5px] fg-faint ui-small">
          <Wand size={10} className="text-[var(--accent)]" />
          <span>
            {edicionesDelTurno(turn)
              ? t("applied.labelConEdits", {
                  edits: edicionesDelTurno(turn),
                  time: relativeTime(turn.appliedAt ?? Date.now(), t),
                })
              : t("applied.label", {
                  time: relativeTime(turn.appliedAt ?? Date.now(), t),
                })}
          </span>
          {plan.kind === "restaurar" && (
            <button
              type="button"
              onClick={() => onUndo(turn)}
              disabled={turn.undoEnCurso === true}
              className="text-accent hover:underline disabled:opacity-50 disabled:no-underline"
            >
              {turn.undoEnCurso ? t("applied.undoing") : t("applied.undo")}
            </button>
          )}
        </div>
        <CambiosDelTurno turn={turn} mismaPagina={plan.kind !== "imposible" || plan.motivo !== "otra-pagina"} />
        {plan.kind === "imposible" && plan.motivo === "otra-pagina" && (
          // Fuera de la píldora: dentro la partía en dos líneas y dejaba
          // «Aplicado · justo ahora» apelotonado en una barra de 380px.
          <div className="mt-1 text-[10.5px] fg-faint leading-snug break-words max-w-full">
            {t("applied.otherPage")}
          </div>
        )}
        <AvisoDeTurno texto={turn.avisoTurno} />
        {turn.undoFallo && (
          <div className="mt-1 flex items-start gap-1.5 rounded-md ring-1 ring-red-500/40 bg-red-500/5 px-2 py-1 text-[11px] text-red-600 dark:text-red-400 max-w-full">
            <X size={11} className="mt-0.5 shrink-0" />
            <span className="flex-1 break-words">
              {turn.undoFallo.motivo === "red"
                ? t("undo.failedNetwork")
                : t("undo.failedHttp", { status: turn.undoFallo.status })}
            </span>
          </div>
        )}
      </div>
    );
  }
  if (turn.status === "reverted") {
    return (
      <div
        className={`${marginClass} inline-flex items-center gap-1.5 rounded-md bg-app border bd px-1.5 py-0.5 text-[10.5px] fg-faint ui-small`}
      >
        {t("reverted")}
      </div>
    );
  }
  return (
    <div
      className={`${marginClass} inline-flex items-start gap-1.5 rounded-md ring-1 ring-red-500/40 bg-red-500/5 px-2 py-1 text-[11px] text-red-600 dark:text-red-400 max-w-full`}
    >
      <X size={11} className="mt-0.5 shrink-0" />
      <span className="flex-1 break-words">
        {turn.errorText ?? t("errors.generic")}
      </span>
      <button
        type="button"
        onClick={() => onRetry(turn)}
        className="shrink-0 underline hover:opacity-80"
      >
        {t("error.retry")}
      </button>
    </div>
  );
}

/** El turno cambió la página y luego se cortó. Ámbar, no rojo: no es un fallo
 *  del cambio —está hecho— sino del cierre. Rojo mandaría a repetirlo. */
function AvisoDeTurno({ texto }: { texto?: string }) {
  const t = useTranslations("panelsChat");
  if (!texto) return null;
  return (
    <div className="mt-1 flex items-start gap-1.5 rounded-md ring-1 ring-amber-500/40 bg-amber-500/5 px-2 py-1 text-[11px] text-amber-700 dark:text-amber-400 max-w-full">
      <TriangleAlert size={11} className="mt-0.5 shrink-0" />
      <span className="flex-1 break-words">{t("cutShort", { reason: texto })}</span>
    </div>
  );
}

function ThinkingBubble() {
  return (
    <div className="flex gap-2">
      <span className="shrink-0 inline-flex h-6 w-6 items-center justify-center text-[var(--accent-strong)]">
        <LenMark size={22} />
      </span>
      <div className="inline-flex items-center gap-1.5 rounded-2xl px-3 py-2.5 bg-elev border bd">
        <span
          className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] pulse-soft"
          style={{ animationDelay: "0ms" }}
        />
        <span
          className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] pulse-soft"
          style={{ animationDelay: "180ms" }}
        />
        <span
          className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] pulse-soft"
          style={{ animationDelay: "360ms" }}
        />
      </div>
    </div>
  );
}

function Composer({
  value,
  onChange,
  onSubmit,
  onStop,
  sending,
  textareaRef,
  sectionSelectMode = false,
  onToggleSectionSelect,
  scopedSelection = null,
  onClearScope,
  onAutofill,
  attachedImage = null,
  onAttachImage,
  onClearAttachedImage,
  agentMode = false,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  /** Detener el turno en marcha. Se llama cuando la caja esta VACIA y el turno
   *  corre: sin nada que decir, lo unico que se puede querer es parar. */
  onStop?: () => void;
  sending: boolean;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  sectionSelectMode?: boolean;
  onToggleSectionSelect?: (active: boolean) => void;
  scopedSelection?: ScopedSelection | null;
  onClearScope?: () => void;
  onAutofill?: () => void;
  attachedImage?: AttachedImage | null;
  onAttachImage?: () => void;
  onClearAttachedImage?: () => void;
  /** Modo Agente. Aqui decia ademas que "esconde el ModelPicker": ese selector
   *  y todo su cableado salieron el 2026-08-28. Sigue existiendo porque cambia
   *  otras cosas de esta barra. */
  agentMode?: boolean;
}) {
  const t = useTranslations("panelsChat");
  return (
    <div className="shrink-0 px-3 pb-3">
      {scopedSelection && (
        <div className="mb-1.5 inline-flex items-center gap-1.5 max-w-full rounded-md ring-1 ring-[color:var(--accent)]/40 bg-accent-soft px-2 py-1 text-[11px] text-accent ui-small fade-in">
          <Crosshair size={11} />
          <span className="font-medium shrink-0">{t("composer.scoped")}</span>
          <span className="truncate font-mono text-[10.5px] min-w-0">
            {scopedSelection.hint}
          </span>
          <button
            type="button"
            onClick={onClearScope}
            aria-label={t("composer.clearScope")}
            className="shrink-0 inline-flex h-4 w-4 items-center justify-center rounded hover:bg-[color:var(--accent)]/20 transition"
          >
            <X size={10} />
          </button>
        </div>
      )}
      {attachedImage && (
        <div className="mb-1.5 inline-flex items-center gap-1.5 max-w-full rounded-md ring-1 ring-[color:var(--accent)]/40 bg-accent-soft pl-1 pr-2 py-1 text-[11px] text-accent ui-small fade-in">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={attachedImage.url}
            alt=""
            className="h-5 w-5 rounded object-cover"
          />
          <span className="font-medium shrink-0">{t("composer.image")}</span>
          <span className="truncate font-mono text-[10.5px] min-w-0">
            {attachedImage.alt || displayUrl(attachedImage.url)}
          </span>
          <button
            type="button"
            onClick={onClearAttachedImage}
            aria-label={t("composer.removeImage")}
            className="shrink-0 inline-flex h-4 w-4 items-center justify-center rounded hover:bg-[color:var(--accent)]/20 transition"
          >
            <X size={10} />
          </button>
        </div>
      )}
      <div className="rounded-xl border bd bg-elev focus-within:border-[color:var(--accent)] focus-within:ring-1 focus-within:ring-[color:var(--accent-ring)]/30 transition">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSubmit();
            }
          }}
          rows={1}
          placeholder={
            sending
              ? t("composer.placeholderRunning")
              : scopedSelection
              ? t("composer.placeholderScoped", {
                  target: scopedSelection.hint.split(" ")[0],
                })
              : t("composer.placeholder")
          }
          className="block w-full bg-transparent text-[12.5px] leading-relaxed px-3 pt-2.5 pb-1 fg placeholder:fg-faint focus:outline-none resize-none nice-scroll disabled:opacity-60"
          style={{ minHeight: 32 }}
        />
        <div className="flex items-center justify-between px-1.5 pb-1.5 pt-0.5">
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              aria-label={t("composer.attachImage")}
              title={t("composer.attachImageTitle")}
              onClick={onAttachImage}
              disabled={sending || !onAttachImage}
              className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition disabled:opacity-40 ${
                attachedImage
                  ? "bg-[var(--accent-strong)] text-white shadow-coral"
                  : "fg-faint hover:fg hover:bg-hover"
              }`}
            >
              <ImageIcon size={13} />
            </button>
            {onToggleSectionSelect && (
              <button
                type="button"
                aria-label={
                  sectionSelectMode
                    ? t("composer.cancelSelection")
                    : t("composer.selectSection")
                }
                title={
                  sectionSelectMode
                    ? t("composer.cancelSelectionTitle")
                    : t("composer.selectSectionTitle")
                }
                onClick={() => onToggleSectionSelect(!sectionSelectMode)}
                disabled={sending}
                className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition disabled:opacity-40 ${
                  sectionSelectMode
                    ? "bg-[var(--accent-strong)] text-white shadow-coral"
                    : "fg-faint hover:fg hover:bg-hover"
                }`}
              >
                <Crosshair size={13} />
              </button>
            )}
            {/* EL SELECTOR DE MODELOS SE RETIRO (2026-08-28) — ensenaba «Gemini
                3.1 Pro» y «Gemini 3.5 Flash», y las dos cosas eran mentira:

                · Gemini no corria por defecto en NINGUNA superficie.
                · La eleccion no viajaba. Solo la rama de Gemini pasaba `model`
                  al proveedor; la de Fireworks —la que corre— lo ignoraba. Y en
                  modo Agente, que es el defecto, ni se pintaba.

                O sea: un control que nombraba un proveedor apagado y no hacia
                nada, en un repo publico donde cualquiera lo comprueba.

                Primero se quito el RENDER y el cableado se dejo inerte, con una
                nota que decia «arrancarlo entero es otra pasada». Esa pasada es
                este cambio: fuera `useAIModel`, `body.model` y el fichero
                `model-picker.tsx`. Un cableado inerte no es neutral —se lee como
                una funcion que existe— y el siguiente que lo encuentre no va a
                tener este comentario delante. */}
            {onAutofill && (
              <>
                <span
                  aria-hidden
                  className="h-4 w-px shrink-0 bg-[color:var(--border)] mx-1"
                />
                <button
                  type="button"
                  aria-label={t("composer.autofill")}
                  title={t("composer.autofillTitle")}
                  onClick={onAutofill}
                  disabled={sending}
                  className="shrink-0 inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11.5px] font-medium fg-faint hover:fg hover:bg-hover hover:ring-1 hover:ring-[color:var(--border)] transition disabled:opacity-40"
                >
                  <WandSparkles size={13} />
                  <span>{t("composer.autofillLabel")}</span>
                </button>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={sending && !value.trim() ? onStop : onSubmit}
            disabled={!sending && !value.trim()}
            aria-label={
              sending
                ? value.trim()
                  ? t("composer.steer")
                  : t("composer.stop")
                : t("composer.send")
            }
            className={`inline-flex items-center justify-center gap-1 h-7 rounded-md text-[11.5px] font-medium transition ${
              value.trim()
                ? "px-2.5 bg-[var(--accent-strong)] text-white shadow-coral hover:brightness-105"
                : sending
                  ? "w-7 bg-hover fg hover:brightness-110"
                  : "w-7 bg-hover fg-faint cursor-not-allowed"
            }`}
          >
            {/* EL BOTON SIGUE A LA CAJA: vacia y corriendo = cuadrado que
                detiene; con texto = flecha que corrige el rumbo sin parar. Asi
                nunca hay dos botones ni hay que elegir — la caja dice lo que
                quieres. */}
            {value.trim() ? (
              <>
                <SendUp size={12} />{" "}
                <span>{sending ? t("composer.steer") : t("composer.send")}</span>
              </>
            ) : sending ? (
              <Detener size={12} />
            ) : (
              <SendUp size={13} />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ⚰️ AQUÍ VIVÍA `ChatPageBar` — el selector de página encima del chat, del
// 2026-06-16 (`a1876a1f`). Retirado el 2026-08-30 a petición de Jesús.
//
// Lo reemplazó una superficie mejor y más completa: el AddressBar sobre el
// lienzo (`address-bar.tsx` + `panels/site-pages-panel.tsx`, del 2026-08-27),
// que además de cambiar de página CREA y BORRA. La barra del chat quedó
// vestigial dos meses y, peor, MENTÍA: cuando el Agente se movía solo con
// `trabajar_en_pagina` nada la sincronizaba de vuelta, así que podía decir
// «Inicio» mientras el modelo escribía en /menu.
//
// Y su motivo original ya no existía: el chat se partía por página hasta el
// 2026-08-26 (`e201941a`), cuando la conversación pasó a ser UNA sola para
// todo el proyecto. Elegir página desde el chat dejó de significar nada.
//
// LO QUE SE PIERDE, dicho porque es real: en móvil el sidebar es overlay a
// pantalla completa (`left-sidebar.tsx`, `max-md:absolute inset-0`), así que
// con el chat abierto el AddressBar no se ve y hay que cerrarlo para cambiar
// de página. Decisión de Jesús, tomada con el dato delante. El arreglo de
// verdad no era conservar esto: es que el chat en móvil no tape el AddressBar.

function restoreTurn(s: StoredChatTurn): DesignTurn {
  return {
    id: s.id,
    userText: s.userText,
    attachedImage: s.attachedImage,
    assistantReasoning: s.assistantReasoning,
    status: s.status,
    errorText: s.errorText,
    // No HTML snapshot persisted — empty preEditHtml hides the inline Undo.
    preEditHtml: "",
    appliedAt: s.appliedAt,
    page: s.page,
    // F2-T11: both absent on pre-F2 rows and on every ai-design turn — the
    // TurnFooter and TurnView already treat undefined exactly like "false"/
    // "no cards", so this restores byte-for-byte identical to today for
    // those. Agent-mode rows carrying them now rehydrate the same cards and
    // the same "no Applied verb" suppression the live turn had.
    // F3-T5: a persisted "running" card means the turn died mid-tool-call —
    // nothing will ever flip it to done/error. Restoring it as "running"
    // would show a spinner that spins forever; map it to "error" so a
    // reload reads as the honest dead state instead.
    actions: s.actions?.map((a) =>
      a.status === "running" ? { ...a, status: "error" as const } : a,
    ),
    noDocChange: s.noDocChange,
  };
}

// Pull a string field off an unknown SSE payload, "" when absent/non-string.
function strField(payload: unknown, key: string): string {
  if (!payload || typeof payload !== "object") return "";
  const v = (payload as Record<string, unknown>)[key];
  return typeof v === "string" ? v : "";
}

// F2-T10: the agent's `error` events carry an optional `code` the panel can
// localize (`wsPage.agent.errors.<code>`) instead of showing the server's
// Spanish `message` verbatim. This Record<AgentErrorCode, true> is the
// type-level exhaustiveness check — if the union in lib/agent/loop.ts gains
// a member without a matching entry here, this literal fails to typecheck.
// F4 Task 7: `agent_off` is a member of the union purely for this
// exhaustiveness check — the SSE loop above intercepts it BEFORE calling
// isAgentErrorCode (it triggers the silent ai-design fallback instead), so
// `tAgent("errors.agent_off")` is never actually called and no matching key
// exists in wsPage.json.
const AGENT_ERROR_CODE_KEYS: Record<AgentErrorCode, true> = {
  turn_limit: true,
  tool_limit: true,
  cancelled: true,
  truncated: true,
  upstream: true,
  no_credits: true,
  agent_off: true,
};

function isAgentErrorCode(value: unknown): value is AgentErrorCode {
  return typeof value === "string" && value in AGENT_ERROR_CODE_KEYS;
}

type Translator = ReturnType<typeof useTranslations<"panelsChat">>;
type AgentTranslator = ReturnType<typeof useTranslations<"wsPage.agent">>;

// The credit wall is the one server error whose date is per-user, so the
// server sends `refillsAt` as an instant instead of baking it into Spanish
// prose. Both surfaces (Agent and classic ai-design) come through here, and
// the pill formats the same instant — so the two never name different days.
function creditWallText(
  code: unknown,
  payload: unknown,
  locale: string,
  tAgent: AgentTranslator,
): string | null {
  return noCreditsText(code, payload, locale, (key, values) =>
    values ? tAgent(`errors.${key}`, values) : tAgent(`errors.${key}`),
  );
}

function formatChars(n: number, t: Translator): string {
  if (n < 1000) return t("chars.count", { count: n });
  return t("chars.thousands", { count: (n / 1000).toFixed(1) });
}

function displayUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const path = u.pathname + (u.search || "");
    return u.host + (path.length > 24 ? path.slice(0, 24) + "…" : path);
  } catch {
    return raw.length > 40 ? raw.slice(0, 40) + "…" : raw;
  }
}

function relativeTime(ms: number, t: Translator): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (diffSec < 5) return t("relativeTime.justNow");
  if (diffSec < 60) return t("relativeTime.seconds", { count: diffSec });
  const min = Math.floor(diffSec / 60);
  if (min < 60) return t("relativeTime.minutes", { count: min });
  const hr = Math.floor(min / 60);
  if (hr < 24) return t("relativeTime.hours", { count: hr });
  const d = Math.floor(hr / 24);
  return t("relativeTime.days", { count: d });
}

// LA MEMORIA DE LEN — las DOS mitades, en un solo sitio y siempre alcanzable.
//
// Len recuerda en dos sitios y hasta hoy no se veía NINGUNO:
//
//   · `users.agentMemory` — de la PERSONA, cruza todos sus proyectos. Es lo que
//     `recordar_preferencia` escribe por DEFECTO (alcance="siempre").
//     `forgetAboutUser` existía desde el principio diciendo «el borrado es del
//     dueño» y no tenía UN SOLO LLAMADOR en el repo.
//   · `projects.userBrief` — de ESTA página. Se le inyecta al Agente como
//     «PROJECT BRIEF (persistente — aplica a toda petición)». Sólo lo escribía
//     el modelo, sólo lo leía el modelo, y mandaba sobre cada petición del
//     usuario sin que él supiera que existe.
//
// POR QUÉ JUNTAS. Separarlas es exactamente lo que nos trajo aquí: había DOS
// paneles de brief (`panels/brief-panel.tsx` y `panels/ai-brief-panel.tsx`) y
// los dos acabaron con CERO importadores, invisibles, mientras el prompt seguía
// mandando al usuario a «la pestaña Brief». Una sola cosa, un solo sitio.
//
// POR QUÉ AQUÍ Y NO EN EL RAIL. El rail está podado a propósito —su historia
// entera es QUITAR iconos porque «un icono cobra un sitio permanente»— y no es
// mío re-decidirlo. El Chat es donde Len dice «guardé tu preferencia», así que
// es donde tiene sentido poder retirarla.
//
// POR QUÉ NO EN EL ESTADO VACÍO, que es donde estuvo primero: ahí sólo se ve
// con la conversación en blanco, y el momento en que el usuario NECESITA podar
// es cuando la herramienta le dice que el brief está lleno — a mitad de
// conversación, con el estado vacío ya fuera de pantalla.
//
// CERRADO por defecto y una línea de alto: alcanzable siempre, sin cobrar sitio.
function MemoriaDeLen({ projectId }: { projectId: string | null }) {
  const t = useTranslations("panelsChat");
  const [abierto, setAbierto] = useState(false);
  const [lineas, setLineas] = useState<string[] | null>(null);
  const [quitando, setQuitando] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    // Fail-soft: si la memoria no se puede leer, el Chat sigue entero. Es una
    // vista, no una puerta.
    fetch("/api/agent/memoria")
      .then((r) => (r.ok ? r.json() : { lineas: [] }))
      .then((d) => {
        if (vivo) setLineas(Array.isArray(d?.lineas) ? d.lineas : []);
      })
      .catch(() => {
        if (vivo) setLineas([]);
      });
    return () => {
      vivo = false;
    };
  }, []);

  const quitar = useCallback(async (preferencia: string) => {
    setQuitando(preferencia);
    try {
      const res = await fetch("/api/agent/memoria", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ preferencia }),
      });
      // Se pinta lo que VUELVE del servidor, no lo que creíamos tener: con dos
      // pestañas abiertas, el estado que manda es el suyo.
      if (res.ok) {
        const d = await res.json();
        if (Array.isArray(d?.lineas)) setLineas(d.lineas);
      }
    } catch {
      // Silencio deliberado: la línea sigue ahí y el usuario puede reintentar.
    } finally {
      setQuitando(null);
    }
  }, []);

  const cuantas = lineas?.length ?? 0;

  return (
    <div className="shrink-0 border-b bd">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[10.5px] fg-faint hover:fg-muted ui-small"
      >
        <LenMark size={10} className="text-accent" />
        <span>{t("memoria.title")}</span>
        {cuantas > 0 && <span className="tabular">({cuantas})</span>}
        <span className="ml-auto" aria-hidden>
          {abierto ? "−" : "+"}
        </span>
      </button>

      {abierto && (
        <div className="px-3 pb-2.5 space-y-2.5">
          {cuantas > 0 && (
            <div>
              <div className="text-[10.5px] fg-faint mb-1 leading-relaxed">
                {t("memoria.description")}
              </div>
              <ul className="flex flex-col gap-1">
                {lineas?.map((linea) => (
                  <li key={linea} className="flex items-start gap-2">
                    <span className="flex-1 text-[11.5px] leading-relaxed fg">{linea}</span>
                    <button
                      type="button"
                      onClick={() => void quitar(linea)}
                      disabled={quitando === linea}
                      className="shrink-0 text-[10.5px] fg-faint hover:text-red-600 dark:hover:text-red-400 disabled:opacity-50 ui-small"
                    >
                      {t("memoria.remove")}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <BriefDeLaPagina projectId={projectId} />
        </div>
      )}
    </div>
  );
}

/** Tope del servidor (`PatchSchema` en app/api/projects/[id]/route.ts). Se
 *  repite aquí para poder AVISAR antes de que el guardado falle — no para
 *  decidir: quien rechaza sigue siendo el servidor. */
const BRIEF_MAX = 4000;

/**
 * Las notas de ESTA página: `projects.userBrief`.
 *
 * Se LEE por su propia ruta en vez de enhebrarse como prop desde la página
 * porque el Agente puede escribirlo a mitad de sesión —`recordar_preferencia`
 * con alcance="esta_pagina"—, que es justo cuando el usuario querrá mirarlo;
 * una prop quedaría rancia. Se ESCRIBE por el `PATCH` que ya existía: dos
 * escritores del mismo campo es como se separan.
 */
function BriefDeLaPagina({ projectId }: { projectId: string | null }) {
  const t = useTranslations("panelsChat");
  const [texto, setTexto] = useState<string | null>(null);
  const [estado, setEstado] = useState<"idle" | "guardando" | "guardado" | "error">("idle");
  const timerRef = useRef<number | null>(null);
  const cargadoRef = useRef<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    let vivo = true;
    fetch(`/api/projects/${projectId}/brief`)
      .then((r) => (r.ok ? r.json() : { brief: "" }))
      .then((d) => {
        if (!vivo) return;
        const v = typeof d?.brief === "string" ? d.brief : "";
        cargadoRef.current = v;
        setTexto(v);
      })
      .catch(() => {
        if (vivo) setTexto("");
      });
    return () => {
      vivo = false;
    };
  }, [projectId]);

  const guardar = useCallback(
    (valor: string) => {
      if (!projectId) return;
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        // No se guarda lo que no cambió: evita un PATCH por cada vez que el
        // usuario abre el desplegable y lo vuelve a cerrar.
        if (valor === cargadoRef.current) return;
        setEstado("guardando");
        fetch(`/api/projects/${projectId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userBrief: valor }),
        })
          .then((r) => {
            if (!r.ok) throw new Error(String(r.status));
            cargadoRef.current = valor;
            setEstado("guardado");
          })
          .catch(() => setEstado("error"));
      }, 700);
    },
    [projectId],
  );

  useEffect(
    () => () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    },
    [],
  );

  if (!projectId || texto === null) return null;
  const quedan = BRIEF_MAX - texto.length;

  return (
    <div>
      <div className="text-[10.5px] fg-faint mb-1 leading-relaxed">{t("memoria.briefHint")}</div>
      <textarea
        value={texto}
        onChange={(e) => {
          const v = e.target.value.slice(0, BRIEF_MAX);
          setTexto(v);
          guardar(v);
        }}
        rows={4}
        spellCheck={false}
        placeholder={t("memoria.briefPlaceholder")}
        className="w-full resize-y rounded-md ring-1 ring-[color:var(--border)] bg-[color:var(--bg)] fg placeholder:fg-faint text-[11.5px] leading-relaxed px-2 py-1.5 focus:outline-none focus:ring-[color:var(--border-strong)] nice-scroll"
      />
      <div className="flex items-center justify-between text-[10px] fg-faint ui-small mt-0.5">
        <span>
          {estado === "guardando" && t("memoria.saving")}
          {estado === "guardado" && t("memoria.saved")}
          {estado === "error" && t("memoria.saveFailed")}
        </span>
        {/* El contador sólo aparece cerca del tope: el usuario tiene que VER
            venir el «brief lleno» que hoy le llega como un error del modelo. */}
        {quedan < 400 && (
          <span className="tabular">
            {texto.length} / {BRIEF_MAX}
          </span>
        )}
      </div>
    </div>
  );
}

/** Las ediciones que aplicó el turno, sumadas de sus acciones. Vive aquí y no
 *  en un campo del turno por lo mismo que las ops: sólo `actions` se guarda como
 *  JSON, así que un campo de turno no sobrevive a recargar. */
function edicionesDelTurno(turn: DesignTurn): number {
  return turn.actions?.reduce((n, a) => n + (a.edits ?? 0), 0) ?? 0;
}

// QUÉ CAMBIÓ ESTE TURNO, sección a sección — y un «ver» que lo enseña.
//
// El par ya estaba en el cliente: `preEditHtml` (snapshot al enviar) y
// `postEditHtml` (del evento `html`) se guardaban SÓLO para Deshacer. Esto es
// lo que faltaba entre los dos. El diff vive en lib/workspace-v2/diff-de-turno.ts
// y su cabecera explica lo que un diff de HTML puede y no puede saber.
//
// NO SE PINTA NADA cuando no hay par: un turno restaurado de otra sesión llega
// sin preimagen (no se persiste), y decir «no cambió nada» sobre eso sería una
// afirmación sobre algo que nadie miró. Es la misma regla que ya sigue el botón
// de Deshacer, que tampoco se pinta sin preimagen.
function CambiosDelTurno({ turn, mismaPagina }: { turn: DesignTurn; mismaPagina: boolean }) {
  const t = useTranslations("panelsChat");
  // LAS OPS MANDAN SOBRE EL DIFF, y no es una preferencia de estilo: el diff
  // compara dos HTML y sólo mira los hijos de <body>, así que un cambio de CSS,
  // del <title> o del comportamiento le es INVISIBLE — el turno saldría como
  // «no cambió nada» habiendo cambiado. Las ops son la instrucción literal que
  // se ejecutó, resuelta en el servidor mientras los op-id aún valían.
  //
  // El diff se queda como respaldo, y hace falta: los turnos anteriores a esto
  // no traen ops, y la vía de opt-out (`ai-design`) no las emite.
  const cambios = useMemo(() => {
    // Una sola fuente: las acciones del turno. Antes esto vivía además en un
    // campo del turno, y ese campo NO se guardaba —`appendChatMessage` escribe
    // columnas explícitas—, así que se pintaba en vivo y desaparecía al
    // recargar. Derivarlo de `actions`, que sí es JSON, lo arregla y quita la
    // segunda cuenta de la misma cosa.
    const ops = turn.actions?.flatMap((a) => a.ops ?? []) ?? [];
    if (ops.length) {
      return ops.map((o) => ({
        tipo:
          o.tipo === "delete"
            ? ("quitada" as const)
            : o.tipo === "replace"
              ? ("cambiada" as const)
              : ("anadida" as const),
        // Fuera del documento no hay nombre de sección que dar: el nombre es el
        // sitio («los estilos», «la cabecera»), y lo escribe el idioma.
        etiqueta: o.donde === "documento" ? o.etiqueta : t(`diff.${o.donde}`),
        indice: o.indice,
      }));
    }
    if (!turn.preEditHtml || !turn.postEditHtml) return [];
    return seccionesCambiadas(turn.preEditHtml, turn.postEditHtml);
  }, [turn.actions, turn.preEditHtml, turn.postEditHtml, t]);

  if (cambios.length === 0) return null;
  const visibles = cambios.slice(0, MAX_SECCIONES);
  const resto = cambios.length - visibles.length;

  return (
    <ul className="mt-1 flex flex-col gap-0.5">
      {visibles.map((c, i) => (
        <li
          key={`${c.tipo}-${c.indice}-${i}`}
          className="flex items-center gap-1.5 text-[10.5px] fg-faint ui-small"
        >
          <span
            aria-hidden
            className={
              c.tipo === "anadida"
                ? "text-emerald-600 dark:text-emerald-400"
                : c.tipo === "quitada"
                  ? "text-red-600 dark:text-red-400"
                  : "text-[var(--accent)]"
            }
          >
            {c.tipo === "anadida" ? "+" : c.tipo === "quitada" ? "−" : "•"}
          </span>
          <span className="truncate">
            {c.etiqueta ? t(`diff.${c.tipo}`, { que: c.etiqueta }) : t(`diff.${c.tipo}SinNombre`)}
          </span>
          {/* El «ver» sólo cuando hay a dónde ir: una sección QUITADA ya no está
              en la página, y un turno que editó OTRA página movería el lienzo a
              un documento que no es el que se está mirando. */}
          {c.indice >= 0 && mismaPagina && (
            <button
              type="button"
              onClick={() => resaltarController.resaltar(c.indice)}
              className="shrink-0 ml-auto text-accent hover:underline"
            >
              {t("diff.ver")}
            </button>
          )}
        </li>
      ))}
      {resto > 0 && (
        <li className="text-[10.5px] fg-faint ui-small">{t("diff.mas", { n: resto })}</li>
      )}
    </ul>
  );
}
