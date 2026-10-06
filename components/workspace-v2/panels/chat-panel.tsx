// Chat tab — el chat con Len (POST /api/agent; `ai-design` sólo como vía de
// escape con `OPENLEN_AGENT=0` o `ol:agent = "0"`). Lo que pinta vive aquí; la
// lógica —stream, reenganche, ■, corregir, Deshacer, guardado— vive en
// `../chat/use-agent-chat.ts`, compartida con el chat nuevo (plans/new-chat/).
// Sin proyecto o cargando: un esqueleto o una tarjeta vacía, nunca una charla
// de mentira.
//
// ⚰️ Esta cabecera decía que el panel hablaba con `ai-design` por Gemini. Es
// falso desde que el Agente se graduó y Gemini salió (2026-08-28).

"use client";

import { useLocale, useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import {
  useCallback,
  useMemo,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";
import {
  ChatIcon,
  Crosshair,
  ImageIcon,
  Detener,
  Loader,
  SendUp,
  LenMark,
  TriangleAlert,
  Wand,
  X,
} from "../icons";
import { ReplaceAssetModal } from "../replace-asset-modal";
import { AgentActionCard, type AgentAction } from "../agent-action-card";

export type { HistoryEntry } from "@/lib/chat/historial-del-agente";
import { AgentConfirmCard } from "../agent-confirm-card";
import { AgentReplyCard, type EtiquetasDeRespuesta } from "../agent-reply-card";
import { mismaPagina, planDeUndo } from "./undo-turn";
import { MandoEsfuerzo } from "./mando-esfuerzo";
import { ModePicker } from "./mode-picker";
import type { AgentMode } from "@/lib/agent/dynamis";
import {
  NIVEL_POR_DEFECTO,
  type EsfuerzoAgente,
  type NivelEsfuerzo,
} from "@/lib/agent/esfuerzo";
import type { StoredChatTurn } from "@/lib/projects/types";
import type { SitePageSummary } from "@/lib/projects/site-pages";
import { TextoDeLen } from "../texto-de-len";
import { resaltarController } from "@/lib/workspace-v2/resaltar-controller";
import type { ComentarioDeLinea } from "@/lib/workspace-v2/comentarios-de-lineas";
import { duracionLegible, procesoDelTurno } from "@/lib/workspace-v2/proceso-del-turno";
import { ProcesoPlegable } from "../proceso-plegable";
import { cambiosEnVivo, type CambiosDeUnTurno } from "@/lib/workspace-v2/cambios-en-vivo";
import { abrirEnElCodigo, abrirFicheroDelTurno, rutasDelTurno } from "@/lib/workspace-v2/abrir-fichero";
import { FicherosDelTurnoEnVivo } from "../ficheros-del-turno";
import { agruparCambios, MAX_SECCIONES } from "@/lib/workspace-v2/diff-de-turno";
import { editsOfTurn, turnChanges } from "../chat/turn-changes";
import { MemoriaDeLen } from "../chat/len-memory";
import { isPublishNote } from "../chat/publish-note";
import {
  useAgentChat,
  type AttachedImage,
  type DesignTurn,
  type ScopedSelection,
} from "../chat/use-agent-chat";

/** Sin turnos con cambios (y en el servidor, donde el almacén no existe). */
const SIN_CAMBIOS: readonly CambiosDeUnTurno[] = [];
const SIN_COMENTARIOS: readonly ComentarioDeLinea[] = [];

// Los tipos del turno viven con la lógica (`../chat/use-agent-chat.ts`); se
// re-exportan aquí porque `left-sidebar.tsx` y otros los importan de este fichero.
export type { ScopedSelection, AttachedImage } from "../chat/use-agent-chat";

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
  /** External push of composer draft text — used by the post-swap chip
   *  to suggest a context-aware prompt. Set non-null to apply; chat-
   *  panel calls `onPendingDraftConsumed` once it has copied the value
   *  into its local state so the parent can null it out. */
  pendingDraft?: string | null;
  /** ¿Se manda solo, sin que el usuario tenga que pulsar Enviar?
   *
   * El flujo normal de `pendingDraft` es rellenar y enfocar: el usuario ve lo
   * que se va a pedir y decide. Para el botón «Arréglalo» de la medida del
   * navegador eso sobra — pulsar un botón que dice «arréglalo» y tener que
   * pulsar «Enviar» después es preguntar dos veces lo mismo. */
  pendingDraftAutoSend?: boolean;
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
  pendingDraft = null,
  pendingDraftAutoSend = false,
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
        pendingDraft={pendingDraft}
        pendingDraftAutoSend={pendingDraftAutoSend}
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

const QUICK_PROMPT_KEYS: ReadonlyArray<string> = [
  "quickPrompts.premium",
  "quickPrompts.linear",
  "quickPrompts.brutalist",
  "quickPrompts.playful",
  "quickPrompts.rewriteHero",
  "quickPrompts.testimonials",
];

/** Cuántas tarjetas de la terminal van antes de la `i`-ésima: su posición entre ellas. */
function indiceEntreLasDeLaTerminal(actions: readonly AgentAction[], i: number): number {
  return actions.slice(0, i).filter((a) => a.tool === "bash").length;
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
  pendingDraft = null,
  pendingDraftAutoSend = false,
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
  pendingDraft?: string | null;
  /** ¿Se manda solo, sin que el usuario tenga que pulsar Enviar?
   *
   * El flujo normal de `pendingDraft` es rellenar y enfocar: el usuario ve lo
   * que se va a pedir y decide. Para el botón «Arréglalo» de la medida del
   * navegador eso sobra — pulsar un botón que dice «arréglalo» y tener que
   * pulsar «Enviar» después es preguntar dos veces lo mismo. */
  pendingDraftAutoSend?: boolean;
  onPendingDraftConsumed?: () => void;
  sitePages?: SitePageSummary[];
}) {
  // LA LÓGICA ENTERA vive en `useAgentChat` (../chat/use-agent-chat.ts), la
  // misma que usa el chat nuevo. Aquí sólo se pinta.
  const {
    turns,
    draft,
    setDraft,
    sending,
    reenganche,
    latest,
    showThinkingDots,
    taRef,
    scrollRef,
    attachedImage,
    setAttachedImage,
    imageModalOpen,
    setImageModalOpen,
    comentarios,
    removeComentario,
    esfuerzo,
    esfuerzoNiveles,
    esfuerzoResuelveA,
    changeEsfuerzo,
    mode,
    setMode,
    modeOffered,
    agentModeUI,
    submit,
    handleRetry,
    handleCancel,
    handleUndo,
    handlePublished,
  } = useAgentChat({
    page,
    projectId,
    projectHtml,
    onLocalUpdate,
    initialChat,
    onChatChange,
    onRedesigningChange,
    scopedSelection,
    onClearScope,
    pendingDraft,
    pendingDraftAutoSend,
    onPendingDraftConsumed,
  });


  return (
    <div className="flex flex-col h-full">
      <MemoriaDeLen projectId={projectId} />
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto nice-scroll px-3 py-3 space-y-3"
      >
        {turns.length === 0 ? (
          <EmptyState onPick={(p) => setDraft(p)} disabled={sending || reenganche !== null} />
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
        onSubmit={submit}
        comentarios={comentarios}
        onQuitarComentario={removeComentario}
        onStop={handleCancel}
        sending={sending || reenganche !== null}
        textareaRef={taRef}
        sectionSelectMode={sectionSelectMode}
        onToggleSectionSelect={onToggleSectionSelect}
        scopedSelection={scopedSelection}
        onClearScope={onClearScope}
        attachedImage={attachedImage}
        onAttachImage={() => setImageModalOpen(true)}
        onClearAttachedImage={() => setAttachedImage(null)}
        esfuerzo={esfuerzo}
        esfuerzoNiveles={esfuerzoNiveles}
        esfuerzoResuelveA={esfuerzoResuelveA}
        onEsfuerzoChange={changeEsfuerzo}
        mode={mode}
        // Sin la terminal en el servidor, Dynamis no existe y no se ofrece; y
        // el chat clásico (`ai-design`, la vía de escape) no sabe de modos.
        {...(modeOffered ? { onModeChange: setMode } : {})}
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
  const { data: sesion } = useSession();
  const inicialDelUsuario = (
    sesion?.user?.name?.trim() || sesion?.user?.email?.split("@")[0] || "?"
  )
    .charAt(0)
    .toUpperCase();
  const tAgent = useTranslations("wsPage.agent");
  // Los textos de la tarjeta del borrador van por props (ver `AgentReplyCard`).
  const etiquetasDeRespuesta = useMemo<EtiquetasDeRespuesta>(
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
  // LAS RUTAS DE ESTE TURNO ABREN SU FICHERO (la #9 de plans/len-agente-2026/
  // notas/fase-5-taller.md): las de sus tarjetas y las que Len nombra entre
  // comillas de código, si el turno las leyó o las cambió. Las cambiadas salen
  // de la foto del turno (`cambiosEnVivo`), que vive lo que la pestaña.
  const turnosConCambios = useSyncExternalStore(
    cambiosEnVivo.subscribe,
    () => cambiosEnVivo.turnos(projectId),
    () => SIN_CAMBIOS,
  );
  const rutas = useMemo(
    () =>
      rutasDelTurno(
        turn.actions,
        turnosConCambios.find((x) => x.turnId === turn.id)?.ficheros.map((f) => f.ruta) ?? [],
      ),
    [turn.actions, turn.id, turnosConCambios],
  );
  const abrirFichero = useCallback(
    (ruta: string) => {
      abrirFicheroDelTurno(projectId, turn.id, ruta, { cambios: cambiosEnVivo, codigo: abrirEnElCodigo });
    },
    [projectId, turn.id],
  );
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
  // LOS PASOS DEL TURNO TERMINADO, PLEGADOS (la #13), como DeepSeek: la regla
  // en `lib/workspace-v2/proceso-del-turno.ts`.
  const locale = useLocale();
  const proceso = procesoDelTurno({
    status: turn.status,
    enServidor: turn.enServidor,
    cortado: turn.cortado,
    avisoTurno: turn.avisoTurno,
    pasos: turn.actions?.length ?? 0,
    startedAt: turn.startedAt,
    appliedAt: turn.appliedAt,
  });
  const tituloDelProceso = !proceso.plegable
    ? null
    : proceso.duracionMs === null
      ? t("proceso.completado")
      : t.rich("proceso.completadoEn", {
          duracion: duracionLegible(proceso.duracionMs, locale),
          d: (trozo) => <span className="font-mono tabular-nums">{trozo}</span>,
        });
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
          {/* Era una «J» fija para todo el mundo (plans/new-chat/, inventario N3). */}
          {inicialDelUsuario}
        </span>
        <div className="min-w-0 max-w-[80%] text-right">
          <div className="inline-block max-w-full rounded-2xl px-3 py-2 text-left bg-accent-soft text-accent border border-[color:var(--accent)]/30">
            {turn.attachedImage && (
              <div className="mb-1.5 flex items-center gap-1.5">
                {/* Una foto, como siempre; con dos o más (Crear es Len), todas. */}
                {(turn.attachedImages ?? [turn.attachedImage]).map((f) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={f.url}
                    src={f.url}
                    alt=""
                    className="h-9 w-9 rounded object-cover ring-1 ring-[color:var(--accent)]/30"
                  />
                ))}
                <span className="text-[10px] fg-faint ui-small">
                  {turn.attachedImages && turn.attachedImages.length > 1
                    ? t("turn.imagesSent", { count: turn.attachedImages.length })
                    : t("turn.imageSent")}
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
              <ProcesoPlegable plegable={proceso.plegable} titulo={tituloDelProceso}>
                <div className="space-y-1">
                  {turn.actions.map((a, i) => (
                    <AgentActionCard
                      key={`${a.tool}-${i}`}
                      action={a}
                      onAbrirFichero={abrirFichero}
                      // La de la terminal sabe qué comando del turno es: con eso
                      // encuentra su salida (`salida-de-la-tarjeta.ts`).
                      {...(a.tool === "bash"
                        ? { terminal: { projectId, turnId: turn.id, indice: indiceEntreLasDeLaTerminal(turn.actions!, i) } }
                        : {})}
                    />
                  ))}
                </div>
              </ProcesoPlegable>
            )}
            <div className="inline-block max-w-full rounded-2xl px-3 py-2 text-left bg-elev border bd">
              {turn.assistantReasoning.length > 0 && (
                <div className="text-[12.5px] fg leading-relaxed whitespace-pre-wrap break-words">
                  <TextoDeLen texto={turn.assistantReasoning} rutas={rutas} onAbrir={abrirFichero} />
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
              <FicherosDelTurnoEnVivo projectId={projectId} turnId={turn.id} />
            </div>
            {turn.confirm && (
              <AgentConfirmCard projectId={projectId} confirm={turn.confirm} onPublished={onPublished} />
            )}
            {turn.respuesta && <AgentReplyCard respuesta={turn.respuesta} labels={etiquetasDeRespuesta} />}
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
      // Salvo en la nota «✓ Publicada…», que no es un turno de Len (ver
      // `chat/publish-note.ts`).
      if (isPublishNote(turn)) return null;
      return (
        <div className={marginClass}>
          <div className="inline-flex items-center gap-1.5 rounded-md bg-app border bd px-1.5 py-0.5 text-[10.5px] fg-faint ui-small">
            <span>{t("noChange.label")}</span>
          </div>
          <AvisoDeTurno texto={turn.avisoTurno} cortado={turn.cortado} />
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
            {editsOfTurn(turn)
              ? t("applied.labelConEdits", {
                  edits: editsOfTurn(turn),
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
        <AvisoDeTurno texto={turn.avisoTurno} cortado={turn.cortado} />
        {turn.undoFallo && (
          <div className="mt-1 flex items-start gap-1.5 rounded-md ring-1 ring-red-500/40 bg-red-500/5 px-2 py-1 text-[11px] text-red-600 dark:text-red-400 max-w-full">
            <X size={11} className="mt-0.5 shrink-0" />
            <span className="flex-1 break-words">
              {turn.undoFallo.motivo === "red"
                ? t("undo.failedNetwork")
                : turn.undoFallo.motivo === "respuesta"
                  ? t("undo.failedResponse")
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
function AvisoDeTurno({ texto, cortado }: { texto?: string; cortado?: boolean }) {
  const t = useTranslations("panelsChat");
  const tAgent = useTranslations("wsPage.agent");
  // Una fila que el servidor guardó como cortada no trae el motivo concreto:
  // el genérico existe ya en los diez idiomas.
  if (!texto && cortado) texto = tAgent("errors.cancelled");
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

// Exportado sólo para /dev/terminal, que lo pinta con datos de ejemplo.
export function Composer({
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
  attachedImage = null,
  onAttachImage,
  onClearAttachedImage,
  esfuerzo = "auto",
  esfuerzoNiveles = ["low", "medium", "high"],
  esfuerzoResuelveA = NIVEL_POR_DEFECTO,
  onEsfuerzoChange,
  mode = "len",
  onModeChange,
  agentMode = false,
  comentarios = SIN_COMENTARIOS,
  onQuitarComentario,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  /** Los comentarios de líneas que van con este mensaje (la #8), como fichas. */
  comentarios?: readonly ComentarioDeLinea[];
  onQuitarComentario?: (id: number) => void;
  /** Detener el turno en marcha. Se llama cuando la caja esta VACIA y el turno
   *  corre: sin nada que decir, lo unico que se puede querer es parar. */
  onStop?: () => void;
  sending: boolean;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  sectionSelectMode?: boolean;
  onToggleSectionSelect?: (active: boolean) => void;
  scopedSelection?: ScopedSelection | null;
  onClearScope?: () => void;
  attachedImage?: AttachedImage | null;
  onAttachImage?: () => void;
  onClearAttachedImage?: () => void;
  /** CUÁNTO PIENSA LEN. `auto` no es un peldaño de la escalera: es «elige tú»,
   *  y por eso se pinta aparte y AL FINAL, igual que en Claude Code (la
   *  escalera son los cinco niveles; `auto` se añade suelto). */
  esfuerzo?: EsfuerzoAgente;
  /** A qué nivel resuelve `auto`, para poder DECIRLO. Claude Code nunca deja al
   *  usuario sin saber en qué nivel corre: imprime `Effort level: auto
   *  (currently high)`. Un «automático» a secas es la caja negra que este
   *  mando vino a quitar. */
  esfuerzoNiveles?: readonly NivelEsfuerzo[];
  esfuerzoResuelveA?: NivelEsfuerzo;
  onEsfuerzoChange?: (e: EsfuerzoAgente) => void;
  /** QUÉ LEN TRABAJA: Len o Len Dynamis. Sin `onModeChange` el selector no se
   *  pinta (el servidor no lo ofrece). En Dynamis el mando de esfuerzo se
   *  bloquea: ese modo piensa siempre al máximo. */
  mode?: AgentMode;
  onModeChange?: (m: AgentMode) => void;
  /** Modo Agente. Aqui decia ademas que "esconde el ModelPicker": ese selector
   *  y todo su cableado salieron el 2026-08-28. Sigue existiendo porque cambia
   *  otras cosas de esta barra. */
  agentMode?: boolean;
}) {
  const t = useTranslations("panelsChat");
  const [esfuerzoAbierto, setEsfuerzoAbierto] = useState(false);
  const [modeOpen, setModeOpen] = useState(false);
  // Con comentarios esperando se puede mandar sin escribir nada más.
  const hayQueMandar = value.trim().length > 0 || comentarios.length > 0;
  return (
    <div className="shrink-0 px-3 pb-3">
      {comentarios.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1.5" data-comentarios-del-mensaje="">
          {comentarios.map((c) => (
            <div
              key={c.id}
              title={c.texto}
              className="inline-flex max-w-full items-center gap-1.5 rounded-md ring-1 ring-[color:var(--accent)]/40 bg-accent-soft px-2 py-1 text-[11px] text-accent ui-small fade-in"
            >
              <ChatIcon size={11} />
              <span className="shrink-0 font-mono text-[10.5px]">
                {c.ruta.replace(/^\/+/, "")}:{c.linea}
              </span>
              <span className="min-w-0 truncate fg-muted">{c.texto}</span>
              <button
                type="button"
                onClick={() => onQuitarComentario?.(c.id)}
                aria-label={t("comentarios.quitar")}
                className="shrink-0 inline-flex h-4 w-4 items-center justify-center rounded hover:bg-[color:var(--accent)]/20 transition"
              >
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}
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
            {onModeChange && (
              <ModePicker
                mode={mode}
                onChange={onModeChange}
                abierto={modeOpen}
                onAbrir={(v) => {
                  setModeOpen(v);
                  if (v) setEsfuerzoAbierto(false);
                }}
                t={t}
              />
            )}
            {onEsfuerzoChange && (
              <MandoEsfuerzo
                esfuerzo={esfuerzo}
                niveles={esfuerzoNiveles}
                resuelveA={esfuerzoResuelveA}
                onChange={onEsfuerzoChange}
                abierto={esfuerzoAbierto}
                onAbrir={(v) => {
                  setEsfuerzoAbierto(v);
                  if (v) setModeOpen(false);
                }}
                locked={onModeChange !== undefined && mode === "dynamis"}
                t={t}
              />
            )}
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
            {/* ⚰️ AQUÍ VIVÍA «Rellenar» (autofill). Nadie le pasaba `onAutofill`
                —`left-sidebar.tsx` nunca lo hizo—, así que era un botón que no
                se podía pulsar. Jesús, 03/10 (plans/new-chat/): fuera de los dos
                chats. El diálogo de autorrelleno sigue existiendo aparte. */}
          </div>
          <button
            type="button"
            onClick={sending && !value.trim() ? onStop : onSubmit}
            disabled={!sending && !hayQueMandar}
            aria-label={
              sending
                ? value.trim()
                  ? t("composer.steer")
                  : t("composer.stop")
                : t("composer.send")
            }
            className={`inline-flex items-center justify-center gap-1 h-7 rounded-md text-[11.5px] font-medium transition ${
              value.trim() || (!sending && hayQueMandar)
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
  // La cuenta es la de `../chat/turn-changes.ts`, la misma del chat nuevo: las
  // ops mandan sobre el diff (el porqué está allí).
  const cambios = useMemo(
    () => turnChanges(turn, (donde) => t(`diff.${donde}`)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [turn.actions, turn.preEditHtml, turn.postEditHtml, t],
  );

  if (cambios.length === 0) return null;
  // Se agrupa ANTES de topar: si no, el tope de 6 se gastaba en repeticiones
  // del mismo nombre y escondía secciones que sí eran distintas.
  const agrupados = agruparCambios(cambios);
  const visibles = agrupados.slice(0, MAX_SECCIONES);
  const resto = agrupados.length - visibles.length;

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
          {/* El contador va FUERA de la frase traducida y en cifra: «×3» se lee
              igual en los diez idiomas y no obliga a tocar diez ficheros de
              mensajes para decir un número. */}
          {c.veces > 1 && (
            <span aria-label={`${c.veces}`} className="shrink-0 tabular-nums fg-faint">
              ×{c.veces}
            </span>
          )}
          {/* El «ver» sólo cuando hay a dónde ir: una sección QUITADA ya no está
              en la página, y un turno que editó OTRA página movería el lienzo a
              un documento que no es el que se está mirando. */}
          {c.indice >= 0 && mismaPagina && (
            <button
              type="button"
              onClick={() => resaltarController.resaltar(c.ruta ?? c.indice)}
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
