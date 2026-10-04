"use client";

// EL CHAT NUEVO (plans/new-chat/). Mismas props y mismo sitio que `ChatPanel`
// (`panels/chat-panel.tsx`), para poder alternar con un interruptor
// (`use-chat-version.ts`); la lógica es la MISMA (`useAgentChat`), sólo cambia
// la piel. El inventario de lo que tiene que hacer —el contrato para cambiar el
// viejo por éste— está en `plans/new-chat/inventory.md`.

import "./new-chat.css";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";

import { CaraDeLen } from "@/components/llamada/cara-de-len";
import { ReplaceAssetModal } from "../replace-asset-modal";
import type { EtiquetasDeRespuesta } from "../agent-reply-card";
import type { StoredChatTurn } from "@/lib/projects/types";
import { ChatComposer } from "./chat-composer";
import { ChatHeader } from "./chat-header";
import { LenTurn, UserMessage } from "./chat-turn";
import { LiveBar } from "./live-bar";
import { liveStatus } from "./live-status";
import { MemoryDrawer, useAgentMemory } from "./len-memory";
import { useAgentChat, type ScopedSelection } from "./use-agent-chat";
import { useConversations } from "./use-conversations";
import { setChatLayout, useChatLayout, useFloatBox, type FloatBox } from "./use-chat-version";
import type { LiveStatus } from "./live-status";
import { useIsMobile } from "../use-is-mobile";
import { useTurnFeedback } from "./use-turn-feedback";

export interface NewChatPanelProps {
  flatProjectId?: string;
  flatProjectHtml?: string;
  flatProjectPage?: string | null;
  onFlatHtmlUpdate?: (newHtml: string, page?: string | null, untrusted?: boolean) => void;
  flatProjectChat?: StoredChatTurn[];
  onChatChange?: () => void;
  onRedesigningChange?: (active: boolean) => void;
  projectLoading?: boolean;
  sectionSelectMode?: boolean;
  onToggleSectionSelect?: (active: boolean) => void;
  scopedSelection?: ScopedSelection | null;
  onClearScope?: () => void;
  pendingDraft?: string | null;
  pendingDraftAutoSend?: boolean;
  onPendingDraftConsumed?: () => void;
  /** En el móvil el panel tapa la pantalla: la ✕ de la cabecera lo cierra. */
  onClose?: () => void;
}

const SUGGESTIONS = ["photos", "form", "mobile", "publish"] as const;

export function NewChatPanel(props: NewChatPanelProps) {
  const { flatProjectId, onFlatHtmlUpdate, flatProjectPage = null, projectLoading = false } = props;
  if (flatProjectId && onFlatHtmlUpdate) {
    // La charla es una para todo el sitio; cambiar de página remonta el panel
    // (como el de hoy) y la convergencia la vuelve a traer entera.
    return <AgentChatView key={`${flatProjectId}:${flatProjectPage ?? ""}`} {...props} projectId={flatProjectId} onLocalUpdate={onFlatHtmlUpdate} />;
  }
  return <NoProject loading={projectLoading} />;
}

function NoProject({ loading }: { loading: boolean }) {
  const t = useTranslations("panelsChat");
  if (loading) {
    return (
      <div className="nc flex h-full flex-col bg-side">
        <div className="h-11 border-b bd" />
        <div className="flex-1 space-y-3 px-4 py-5">
          <div className="ml-auto h-9 w-1/2 animate-pulse rounded-2xl bg-[color:var(--hover)]" />
          <div className="h-3 w-5/6 animate-pulse rounded bg-[color:var(--hover)]" />
          <div className="h-3 w-3/5 animate-pulse rounded bg-[color:var(--hover)]" />
        </div>
        <div className="px-3 pb-3">
          <div className="h-[92px] animate-pulse rounded-[16px] bg-[color:var(--hover)]" />
        </div>
      </div>
    );
  }
  return (
    <div className="nc flex h-full items-center justify-center bg-side px-6 py-8 text-center">
      <div className="max-w-[240px]">
        <CaraDeLen estado="reposo" props="compact" className="mx-auto mb-3 h-12 w-12" />
        <p className="text-[12.5px] leading-relaxed fg-muted">{t("noProject.title")}</p>
        <p className="mt-1.5 text-[11.5px] leading-relaxed fg-faint">{t("noProject.subtitle")}</p>
      </div>
    </div>
  );
}

