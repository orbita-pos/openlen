// Chat tab — primary design surface for flat (template-clone / paste)
// projects. When the panel is mounted with `flatProjectId` + `onFlatHtmlUpdate`,
// it talks to /api/templates/ai-design (Gemini streaming SSE) and drip-feeds
// the iframe via `onFlatHtmlUpdate`. Other states (loading, no project)
// render a skeleton or empty card — never a mock conversation.

"use client";

import { useTranslations } from "next-intl";
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
  ChevronDown,
  Crosshair,
  FileText,
  ImageIcon,
  Loader,
  SendUp,
  Sparkles,
  Wand,
  WandSparkles,
  X,
} from "../icons";
import { ReplaceAssetModal } from "../replace-asset-modal";
import { ModelPicker, useAIModel } from "../model-picker";
import { AgentActionCard, type AgentAction } from "../agent-action-card";
import { AgentConfirmCard, type AgentConfirm } from "../agent-confirm-card";
import type { StoredChatTurn } from "@/lib/projects/types";
import type { SitePageSummary } from "@/lib/projects/site-pages";
import type { AIModel } from "@/lib/ai-provider";

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
  onFlatHtmlUpdate?: (newHtml: string) => void;
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
  onSwitchSitePage?: (slug: string | null) => void;
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
  onSwitchSitePage,
}: ChatPanelProps) {
  if (flatProjectId && onFlatHtmlUpdate) {
    return (
      <AIDesignChat
        page={flatProjectPage}
        sitePages={sitePages}
        onSwitchSitePage={onSwitchSitePage}
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
          <Sparkles size={14} />
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
  assistantReasoning: string;
  status: TurnStatus;
  errorText?: string;
  /** HTML before this turn ran — used to revert via Undo. */
  preEditHtml: string;
  /** Site page this turn edited (null = home), snapshotted at send time.
   *  Undo/Retry target THIS page — the canvas may have switched since.
   *  undefined = pre-multipage turn; falls back to the current page. */
  page?: string | null;
  postEditHtml?: string;
  /** Agent-mode tool cards for this turn (leer_estado → editar_pagina → …).
   *  Empty/absent for ai-design turns. Not persisted in F1 — rebuilt live
   *  from the SSE `action` events each turn. */
  actions?: AgentAction[];
  /** Agent-mode publish gate (Task 7) — a `confirm` SSE event lands here and
   *  renders an interactive AgentConfirmCard. The card survives the turn's
   *  `done` (it finalizes to applied but the card stays tappable). Local-only:
   *  ephemeral like action cards, never persisted (the ✓ success posts its own
   *  history turn). */
  confirm?: AgentConfirm;
  /** Agent-mode: the turn finished without any `html` event (answer-only or
   *  settings-only) — no document changed, so the footer suppresses the
   *  Applied/Undo affordances. Local-only, never persisted. */
  noDocChange?: boolean;
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
 *  null/undefined (pre-multipage + home) as the home document. */
function samePage(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  return (a ?? null) === (b ?? null);
}

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
  onSwitchSitePage,
}: {
  projectId: string;
  projectHtml: string;
  page?: string | null;
  /** Write a document's html into the parent's project state. `page`
   *  pins the slot (null = home); undefined = whatever page is active. */
  onLocalUpdate: (newHtml: string, page?: string | null) => void;
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
  onSwitchSitePage?: (slug: string | null) => void;
}) {
  const t = useTranslations("panelsChat");
  // Agent-mode messages live under the wsPage namespace (shared with the
  // AgentActionCard); pulled separately from the panelsChat translator.
  const tAgent = useTranslations("wsPage.agent");
  // Seed from the persisted transcript so a reload / tab-switch remount
  // restores the conversation. Restored turns carry no HTML snapshot — their
  // inline Undo is hidden (the Versions tab covers older revisions).
  const [turns, setTurns] = useState<DesignTurn[]>(() =>
    (initialChat ?? []).filter((s) => samePage(s.page, page)).map(restoreTurn),
  );
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  // Agent mode (flag-gated) — read once on mount for the UI so the composer
  // can hide affordances the /api/agent route drops (attach-image, scope,
  // model choice). The send() path re-reads localStorage at call time.
  const [agentModeUI, setAgentModeUI] = useState(false);
  useEffect(() => {
    try {
      setAgentModeUI(window.localStorage.getItem("ol:agent") === "1");
    } catch {
      /* storage blocked — leave affordances visible */
    }
  }, []);
  const [attachedImage, setAttachedImage] = useState<AttachedImage | null>(null);
  const [imageModalOpen, setImageModalOpen] = useState(false);
  const [model, handleModelChange] = useAIModel();

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
  // page-building loader while the model redesigns. Cleanup forces it off
  // if the chat unmounts mid-stream (a tab switch aborts the request).
  useEffect(() => {
    onRedesigningChangeRef.current?.(sending);
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
    .filter((s) => samePage(s.page, page))
    .map((s) => `${s.id}:${s.status}`)
    .join("|");
  const chatSeededRef = useRef(false);
  useEffect(() => {
    if (!chatSeededRef.current) {
      // First run = the useState seed; nothing to reconcile.
      chatSeededRef.current = true;
      return;
    }
    const server = (initialChatRef.current ?? []).filter((s) =>
      samePage(s.page, page),
    );
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
      prev.map((t) => {
        if (t.id !== id) return t;
        const actions = t.actions ? [...t.actions] : [];
        const last = actions[actions.length - 1];
        if (last && last.tool === action.tool && last.status === "running") {
          actions[actions.length - 1] = action;
        } else {
          actions.push(action);
        }
        return { ...t, actions };
      }),
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
      setSending(true);

      const history = turnsRef.current
        .filter(
          (t) =>
            (t.status === "applied" || t.status === "reverted") &&
            samePage(t.page, turnPage),
        )
        .slice(-6)
        .flatMap((t) => [
          { role: "user" as const, content: t.userText },
          { role: "assistant" as const, content: t.assistantReasoning || "" },
        ]);

      // Agent mode (flag-gated) — talk to /api/agent instead of ai-design.
      // Same SSE reader/line-parse shape as below, different event dispatch:
      // `text` feeds the assistant prose, `action` upserts tool cards, `html`
      // refreshes the preview via the SAME onLocalUpdate path done.html uses.
      let agentMode = false;
      try {
        agentMode =
          typeof window !== "undefined" &&
          window.localStorage.getItem("ol:agent") === "1";
      } catch {
        /* storage blocked — stay on ai-design; must not wedge the composer */
      }
      if (agentMode) {
        // F1 server tools ONLY edit the home document (data.html). If the
        // canvas is on a subpage, don't fetch — settle the turn as an
        // error-style notice (spinner off, input re-enabled, nothing
        // persisted), same as any other pre-flight failure.
        if (turnPage !== null) {
          updateTurn(turnId, { status: "error", errorText: tAgent("homeOnly") });
          setSending(false);
          return;
        }
        const abort = new AbortController();
        abortRef.current = abort;
        let accumulatedReasoning = "";
        let latestAgentHtml: string | null = null;
        let errorMessage: string | null = null;
        try {
          const res = await fetch("/api/agent", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ projectId, prompt, history }),
            signal: abort.signal,
          });

          if (!res.ok || !res.body) {
            const errPayload = await res
              .json()
              .catch(() => ({ error: `HTTP ${res.status}` }));
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

              if (evName === "text") {
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
                const summary =
                  typeof p.summary === "string" ? p.summary : "";
                if (tool) upsertAction(turnId, { tool, status, summary });
              } else if (evName === "html") {
                const html = strField(payload, "html");
                if (html) {
                  latestAgentHtml = html;
                  // Agent turns are home-only (guarded above), so pin the html
                  // channel to home explicitly — the refreshed document must
                  // never land in a subpage slot.
                  onLocalUpdate(html, null);
                }
              } else if (evName === "confirm") {
                // The publish gate — attach a confirm card to this turn. It
                // stays interactive after the turn's `done` finalizes it (the
                // user's tap is the only thing that publishes).
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
                break agentOuter;
              } else if (evName === "error") {
                // Do NOT break — a `done` may still follow to close the turn.
                errorMessage = strField(payload, "message") || t("errors.generic");
              }
            }
          }

          if (errorMessage) {
            updateTurn(turnId, { status: "error", errorText: errorMessage });
            return;
          }

          updateTurn(turnId, {
            status: "applied",
            appliedAt: Date.now(),
            // No `html` event = no document changed (answer-only or
            // settings-only turn) — flag it so the footer shows neither
            // "Applied" nor a pointless Undo.
            ...(latestAgentHtml !== null
              ? { postEditHtml: latestAgentHtml }
              : { noDocChange: true }),
          });
          void persistTurn({
            id: turnId,
            userText: prompt,
            attachedImage: img ?? undefined,
            assistantReasoning: accumulatedReasoning,
            status: "applied",
            // Agent turns are home-only (guarded above) — pin to home so Undo
            // PATCHes the home document.
            page: null,
          });
        } catch (err) {
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

      const htmlBuf = { value: "" };
      // Accumulated alongside the per-turn state so the final reasoning is in
      // scope when we append the settled turn to the transcript.
      let accumulatedReasoning = "";
      let lastFlushedLen = 0;
      let flushTimer: number | null = null;
      const flushHtml = () => {
        if (htmlBuf.value.length > lastFlushedLen) {
          lastFlushedLen = htmlBuf.value.length;
          onLocalUpdate(htmlBuf.value, turnPage);
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

      const abort = new AbortController();
      abortRef.current = abort;

      // Snapshot the scope at send time — if the user clears or re-picks
      // mid-stream, the in-flight request keeps the original target.
      const turnScope = scopedSelection
        ? {
            hint: scopedSelection.hint,
            path: scopedSelection.path,
          }
        : null;
      // Same snapshot discipline for any attached image — the in-flight
      // request keeps the one that was set when Send fired.
      const turnImage = img ? { url: img.url, alt: img.alt } : null;

      try {
        const res = await fetch("/api/templates/ai-design", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            projectId,
            currentHtml: preEditHtml,
            prompt,
            history,
            model,
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
              const data = payload as { message?: string };
              errorMessage =
                typeof data.message === "string"
                  ? data.message
                  : t("errors.generic");
              break outer;
            }
          }
        }

        clearFlush();

        if (errorMessage) {
          if (lastFlushedLen > 0) onLocalUpdate(preEditHtml, turnPage);
          updateTurn(turnId, { status: "error", errorText: errorMessage });
          return;
        }

        if (!finalHtml) {
          if (lastFlushedLen > 0) onLocalUpdate(preEditHtml, turnPage);
          updateTurn(turnId, {
            status: "error",
            errorText: t("errors.noFinalHtml"),
          });
          return;
        }

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
      } catch (err) {
        clearFlush();
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
      } finally {
        if (abortRef.current === abort) abortRef.current = null;
        setSending(false);
      }
    },
    [
      appendReasoning,
      attachedImage,
      model,
      onLocalUpdate,
      persistTurn,
      projectId,
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
      if (turn.status !== "applied") return;
      // Restored (pre-reload) turns carry no preEditHtml — their revisions
      // are reachable via the Versions tab, not this inline Undo.
      if (!turn.preEditHtml) return;
      // Undo targets the turn's OWN page (snapshotted at send time) — the
      // canvas may be on another page by now, and home must never receive a
      // subpage's pre-edit document. Pre-multipage turns carry no page field
      // and fall back to the current page (their only possible target).
      const targetPage = turn.page === undefined ? pageRef.current : turn.page;
      onLocalUpdate(turn.preEditHtml, targetPage);
      updateTurn(turn.id, { status: "reverted" });
      try {
        await fetch(`/api/projects/${projectId}/html`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            html: turn.preEditHtml,
            ...(targetPage ? { page: targetPage } : {}),
          }),
        });
      } catch {
        /* iframe restored — DB sync failing is soft */
      }
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
      {sitePages.length > 0 && (
        <ChatPageBar
          pages={sitePages}
          active={page}
          onSwitch={onSwitchSitePage ?? (() => {})}
        />
      )}
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
        onSubmit={() => void send(draft)}
        sending={sending}
        textareaRef={taRef}
        model={model}
        onModelChange={handleModelChange}
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
          <Sparkles size={15} />
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
  projectId,
  onUndo,
  onRetry,
  onCancel,
  onPublished,
  hideAIBubble,
}: {
  turn: DesignTurn;
  projectId: string;
  onUndo: (turn: DesignTurn) => void;
  onRetry: (turn: DesignTurn) => void;
  onCancel: () => void;
  onPublished: (url: string) => void;
  hideAIBubble: boolean;
}) {
  const t = useTranslations("panelsChat");
  return (
    <div className="space-y-2">
      <div className="flex gap-2 flex-row-reverse">
        <span className="shrink-0 inline-flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold bg-gradient-to-br from-[#FF7E55] to-[#C72E10] text-white">
          J
        </span>
        <div className="min-w-0 max-w-[80%] text-right">
          <div className="inline-block rounded-2xl px-3 py-2 text-left bg-accent-soft text-accent border border-[color:var(--accent)]/30">
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
            <div className="text-[12.5px] fg leading-relaxed whitespace-pre-wrap">
              {turn.userText}
            </div>
          </div>
        </div>
      </div>

      {!hideAIBubble && (
        <div className="flex gap-2">
          <span className="shrink-0 inline-flex h-6 w-6 items-center justify-center rounded-full bg-[var(--accent-strong)] text-white">
            <Sparkles size={11} />
          </span>
          <div className="min-w-0 max-w-[85%] space-y-1.5">
            {turn.actions && turn.actions.length > 0 && (
              <div className="space-y-1">
                {turn.actions.map((a, i) => (
                  <AgentActionCard key={`${a.tool}-${i}`} action={a} />
                ))}
              </div>
            )}
            <div className="inline-block rounded-2xl px-3 py-2 text-left bg-elev border bd">
              {turn.assistantReasoning.length > 0 && (
                <div className="text-[12.5px] fg leading-relaxed whitespace-pre-wrap">
                  {turn.assistantReasoning}
                </div>
              )}
              <TurnFooter
                turn={turn}
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
  onUndo,
  onRetry,
  onCancel,
  hasText,
}: {
  turn: DesignTurn;
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
    // Agent turn that changed no document — "Applied · Undo" would be the
    // wrong verbs (and Undo a pointless PATCH), so the footer stays silent.
    if (turn.noDocChange) return null;
    // No preEditHtml = a turn restored from a previous session; the inline
    // Undo can't revert it (the Versions tab does), so hide the button.
    const canUndo = turn.preEditHtml.length > 0;
    return (
      <div
        className={`${marginClass} inline-flex items-center gap-2 rounded-md bg-app border bd px-1.5 py-0.5 text-[10.5px] fg-faint ui-small`}
      >
        <Wand size={10} className="text-[var(--accent)]" />
        <span>
          {t("applied.label", {
            time: relativeTime(turn.appliedAt ?? Date.now(), t),
          })}
        </span>
        {canUndo && (
          <button
            type="button"
            onClick={() => onUndo(turn)}
            className="text-accent hover:underline"
          >
            {t("applied.undo")}
          </button>
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

function ThinkingBubble() {
  return (
    <div className="flex gap-2">
      <span className="shrink-0 inline-flex h-6 w-6 items-center justify-center rounded-full bg-[var(--accent-strong)] text-white">
        <Sparkles size={11} />
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
  model,
  onModelChange,
  agentMode = false,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
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
  model: AIModel;
  onModelChange: (m: AIModel) => void;
  /** Agent mode drops attach-image, scoped selection, and model choice (the
   *  /api/agent route hardcodes Flash + ignores them) — hide those
   *  affordances rather than silently discard the input. */
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
          disabled={sending}
          placeholder={
            scopedSelection
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
            {!agentMode && (
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
            )}
            {!agentMode && onToggleSectionSelect && (
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
            {!agentMode && (
              <ModelPicker
                model={model}
                onChange={onModelChange}
                disabled={sending}
                compact
              />
            )}
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
            onClick={onSubmit}
            disabled={!value.trim() || sending}
            aria-label={t("composer.send")}
            className={`inline-flex items-center justify-center gap-1 h-7 rounded-md text-[11.5px] font-medium transition ${
              value.trim() && !sending
                ? "px-2.5 bg-[var(--accent-strong)] text-white shadow-coral hover:brightness-105"
                : "w-7 bg-hover fg-faint cursor-not-allowed"
            }`}
          >
            {sending ? (
              <Loader size={12} className="animate-spin" />
            ) : value.trim() ? (
              <>
                <SendUp size={12} /> <span>{t("composer.send")}</span>
              </>
            ) : (
              <SendUp size={13} />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// Prominent page selector at the TOP of the chat panel (a context bar, like the
// reference's "New Hero Ticker ▾"). Lists Home + subpages; picking one navigates
// (?page=<slug>) so the chat then edits that page. Hidden for single-page
// projects (no subpages). Popover opens downward.
function ChatPageBar({
  pages,
  active,
  onSwitch,
}: {
  pages: SitePageSummary[];
  active: string | null;
  onSwitch: (slug: string | null) => void;
}) {
  const t = useTranslations("panelsChat");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open]);
  if (pages.length === 0) return null;
  const homeLabel = t("composer.pageTargetHome");
  const activeLabel = active
    ? (pages.find((p) => p.slug === active)?.title ?? active)
    : homeLabel;
  const pick = (slug: string | null) => {
    setOpen(false);
    if (slug !== active) onSwitch(slug);
  };
  return (
    <div className="shrink-0 px-3 pt-3" ref={ref}>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label={t("composer.pageTarget")}
          title={t("composer.pageTarget")}
          className="w-full inline-flex items-center gap-2 h-9 px-3 rounded-lg border bd bg-elev hover:bg-hover text-[12.5px] fg font-medium transition"
        >
          <FileText size={14} className="fg-muted shrink-0" />
          <span className="flex-1 text-left truncate">{activeLabel}</span>
          <ChevronDown
            size={13}
            className={`fg-muted shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
        {open && (
          <div className="absolute top-full left-0 right-0 mt-1 rounded-lg border bd bg-elev shadow-card p-1 z-30 max-h-64 overflow-y-auto nice-scroll">
            <PageItem label={homeLabel} on={active === null} onClick={() => pick(null)} />
            {pages.map((p) => (
              <PageItem
                key={p.slug}
                label={p.title}
                on={active === p.slug}
                onClick={() => pick(p.slug)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PageItem({
  label,
  on,
  onClick,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-2 py-1.5 rounded-md text-[11.5px] truncate transition ${
        on ? "bg-accent-soft text-accent" : "fg hover:bg-hover"
      }`}
    >
      {label}
    </button>
  );
}

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
  };
}

// Pull a string field off an unknown SSE payload, "" when absent/non-string.
function strField(payload: unknown, key: string): string {
  if (!payload || typeof payload !== "object") return "";
  const v = (payload as Record<string, unknown>)[key];
  return typeof v === "string" ? v : "";
}

type Translator = ReturnType<typeof useTranslations<"panelsChat">>;

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

