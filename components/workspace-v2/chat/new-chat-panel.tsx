"use client";

// EL CHAT NUEVO (plans/new-chat/). Mismas props y mismo sitio que `ChatPanel`
// (`panels/chat-panel.tsx`), para poder alternar con un interruptor
// (`use-chat-version.ts`); la lógica es la MISMA (`useAgentChat`), sólo cambia
// la piel. El inventario de lo que tiene que hacer —el contrato para cambiar el
// viejo por éste— está en `plans/new-chat/inventory.md`.

import "./new-chat.css";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import type { MenuSkill } from "./skill-menu";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";

import { CaraDeLen } from "@/components/llamada/cara-de-len";
import { ReplaceAssetModal } from "../replace-asset-modal";
import { useToast } from "../toast";
import { ATTACHMENT_ACCEPT } from "@/lib/workspace-v2/upload-attachment";
import { useChatAttachments, type ChatAttachmentMessages } from "./use-chat-attachments";
import { useFileDrop } from "./use-file-drop";
import { DropOverlay } from "./drop-overlay";
import { MAX_PHOTOS_PER_MESSAGE } from "@/lib/projects/chat-photos";
import type { EtiquetasDeRespuesta } from "../agent-reply-card";
import type { StoredChatTurn } from "@/lib/projects/types";
import { ChatComposer } from "./chat-composer";
import { SecretDialog } from "./secret-dialog";
import { functionSecretsAvailable } from "@/lib/workspace-v2/function-secrets-request";
import type { FoundSecret } from "@/lib/apps/env/secret-patterns";
import { ChatHeader } from "./chat-header";
import { inicialDe, LenTurn, UserMessage } from "./chat-turn";
import { LiveBar } from "./live-bar";
import { GoalCardView } from "./goal-card";
import { isRunning, liveStatus } from "./live-status";
import { useAgentChat, type PendingAttachments } from "./use-agent-chat";
import { useMentionIndex } from "./use-mention-index";
import type { IncomingMention } from "@/lib/mentions/types";
import { useConversations } from "./use-conversations";
import { useScheduledTasks } from "./use-scheduled-tasks";
import { setChatLayout, useChatLayout, useFloatBox, type FloatBox } from "./use-chat-version";
import type { LiveStatus } from "./live-status";
import { useIsMobile } from "../use-is-mobile";
import { turnosDelHilo } from "@/lib/workspace-v2/turnos-del-hilo";
import { abrirEnElCodigo } from "@/lib/workspace-v2/abrir-fichero";
import { useTurnFeedback } from "./use-turn-feedback";
import { useGenteDelChat } from "./use-gente-del-chat";
import { useSondeoDelEquipo } from "./use-sondeo-del-equipo";
import { MensajeDelEquipo } from "./mensaje-del-equipo";
import { GenteDelChat } from "./gente-del-chat";
import { LineaDeDestino } from "./linea-de-destino";
import { destinoDe, permitido } from "@/lib/workspace-v2/destino-del-mensaje";
import { colorDePersona } from "@/lib/workspace-v2/menciones";
import type { LatestTurn } from "@/lib/workspace-v2/app-birth";