function AgentChatView({
  projectId,
  flatProjectHtml = "",
  flatProjectPage = null,
  onLocalUpdate,
  flatProjectChat,
  onChatChange,
  onRedesigningChange,
  sectionSelectMode = false,
  onToggleSectionSelect,
  scopedSelection = null,
  onClearScope,
  pendingDraft = null,
  pendingDraftAutoSend = false,
  onPendingDraftConsumed,
  onClose,
}: NewChatPanelProps & {
  projectId: string;
  onLocalUpdate: NonNullable<NewChatPanelProps["onFlatHtmlUpdate"]>;
}) {
  const t = useTranslations("panelsChat");
  const tAgent = useTranslations("wsPage.agent");
  const tSidebar = useTranslations("wsChrome");
  const chat = useAgentChat({
    page: flatProjectPage,
    projectId,
    projectHtml: flatProjectHtml,
    onLocalUpdate,
    initialChat: flatProjectChat,
    onChatChange,
    onRedesigningChange,
    scopedSelection,
    onClearScope,
    pendingDraft,
    pendingDraftAutoSend,
    onPendingDraftConsumed,
  });
  const memory = useAgentMemory();
  const feedback = useTurnFeedback(projectId);
  const conversations = useConversations(projectId, chat.conversationChanged);
  const [memoryOpen, setMemoryOpen] = useState(false);
  // La memoria se relee al abrir el cajón y al cerrarse cada turno (N30): Len
  // pudo guardar una preferencia en él, y el «(N)» de la cabecera se ve sin abrir.
  const { reload: reloadMemory } = memory;
  useEffect(() => {
    if (memoryOpen) void reloadMemory();
  }, [memoryOpen, reloadMemory]);
  const wasBusy = useRef(chat.busy);
  useEffect(() => {
    if (wasBusy.current && !chat.busy) void reloadMemory();
    wasBusy.current = chat.busy;
  }, [chat.busy, reloadMemory]);
  const [settledConfirms, setSettledConfirms] = useState<ReadonlySet<string>>(() => new Set());
  const { data: session } = useSession();
  const initial = useMemo(() => {
    const name = session?.user?.name?.trim() || session?.user?.email?.split("@")[0] || "";
    return (name.charAt(0) || "?").toUpperCase();
  }, [session?.user?.name, session?.user?.email]);

  const relativeTime = useCallback(
    (ms: number) => {
      const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
      if (s < 5) return t("relativeTime.justNow");
      if (s < 60) return t("relativeTime.seconds", { count: s });
      const m = Math.floor(s / 60);
      if (m < 60) return t("relativeTime.minutes", { count: m });
      const h = Math.floor(m / 60);
      if (h < 24) return t("relativeTime.hours", { count: h });
      return t("relativeTime.days", { count: Math.floor(h / 24) });
    },
    [t],
  );

  const replyLabels = useMemo<EtiquetasDeRespuesta>(
    () => ({
      titulo: (con) => tAgent("respuesta.titulo", { con }),
      tituloSinNombre: tAgent("respuesta.tituloSinNombre"),
      nota: tAgent("respuesta.nota"),
      enviar: tAgent("respuesta.enviar"),
      enviando: tAgent("respuesta.enviando"),
      enviado: tAgent("respuesta.enviado"),
      correo: tAgent("respuesta.correo"),
      whatsapp: tAgent("respuesta.whatsapp"),
      copiar: tAgent("respuesta.copiar"),
      copiado: tAgent("respuesta.copiado"),
      asunto: tAgent("respuesta.asunto"),
      error: tAgent("respuesta.error"),
    }),
    [tAgent],
  );

  const status = liveStatus(chat.latest, {
    busy: chat.busy,
    settledConfirms,
    cancelledText: t("errors.cancelled"),
  });
  // ANCLADO, FLOTANTE O MINIMIZADO. En el móvil, siempre anclado: el panel ya
  // ocupa la pantalla entera.
  const isMobile = useIsMobile();
  const storedLayout = useChatLayout();
  const layout = isMobile ? "docked" : storedLayout;
  const settle = useCallback((turnId: string) => {
    setSettledConfirms((s) => new Set(s).add(turnId));
  }, []);

  const body = (
    <div className="nc flex h-full min-h-0 flex-col bg-side">
      <ChatHeader
        layout={layout}
        onLayout={setChatLayout}
        memoryOpen={memoryOpen}
        memoryCount={memory.lines?.length ?? 0}
        onToggleMemory={() => setMemoryOpen((x) => !x)}
        conversations={conversations}
        busy={chat.busy}
        onClose={onClose}
        closeLabel={tSidebar("sidebar.collapsePanel")}
        relativeTime={relativeTime}
      />
      <div className={`nc-fold shrink-0 ${memoryOpen ? "border-b bd" : ""}`} data-open={memoryOpen}>
        <div>{memoryOpen && <MemoryDrawer projectId={projectId} memory={memory} />}</div>
      </div>
      <div ref={chat.scrollRef} className="nice-scroll flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-3 pt-5">
        {chat.turns.length === 0 ? (
          <EmptyState
            disabled={chat.busy}
            onPick={(text) => {
              chat.setDraft(text);
              queueMicrotask(() => chat.taRef.current?.focus());
            }}
          />
        ) : (
          chat.turns.map((turn, i) => (
            <div key={turn.id} className="flex flex-col gap-4">
              <UserMessage turn={turn} initial={initial} />
              <LenTurn
                turn={turn}
                next={chat.turns[i + 1]}
                isLast={i === chat.turns.length - 1}
                currentPage={flatProjectPage}
                projectId={projectId}
                // Un turno con error no tiene `appliedAt`: su hora es la de cuando
                // empezó (si no, decía «justo ahora» para siempre).
                when={
                  turn.status === "streaming"
                    ? t("relativeTime.justNow")
                    : relativeTime(turn.appliedAt ?? turn.startedAt ?? Date.now())
                }
                vote={feedback.votes[turn.id]}
                labels={replyLabels}
                onUndo={chat.handleUndo}
                onRetry={chat.handleRetry}
                onPublished={chat.handlePublished}
                onConfirmSettled={settle}
                onRate={(rating, reasons, note) => feedback.rate(turn.id, rating, reasons ?? [], note ?? null)}
                onClearRate={() => feedback.clear(turn.id)}
              />
            </div>
          ))
        )}
      </div>
      <div className="relative z-[2] shrink-0 px-3 pb-3 pt-1">
        <LiveBar status={status} onStop={chat.handleCancel} />
        <ChatComposer
          value={chat.draft}
          onChange={chat.setDraft}
          onSubmit={chat.submit}
          onStop={chat.handleCancel}
          busy={chat.busy}
          textareaRef={chat.taRef}
          comments={chat.comentarios}
          onRemoveComment={chat.removeComentario}
          scopedSelection={scopedSelection}
          onClearScope={onClearScope}
          sectionSelectMode={sectionSelectMode}
          onToggleSectionSelect={onToggleSectionSelect}
          attachedImage={chat.attachedImage}
          onAttachImage={() => chat.setImageModalOpen(true)}
          onClearAttachedImage={() => chat.setAttachedImage(null)}
          effort={chat.esfuerzo}
          effortLevels={chat.esfuerzoNiveles}
          effortResolvesTo={chat.esfuerzoResuelveA}
          onEffortChange={chat.changeEsfuerzo}
          mode={chat.mode}
          {...(chat.modeOffered ? { onModeChange: chat.setMode } : {})}
        />
      </div>
      <ReplaceAssetModal
        open={chat.imageModalOpen}
        kind={chat.imageModalOpen ? "image" : null}
        projectId={projectId}
        onClose={() => chat.setImageModalOpen(false)}
        onPick={(payload) => {
          if (payload.url) chat.setAttachedImage({ url: payload.url, alt: payload.alt });
          chat.setImageModalOpen(false);
        }}
      />
    </div>
  );

  return <ChatFrame layout={layout} status={status}>{body}</ChatFrame>;
}

/** Estirar la caja flotante con las flechas: [ancho, alto] por pulsación. */
const RESIZE_KEYS: Partial<Record<string, readonly [number, number]>> = {
  ArrowLeft: [-24, 0],
  ArrowRight: [24, 0],
  ArrowUp: [0, -24],
  ArrowDown: [0, 24],
};

/**
 * EL CHAT ANCLADO, FLOTANTE O MINIMIZADO (plans/new-chat/, del mock). La caja
 * es el MISMO chat en los tres: el árbol tiene siempre la misma forma (el asa y
 * la esquina son huecos `false` cuando está anclado) y sólo cambia la caja con
 * `position: fixed`. Así ni el panel ni sus tarjetas se desmontan al cambiar —se
 * perderían el Deshacer y el «comparar» de los turnos de esta pestaña, y lo que
 * una tarjeta de publicar tuviera a medias—. Se arrastra por la cabecera y se
 * estira por la esquina; minimizado queda la cara de Len en una esquina, con su
 * estado (pensando, te toca…).
 */
function ChatFrame({
  layout,
  status,
  children,
}: {
  layout: "docked" | "floating" | "minimized";
  status: LiveStatus;
  children: ReactNode;
}) {
  const t = useTranslations("panelsChat");
  const [box, setBox] = useFloatBox();
  const drag = useRef<{ x: number; y: number; from: FloatBox; kind: "move" | "resize" } | null>(null);
  const start = (kind: "move" | "resize") => (e: ReactPointerEvent<HTMLElement>) => {
    if (!box) return;
    drag.current = { x: e.clientX, y: e.clientY, from: box, kind };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    setBox(
      d.kind === "move"
        ? { ...d.from, x: d.from.x + dx, y: d.from.y + dy }
        : { ...d.from, w: d.from.w + dx, h: d.from.h + dy },
    );
  };
  const end = () => {
    drag.current = null;
  };

  const docked = layout === "docked";
  // Flotando sin caja todavía (la primera pintura, antes de leer la ventana):
  // oculto un instante, pero montado.
  const floating = layout === "floating" && box !== null;
  const waiting = status.kind === "waiting";
  return (
    <>
      <div
        className={
          docked
            ? "h-full"
            : floating
              ? "nc nc-card-in fixed z-[45] flex flex-col overflow-hidden rounded-2xl border bd-strong shadow-[0_24px_64px_-16px_rgba(20,10,5,0.45)]"
              : "hidden"
        }
        style={floating && box ? { left: box.x, top: box.y, width: box.w, height: box.h } : undefined}
        onPointerMove={docked ? undefined : move}
        onPointerUp={docked ? undefined : end}
        onPointerCancel={docked ? undefined : end}
      >
        {/* La franja de arriba (la cabecera del chat) es el asa para moverlo;
            deja libres los botones de la derecha. */}
        {!docked && (
          <div
            className="absolute inset-x-0 top-0 z-10 h-11 cursor-grab touch-none active:cursor-grabbing"
            onPointerDown={start("move")}
            style={{ right: 140 }}
            aria-hidden
          />
        )}
        <div className="h-full min-h-0 flex-1">{children}</div>
        {!docked && (
          <div
            role="separator"
            aria-label={t("newChat.layout.resize")}
            title={t("newChat.layout.resize")}
            // Con el teclado también, como el borde del chat anclado
            // (`left-sidebar.tsx`): flechas, de 24 en 24; `fitFloatBox` lo
            // mantiene dentro de la ventana.
            tabIndex={0}
            onKeyDown={(e) => {
              if (!box) return;
              const step = RESIZE_KEYS[e.key];
              if (!step) return;
              e.preventDefault();
              setBox({ ...box, w: box.w + step[0], h: box.h + step[1] });
            }}
            onPointerDown={start("resize")}
            className="absolute bottom-0 right-0 z-10 h-4 w-4 cursor-nwse-resize touch-none bg-[linear-gradient(135deg,transparent_50%,var(--border-strong)_50%)] opacity-70"
          />
        )}
      </div>
      {layout === "minimized" && (
        <button
          type="button"
          onClick={() => setChatLayout("floating")}
          aria-label={t("newChat.layout.open")}
          title={t("newChat.layout.open")}
          className="nc fixed bottom-5 right-5 z-[45] grid h-[60px] w-[60px] place-items-center rounded-full border bd-strong bg-elev shadow-[0_18px_40px_-12px_rgb(20_10_5/0.45)] transition hover:-translate-y-0.5"
        >
          <span className="nc-card-in grid place-items-center">
            <CaraDeLen estado={status.face} props="compact" className="h-11 w-11" />
          </span>
          {waiting && (
            <span className="absolute right-0.5 top-0.5 h-3 w-3 rounded-full border-2 border-[color:var(--bg-elev)] bg-[var(--accent)]" />
          )}
        </button>
      )}
    </>
  );
}

function EmptyState({ onPick, disabled }: { onPick: (text: string) => void; disabled: boolean }) {
  const t = useTranslations("panelsChat");
  return (
    <div className="nc-up my-auto grid justify-items-center gap-2 px-1 py-3 text-center">
      <CaraDeLen estado="reposo" props="compact" className="mb-2.5 h-[84px] w-[84px]" />
      <h2 className="m-0 font-[family-name:var(--font-instrument)] text-[31px] font-normal leading-[1.08] tracking-[-0.01em]">
        {t("newChat.empty.title")}
      </h2>
      <p className="m-0 text-[13.5px] fg-muted">{t("newChat.empty.subtitle")}</p>
      <div className="mt-[18px] flex flex-wrap justify-center gap-1.5">
        {SUGGESTIONS.map((key) => {
          const text = t(`newChat.empty.suggestions.${key}`);
          return (
            <button
              key={key}
              type="button"
              disabled={disabled}
              onClick={() => onPick(text)}
              className="rounded-full border bd px-3 py-[5px] text-[12.5px] fg-muted transition hover:border-[color:var(--border-strong)] hover:bg-elev hover:fg disabled:opacity-50"
            >
              {text}
            </button>
          );
        })}
      </div>
    </div>
  );
}