export interface NewChatPanelProps {
  flatProjectId?: string;
  flatProjectHtml?: string;
  flatProjectPage?: string | null;
  onFlatHtmlUpdate?: (newHtml: string, page?: string | null, untrusted?: boolean) => void;
  flatProjectChat?: StoredChatTurn[];
  onChatChange?: () => void;
  onRedesigningChange?: (active: boolean) => void;
  /** Ver `AgentChatOptions.onLatestTurnChange`. */
  onLatestTurnChange?: (turn: LatestTurn | null) => void;
  /** El turno de un «Aplicar» del modo Diseño acabó (`useAgentChat`). */
  onDesignSettled?: (ok: boolean) => void;
  projectLoading?: boolean;
  sectionSelectMode?: boolean;
  onToggleSectionSelect?: (active: boolean) => void;
  /** A click on the canvas that became a mention (spec local 2026-10-27): the panel puts it in the draft. */
  incomingMention?: IncomingMention | null;
  onIncomingMentionConsumed?: () => void;
  pendingDraft?: string | null;
  pendingDraftAutoSend?: boolean;
  onPendingDraftConsumed?: () => void;
  /** Ver `AgentChatOptions.pendingAttachments`. */
  pendingAttachments?: PendingAttachments | null;
  /** El proyecto es una app: la caja vacía habla de la app. */
  esApp?: boolean;
  /** En el móvil el panel tapa la pantalla: la ✕ de la cabecera lo cierra. */
  onClose?: () => void;
  /** Un lector del proyecto compartido: lee la conversación, no escribe. */
  soloLectura?: boolean;
  /** The conversation takes the workspace center: the project has nothing to look at yet (no page, no app, no
   *  deliverable), as Claude keeps the chat in the middle until an artifact exists. Docked, centered at a reading
   *  width, and with no way to float it off an empty screen. */
  centered?: boolean;
}

const SUGGESTIONS = ["photos", "form", "mobile", "publish"] as const;
/** In the center, the conversation keeps a reading width (760 px) and the rest is margin. */
const CENTERED_PADDING = "px-[max(1rem,calc((100%_-_760px)/2))]";
// En una app no hay portada ni formulario de contacto: sus datos y su login.
const APP_SUGGESTIONS = ["data", "login", "mobile", "publish"] as const;

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
  centered = false,
  flatProjectHtml = "",
  flatProjectPage = null,
  onLocalUpdate,
  flatProjectChat,
  onChatChange,
  onRedesigningChange,
  onLatestTurnChange,
  onDesignSettled,
  sectionSelectMode = false,
  onToggleSectionSelect,
  incomingMention = null,
  onIncomingMentionConsumed,
  pendingDraft = null,
  pendingDraftAutoSend = false,
  onPendingDraftConsumed,
  pendingAttachments = null,
  esApp = false,
  onClose,
  soloLectura = false,
}: NewChatPanelProps & {
  projectId: string;
  onLocalUpdate: NonNullable<NewChatPanelProps["onFlatHtmlUpdate"]>;
}) {
  const t = useTranslations("panelsChat");
  const tAgent = useTranslations("wsPage.agent");
  const toast = useToast();
  // UN PDF EN EL CHAT (26/10): se elige, se sube y queda como ficha; Len lo lee con Read.
  const pdfInput = useRef<HTMLInputElement | null>(null);
  // SKILLS (spec local 2026-10-26-len-skills): what the `/` menu offers, asked once per project.
  const [skills, setSkills] = useState<readonly MenuSkill[]>([]);
  useEffect(() => {
    let vivo = true;
    fetch(`/api/projects/${encodeURIComponent(projectId)}/skills`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { skills?: unknown } | null) => {
        if (vivo && Array.isArray(j?.skills)) setSkills(j.skills as MenuSkill[]);
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [projectId]);
  // `@Len` DESDE UN HILO DEL CÓDIGO: el servidor ya empezó el turno; aquí se
  // pinta en marcha y se sigue (lib/workspace-v2/turnos-del-hilo.ts).
  const turnoDelHilo = useSyncExternalStore(
    turnosDelHilo.subscribe,
    () => turnosDelHilo.primero(projectId),
    () => null,
  );
  const tSidebar = useTranslations("wsChrome");
  const chat = useAgentChat({
    page: flatProjectPage,
    projectId,
    projectHtml: flatProjectHtml,
    onLocalUpdate,
    initialChat: flatProjectChat,
    onChatChange,
    onRedesigningChange,
    onLatestTurnChange,
    onDesignSettled,
    pendingDraft,
    pendingDraftAutoSend,
    onPendingDraftConsumed,
    pendingAttachments,
  });
  const { seguirTurnoDelHilo } = chat;
  // DROP, PASTE OR PICK (spec local 2026-10-27-chat-drop-and-images): every way in uploads the same way.
  const attachMessages = useMemo<ChatAttachmentMessages>(
    () => ({
      notSupported: (names) => t("composer.dropNotSupported", { names }),
      tooBig: (names) => t("composer.dropTooBig", { names }),
      limit: (count) => t("composer.dropLimit", { count }),
      failed: (name) => t("composer.fileFailedNamed", { name }),
    }),
    [t],
  );
  const attach = useChatAttachments({
    projectId,
    images: chat.attachedImages,
    setImages: chat.setAttachedImages,
    files: chat.attachedFiles,
    setFiles: chat.setAttachedFiles,
    notify: toast.error,
    messages: attachMessages,
  });
  const drop = useFileDrop({ enabled: !soloLectura, onFiles: attach.addFiles });
  // THE CHAT'S «@» (spec local 2026-10-27): the index of what can be pointed at,
  // revalidated when a turn ends (Len may have changed the files) and when the
  // box gets focus; and the clicks on the canvas that become mentions.
  const mentionIdx = useMentionIndex(soloLectura ? null : projectId);
  const mentionIndex = mentionIdx.ready ? { entries: mentionIdx.entries, files: mentionIdx.files } : null;
  const refreshMentions = mentionIdx.refresh;
  const wasBusy = useRef(chat.busy);
  useEffect(() => {
    if (wasBusy.current && !chat.busy) refreshMentions();
    wasBusy.current = chat.busy;
  }, [chat.busy, refreshMentions]);
  useEffect(() => {
    const box = chat.taRef.current;
    if (!box) return;
    box.addEventListener("focus", refreshMentions);
    return () => box.removeEventListener("focus", refreshMentions);
  }, [chat.taRef, refreshMentions]);
  const { addMention, setMentions } = chat;
  useEffect(() => {
    if (!incomingMention) return;
    if (incomingMention.labelInDraft) setMentions((m) => [...m, incomingMention.ref]);
    else addMention(incomingMention.ref);
    chat.taRef.current?.focus();
    onIncomingMentionConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingMention?.id]);
  // EDGE FUNCTIONS (spec local 2026-10-11, Parte 4): una clave en el mensaje se
  // guarda como secreto en vez de mandársela a Len. Se pregunta UNA vez si el
  // servidor guarda secretos (sin funciones, el compositor manda como siempre).
  const [secretoAGuardar, setSecretoAGuardar] = useState<FoundSecret | null>(null);
  const secretosDisponibles = useRef<Promise<boolean> | null>(null);
  const secretGuard = useMemo(
    () =>
      soloLectura
        ? undefined
        : {
            available: () => (secretosDisponibles.current ??= functionSecretsAvailable(projectId)),
            onSaveAsSecret: (f: FoundSecret) => setSecretoAGuardar(f),
          },
    [projectId, soloLectura],
  );
  useEffect(() => {
    if (!turnoDelHilo) return;
    turnosDelHilo.recogido(projectId, turnoDelHilo);
    seguirTurnoDelHilo(turnoDelHilo);
  }, [turnoDelHilo, projectId, seguirTurnoDelHilo]);
  const feedback = useTurnFeedback(projectId);
  const conversations = useConversations(projectId, chat.conversationChanged);
  // The clock of the project's scheduled tasks (spec local 2026-10-29-tareas-programadas, §7.8).
  const scheduled = useScheduledTasks(projectId, chat.busy);
  const [settledConfirms, setSettledConfirms] = useState<ReadonlySet<string>>(() => new Set());
  const { data: session } = useSession();
  const initial = useMemo(
    () => inicialDe(session?.user?.name?.trim() || session?.user?.email),
    [session?.user?.name, session?.user?.email],
  );

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
  const layout = isMobile || centered ? "docked" : storedLayout;
  // EL FLOTANTE SE PLIEGA AL INPUT (2026-10-20, Jesús): una barra fina con el
  // compositor; el historial sale al enfocar la caja y se vuelve a plegar al
  // hacer clic en la página (`ChatFrame`). Mientras está plegado, lo que dice
  // la barra viva al terminar un turno se queda hasta que lo ves: al abrir el
  // historial ese turno cuenta como visto y la barra vuelve a ser sólo el input.
  const flotante = layout === "floating";
  const [historiaAbierta, setHistoriaAbierta] = useState(false);
  const plegado = flotante && !historiaAbierta;
  // Sólo avisa de un turno que se vio correr en esta pestaña: el último de una
  // charla vieja, al recargar, no es noticia.
  const [vistoHasta, setVistoHasta] = useState<string | null>(null);
  const [corrioAqui, setCorrioAqui] = useState<string | null>(null);
  const ultimoId = chat.latest?.id ?? null;
  const corriendo = isRunning(status);
  useEffect(() => {
    if (corriendo) setCorrioAqui(ultimoId);
  }, [corriendo, ultimoId]);
  useEffect(() => {
    if (historiaAbierta) setVistoHasta(ultimoId);
  }, [historiaAbierta, ultimoId]);
  const avisoPendiente = corriendo || status.kind === "waiting" || (corrioAqui === ultimoId && ultimoId !== vistoHasta);
  const settle = useCallback((turnId: string) => {
    setSettledConfirms((s) => new Set(s).add(turnId));
  }, []);

  // EL CHAT DEL EQUIPO (docs/superpowers/specs/2026-10-07-chat-del-equipo-design.md):
  // en un proyecto con miembros, `@persona` sin `@Len` es un mensaje para ella
  // (Len no responde); con `@Len`, un turno como siempre. Sin miembros, nada cambia.
  const equipo = useGenteDelChat(projectId);
  const idsDelEquipo = useMemo(() => equipo.gente.map((p) => p.userId), [equipo.gente]);
  const colorDe = useCallback((id: string) => colorDePersona(id, idsDelEquipo), [idsDelEquipo]);
  const destino = destinoDe(chat.draft, equipo.gente, equipo.yo);
  // A quién sugiere el «@» de la caja: la gente menos uno mismo, y Len si puede.
  const mencionables = useMemo(
    () => ({ gente: equipo.gente.filter((p) => p.userId !== equipo.yo), colorDe, conLen: equipo.puedeLen }),
    [equipo.gente, equipo.yo, equipo.puedeLen, colorDe],
  );
  const [errorEquipo, setErrorEquipo] = useState(false);
  // Un mensaje al equipo en vuelo: ni un segundo Enter ni el botón lo repiten.
  const [enviandoEquipo, setEnviandoEquipo] = useState(false);
  const enviandoEquipoRef = useRef(false);
  // La firma que este panel ya conoce: tras enviar se fija aquí, y el sondeo no
  // vuelve a releer por un cambio que acabamos de hacer nosotros.
  const firmaRef = useRef<string | null>(null);
  // Minimizado, el chat sigue montado pero nadie lo ve: no marca nada visto.
  const aLaVista = layout !== "minimized";
  const aLaVistaRef = useRef(aLaVista);
  aLaVistaRef.current = aLaVista;
  const leerFirma = useCallback(async (): Promise<string | null> => {
    const r = await fetch(`/api/projects/${encodeURIComponent(projectId)}/chat/mensajes?solo=firma`, { cache: "no-store" }).catch(() => null);
    const j = r?.ok ? ((await r.json().catch(() => null)) as { firma?: unknown } | null) : null;
    return typeof j?.firma === "string" ? j.firma : null;
  }, [projectId]);
  const marcarVisto = useCallback(() => {
    void fetch(`/api/projects/${encodeURIComponent(projectId)}/chat/mensajes/vistas`, { method: "POST" }).catch(() => {});
  }, [projectId]);
  // Con el proyecto compartido y el chat abierto, se relee sólo si la firma de
  // la conversación cambió (use-sondeo-del-equipo).
  useSondeoDelEquipo({
    compartido: equipo.compartido,
    soloConfirmado: equipo.yo !== null && !equipo.compartido,
    leerFirma,
    alCambiar: () => {
      onChatChange?.();
      // Lo que llega con el chat a la vista, visto queda (el punto del carril).
      if (aLaVistaRef.current) marcarVisto();
    },
    ocupado: () => chat.busy,
    firmaRef,
  });
  // Ver el chat ve las menciones (el punto del carril se apaga): al abrirlo, y
  // al volver de minimizado.
  useEffect(() => {
    if (equipo.compartido && aLaVista) marcarVisto();
  }, [equipo.compartido, aLaVista, marcarVisto]);
  const enviarAlEquipo = async (): Promise<boolean> => {
    if (destino.tipo !== "personas") return false;
    if (enviandoEquipoRef.current) return true;
    enviandoEquipoRef.current = true;
    setEnviandoEquipo(true);
    setErrorEquipo(false);
    try {
      const r = await fetch(`/api/projects/${encodeURIComponent(projectId)}/chat/mensajes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          texto: chat.draft,
          menciones: destino.personas.map((p) => p.userId),
          idioma: document.documentElement.lang || undefined,
          // La foto adjunta viaja con el mensaje, como un adjunto en Slack.
          ...(chat.attachedImages.length > 0 ? { fotos: chat.attachedImages } : {}),
        }),
      }).catch(() => null);
      if (!r?.ok) {
        setErrorEquipo(true);
        return true;
      }
      chat.setDraft("");
      // A message to people carries its mentions as their labels, nothing more (spec §6.1).
      chat.setMentions([]);
      chat.setAttachedImage(null);
      // La firma nueva es nuestra: el sondeo no tiene que releer por ella.
      firmaRef.current = await leerFirma();
      onChatChange?.();
      return true;
    } finally {
      enviandoEquipoRef.current = false;
      setEnviandoEquipo(false);
    }
  };
  const enviar = async () => {
    if (equipo.compartido) {
      if (!permitido(destino, equipo.puedeLen)) return;
      if (await enviarAlEquipo()) return;
    }
    chat.submit();
  };
  // Los mensajes entre personas no son turnos: la pregunta de Len la contesta
  // su turno siguiente, no lo que se digan dos personas en medio.
  const siguienteDeLen = (i: number) => chat.turns.slice(i + 1).find((x) => x.tipo !== "persona");

  const body = (
    <div className={`nc relative flex h-full min-h-0 flex-col bg-side ${flotante ? "rounded-[22px]" : ""}`} {...drop.handlers}>
      {drop.dragging && <DropOverlay label={t("composer.dropHere")} />}
      <ChatHeader
        layout={layout}
        onLayout={setChatLayout}
        conversations={conversations}
        busy={chat.busy}
        onClose={onClose}
        closeLabel={tSidebar("sidebar.collapsePanel")}
        relativeTime={relativeTime}
        esApp={esApp}
        noFloat={centered}
        scheduled={scheduled}
      />
      {equipo.compartido && !plegado && (
        <div className="flex shrink-0 justify-end border-b bd px-4 py-1.5">
          <GenteDelChat
            gente={equipo.gente}
            yo={equipo.yo}
            colorDe={colorDe}
            onMencionar={(n) => {
              const d = chat.draft;
              chat.setDraft(`${d}${d && !d.endsWith(" ") ? " " : ""}@${n} `);
              queueMicrotask(() => chat.taRef.current?.focus());
            }}
          />
        </div>
      )}
      {/* Plegado se oculta, no se desmonta: así conserva el scroll y sus
          tarjetas (el Deshacer y el «comparar» viven en memoria). */}
      <div
        ref={chat.scrollRef}
        // A11: la conversación entera; lo de antes llega al acercarse arriba.
        onScroll={(e) => {
          if (e.currentTarget.scrollTop < 200) void chat.loadOlder();
        }}
        className={`nice-scroll min-h-0 flex-1 flex-col gap-4 overflow-y-auto pb-3 pt-5 ${centered ? CENTERED_PADDING : "px-4"} ${plegado ? "hidden" : "flex"}`}>
        {chat.turns.length === 0 ? (
          <EmptyState
            disabled={chat.busy}
            sinSugerencias={soloLectura}
            esApp={esApp}
            onPick={(text) => {
              chat.setDraft(text);
              queueMicrotask(() => chat.taRef.current?.focus());
            }}
          />
        ) : (
          chat.turns.map((turn, i) =>
            turn.tipo === "persona" ? (
              <MensajeDelEquipo key={turn.id} turn={turn} gente={equipo.gente} yo={equipo.yo} colorDe={colorDe} />
            ) : (
            <div key={turn.id} className="flex flex-col gap-4">
              <UserMessage turn={turn} initial={initial} onAbrirOrigen={(ruta) => abrirEnElCodigo.abrir(projectId, ruta)} gente={equipo.gente} colorDe={colorDe} yo={equipo.yo} />
              <LenTurn
                turn={turn}
                next={siguienteDeLen(i)}
                isLast={siguienteDeLen(i) === undefined}
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
                {...(soloLectura ? {} : { onUndo: chat.handleUndo })}
                onRetry={chat.handleRetry}
                onPublished={chat.handlePublished}
                onConfirmSettled={settle}
                onAnswerQuestion={chat.answerQuestion}
                onDismissQuestion={(id) => void chat.dismissQuestion(id)}
                onRate={(rating, reasons, note) => feedback.rate(turn.id, rating, reasons ?? [], note ?? null)}
                onClearRate={() => feedback.clear(turn.id)}
                goalRunsOn={chat.goal?.activation === "armed" && chat.goal.phase === "active"}
                {...(soloLectura ? {} : { onContinue: chat.continueWith })}
                esApp={esApp}
              />
            </div>
            ),
          )
        )}
      </div>
      <div className={`relative z-[2] shrink-0 ${flotante ? "px-2 pb-1 pt-0.5" : centered ? `${CENTERED_PADDING} pb-4 pt-1` : "px-3 pb-3 pt-1"}`}>
        {(!plegado || avisoPendiente) && (
          <LiveBar status={status} onStop={chat.handleCancel} esApp={esApp} />
        )}
        {/* Pieza 8: el encargo, si hay uno vivo (en marcha, en pausa o atascado). */}
        {chat.goalOffered && (
          <GoalCardView
            goal={chat.goal}
            busy={chat.busy}
            stoppedForCredits={chat.goalStoppedForCredits}
            onResume={chat.resumeGoal}
            onClear={() => void chat.clearGoal()}
          />
        )}
        {soloLectura && !equipo.compartido ? (
          <p className="m-3 rounded-xl border bd bg-elev px-3 py-2.5 text-[12.5px] fg-muted" data-solo-lectura="">
            {t("composer.soloLectura")}
          </p>
        ) : (
          <ChatComposer
            skills={skills}
            value={chat.draft}
            onChange={chat.setDraft}
            onSubmit={() => void enviar()}
            onStop={chat.handleCancel}
            busy={chat.busy}
            textareaRef={chat.taRef}
            comments={chat.comentarios}
            onRemoveComment={chat.removeComentario}
            scopedSelection={null}
            mentionIndex={mentionIndex}
            mentions={chat.mentions}
            onMentionsChange={chat.setMentions}
            sectionSelectMode={sectionSelectMode}
            onToggleSectionSelect={onToggleSectionSelect}
            attachedImage={chat.attachedImage}
            onAttachImage={() => chat.setImageModalOpen(true)}
            onClearAttachedImage={() => chat.setAttachedImage(null)}
            attachedImages={chat.attachedImages}
            onRemoveImage={(url) => chat.setAttachedImages((prev) => prev.filter((i) => i.url !== url))}
            attachedFiles={chat.attachedFiles}
            {...(soloLectura ? {} : { onAttachPdf: () => pdfInput.current?.click() })}
            onRemoveFile={(url) => chat.setAttachedFiles(chat.attachedFiles.filter((f) => f.url !== url))}
            pendingUploads={attach.pending}
            onCancelUpload={attach.cancel}
            {...(soloLectura ? {} : { onPasteFiles: attach.addFiles })}
            effort={chat.esfuerzo}
            effortLevels={chat.esfuerzoNiveles}
            effortResolvesTo={chat.esfuerzoResuelveA}
            onEffortChange={chat.changeEsfuerzo}
            mode={chat.mode}
            {...(chat.modeOffered ? { onModeChange: chat.setMode } : {})}
            planMode={chat.planMode}
            {...(chat.planOffered ? { onTogglePlan: chat.togglePlan } : {})}
            goalChip={chat.goalChip}
            goalAvailable={chat.goalAvailable}
            esApp={esApp}
            {...(chat.goalOffered ? { onToggleGoal: chat.toggleGoalChip } : {})}
            {...(secretGuard ? { secretGuard } : {})}
            compacta={flotante}
            {...(equipo.compartido
              ? {
                  placeholder: t("equipo.placeholder"),
                  mencionables,
                  // Lo que no se va a enviar no se ofrece: un mensaje al equipo
                  // en vuelo, o un lector que le pide algo a Len.
                  bloqueado: enviandoEquipo || !permitido(destino, equipo.puedeLen),
                  debajo: (
                    <>
                      <LineaDeDestino destino={destino} puedeLen={equipo.puedeLen} colorDe={colorDe} />
                      {errorEquipo && <p className="px-3 pb-1 text-[11.5px] text-accent">{t("equipo.error")}</p>}
                    </>
                  ),
                  ...(destino.tipo === "personas"
                    ? { etiquetaEnviar: t("equipo.enviarA", { nombre: destino.personas.map((p) => p.nombre).join(", ") }) }
                    : {}),
                }
              : {})}
          />
        )}
      </div>
      {secretoAGuardar && (
        <SecretDialog
          projectId={projectId}
          found={secretoAGuardar}
          onSaved={(name) => {
            chat.setDraft(chat.draft.split(secretoAGuardar.value).join(name));
            setSecretoAGuardar(null);
          }}
          onClose={() => setSecretoAGuardar(null)}
        />
      )}
      <input
        ref={pdfInput}
        type="file"
        multiple
        accept={ATTACHMENT_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? []);
          e.target.value = "";
          attach.addFiles(picked);
        }}
      />
      <ReplaceAssetModal
        open={chat.imageModalOpen}
        kind={chat.imageModalOpen ? "image" : null}
        projectId={projectId}
        onClose={() => chat.setImageModalOpen(false)}
        onPick={(payload) => {
          // One more photo for the message, up to the limit.
          if (payload.url) {
            const img = { url: payload.url, ...(payload.alt ? { alt: payload.alt } : {}) };
            chat.setAttachedImages((prev) => [...prev.filter((i) => i.url !== img.url), img].slice(0, MAX_PHOTOS_PER_MESSAGE));
          }
          chat.setImageModalOpen(false);
        }}
      />
    </div>
  );

  return (
    <ChatFrame layout={layout} status={status} expanded={historiaAbierta} onExpandedChange={setHistoriaAbierta}>
      {body}
    </ChatFrame>
  );
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
  expanded,
  onExpandedChange,
  children,
}: {
  layout: "docked" | "floating" | "minimized";
  status: LiveStatus;
  /** Flotando: con el historial a la vista (si no, sólo la barra del input). */
  expanded: boolean;
  onExpandedChange: (open: boolean) => void;
  children: ReactNode;
}) {
  const t = useTranslations("panelsChat");
  const [box, setBox] = useFloatBox();
  const frameRef = useRef<HTMLDivElement>(null);
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

  // SE PLIEGA AL HACER CLIC EN LA PÁGINA. Un clic dentro del lienzo no llega a
  // este documento (es otro, en su iframe): lo delata que la ventana pierde el
  // foco y el foco queda en un IFRAME. Lo que se abre encima en un diálogo
  // (la imagen, el secreto) no cuenta como «fuera».
  const onExpandedChangeRef = useRef(onExpandedChange);
  onExpandedChangeRef.current = onExpandedChange;
  useEffect(() => {
    if (!floating) return;
    const fuera = (e: PointerEvent) => {
      const target = e.target;
      if (!(target instanceof Node) || frameRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest('[role="dialog"]')) return;
      onExpandedChangeRef.current(false);
    };
    const alLienzo = () => {
      window.setTimeout(() => {
        if (document.activeElement?.tagName === "IFRAME") onExpandedChangeRef.current(false);
      }, 0);
    };
    document.addEventListener("pointerdown", fuera, true);
    window.addEventListener("blur", alLienzo);
    return () => {
      document.removeEventListener("pointerdown", fuera, true);
      window.removeEventListener("blur", alLienzo);
    };
  }, [floating]);
  // La barra se ancla por ABAJO: plegada mide lo que su contenido y, al
  // abrirse, crece hacia arriba hasta el alto de la caja.
  const floatStyle =
    floating && box
      ? {
          left: box.x,
          bottom: Math.max(8, window.innerHeight - (box.y + box.h)),
          width: box.w,
          ...(expanded ? { height: box.h } : {}),
        }
      : undefined;
  return (
    <>
      <div
        ref={frameRef}
        className={
          docked
            ? "h-full"
            : floating
              ? "nc nc-float-dark nc-card-in fixed z-[45] flex flex-col rounded-[22px] border bd-strong shadow-[0_24px_64px_-16px_rgba(0,0,0,0.55)]"
              : "hidden"
        }
        style={floatStyle}
        // Enfocar la caja de escribir abre el historial.
        onFocusCapture={
          floating
            ? (e) => {
                if (e.target instanceof HTMLTextAreaElement) onExpandedChange(true);
              }
            : undefined
        }
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
        {!docked && expanded && (
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

export function EmptyState({
  onPick,
  disabled,
  sinSugerencias = false,
  esApp = false,
}: {
  onPick: (text: string) => void;
  disabled: boolean;
  /** Un lector no escribe: proponerle qué pedir sería un botón que no lleva a nada. */
  sinSugerencias?: boolean;
  /** El proyecto es una app: su título y sus sugerencias (el subtítulo es el mismo). */
  esApp?: boolean;
}) {
  const t = useTranslations("panelsChat");
  const title = esApp ? t("newChat.emptyApp.title") : t("newChat.empty.title");
  const suggestions = esApp
    ? APP_SUGGESTIONS.map((key) => ({ key, text: t(`newChat.emptyApp.suggestions.${key}`) }))
    : SUGGESTIONS.map((key) => ({ key, text: t(`newChat.empty.suggestions.${key}`) }));
  return (
    <div className="nc-up my-auto grid justify-items-center gap-2 px-1 py-3 text-center">
      <CaraDeLen estado="reposo" props="compact" className="mb-2.5 h-[84px] w-[84px]" />
      <h2 className="m-0 font-[family-name:var(--font-instrument)] text-[31px] font-normal leading-[1.08] tracking-[-0.01em]">
        {title}
      </h2>
      <p className="m-0 text-[13.5px] fg-muted">{t("newChat.empty.subtitle")}</p>
      <div className="mt-[18px] flex flex-wrap justify-center gap-1.5" hidden={sinSugerencias}>
        {suggestions.map(({ key, text }) => (
          <button
            key={key}
            type="button"
            disabled={disabled}
            onClick={() => onPick(text)}
            className="rounded-full border bd px-3 py-[5px] text-[12.5px] fg-muted transition hover:border-[color:var(--border-strong)] hover:bg-elev hover:fg disabled:opacity-50"
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}
