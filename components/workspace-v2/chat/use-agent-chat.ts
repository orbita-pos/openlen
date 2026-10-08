"use client";

// LA LÓGICA DEL CHAT CON LEN, sin la piel (plans/new-chat/).
//
// Vivía dentro de `AIDesignChat`, en `panels/chat-panel.tsx`, y se sacó TAL
// CUAL —cortada y pegada, no reescrita— para que el chat de hoy y el chat nuevo
// usen la misma: el stream, el reenganche, ■, corregir el rumbo, Deshacer, el
// guardado, la convergencia entre pestañas, el esfuerzo y el modo. Cada arreglo
// de aquí costó un fallo de verdad, y los comentarios que lo cuentan se vinieron
// con el código. Si algo de esto está mal, se arregla AQUÍ, para los dos chats.
//
// Lo que es sólo de pintar (burbujas, tarjetas, el compositor) se queda en cada
// chat. Lo que sí está aquí aunque toque el DOM son dos refs que los dos chats
// necesitan igual: la caja de texto (crece sola y el borrador de fuera la
// enfoca) y la lista (baja sola al final).

import { useLocale, useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { noCreditsText, notifyCreditBalanceChanged } from "@/lib/credits-client";
import type { AgentAction } from "../agent-action-card";
import { upsertActionInto } from "./action-cards";
import { answerSummary, asksTheOwner, questionsFrom, type QuestionAnswer, type UserQuestion } from "@/lib/agent/ask-user-question";
import { composeAnswerMessage, fallbackDelivery, liveQuestionTurno, outcomeOfResponder } from "./question-answer";
import { lastPlanMode, planAnswersForMessage, planModeAfterAnswer, togglePlanSelection } from "./plan-mode-state";
import { canCreateGoal, goalOrder, goalViewOf, lastGoal, roundAfterDone, roundOfTurn, roundTextFor, type GoalView } from "./goal-state";
import type { AgentConfirm } from "../agent-confirm-card";
import type { RespuestaPreparada } from "@/lib/agent/resultados";
import { ejecutarUndo, ficherosDelEvento, planDeUndo, type FalloDeUndo } from "../panels/undo-turn";
import { notifyFolderChanged } from "@/lib/lienzo/carpeta-cambiada";
import { cierreDeTurno, laPaginaNoCambio, lineaGuardadaDelCierre } from "../panels/turno-cerrado";
import { NIVEL_POR_DEFECTO, type EsfuerzoAgente, type NivelEsfuerzo } from "@/lib/agent/esfuerzo";
import type { AgentMode } from "@/lib/agent/dynamis";
import type { StoredChatTurn } from "@/lib/projects/types";
import { MAX_PHOTOS_PER_MESSAGE } from "@/lib/projects/chat-photos";
import type { StyleDirection } from "@/lib/style-match/direction-types";
import type { AgentErrorCode, AgentStreamEvent } from "@/lib/agent/loop";
import { accionesAlRecargar, historialParaElAgente, type HistoryEntry } from "@/lib/chat/historial-del-agente";
import { fusionarConversacion } from "@/lib/chat/fusionar-conversacion";
import { withServerStatus } from "./server-status";
import { publishNoteId } from "./publish-note";
import { scanController, scanFxUnavailable } from "@/lib/workspace-v2/scan-controller";
import { terminalEnVivo } from "@/lib/workspace-v2/terminal-en-vivo";
import { leerCambiosDelComando } from "@/lib/agent/terminal/cambios-del-comando";
import {
  MAX_PROMPT,
  MAX_TEXTO_ESCRITO,
  comentariosDelChat,
  textoConComentarios,
  type ComentarioDeLinea,
} from "@/lib/workspace-v2/comentarios-de-lineas";
import { cambiosEnVivo, esFicheroCambiado } from "@/lib/workspace-v2/cambios-en-vivo";
import type { OpDescrita } from "@/lib/agent/ops-descritas";
import { ownerReasonFrom } from "@/lib/agent/owner-reason";
import { httpErrorText } from "./http-error";
import { camposDeNacer, type PideNacer } from "./nace-como";

/** El evento `html` del bucle, tal cual sale por el cable. Se usa como TIPO al
 *  leer el payload para que un renombrado allí rompa aquí la compilación en vez
 *  de dejar el campo leyéndose `undefined` para siempre. */
type EventoHtmlDelAgente = Extract<AgentStreamEvent, { type: "html" }>;

const SIN_COMENTARIOS: readonly ComentarioDeLinea[] = [];

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

export type TurnStatus = "streaming" | "applied" | "error" | "reverted";

export interface DesignTurn {
  id: string;
  userText: string;
  /** Pedido con `@Len` desde un hilo del código: la etiqueta «desde el hilo». */
  origen?: { hiloId: string; ruta: string; linea: number };
  /** Quién lo pidió, si viene del servidor (`StoredChatTurn.autor`). Sin él,
   *  es de quien mira: lo acaba de mandar desde aquí. */
  autor?: string;
  /** EL CHAT DEL EQUIPO (`StoredChatTurn.tipo`): un mensaje entre personas. */
  tipo?: "persona";
  /** Quién escribió la fila, para su color (`StoredChatTurn.autorId`). */
  autorId?: string;
  /** A quién menciona. */
  menciones?: string[];
  /** Image attached to this turn — rendered in the user bubble as proof
   *  it was actually sent with the message. */
  attachedImage?: AttachedImage;
  /** Crear es Len: todas las fotos del turno, sólo cuando son dos o más
   *  (`attachedImage` es entonces la primera). */
  attachedImages?: readonly AttachedImage[];
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
  /** Un reintento del proveedor en curso (`retry` del bucle). `until` = cuándo
   *  acaba la espera en el reloj del navegador. Se borra en cuanto llega texto
   *  o una tarjeta, o el turno pasa a seguirse desde el servidor. */
  retrying?: { attempt: number; maxAttempts: number; until: number };
  /** Len está resumiendo lo más viejo de la conversación para seguir
   *  (`compaction_start`). Se borra cuando acaba (`compaction`), con el primer
   *  texto o tarjeta, o si el turno pasa a seguirse desde el servidor. */
  compacting?: boolean;
  /** Pieza 3 de Len 2.5: la pregunta de `ask_user_question` que espera respuesta
   *  DENTRO del turno (evento `question`). Se borra cuando llega su tarjeta
   *  (contestada o no). */
  pendingQuestions?: UserQuestion[];
  /** Lo que el dueño contestó a esa pregunta viva, mientras llega su tarjeta:
   *  la tarjeta se encoge en cuanto contesta, sin esperar al servidor. */
  answeredLive?: string;
  errorText?: string;
  /** HTML before this turn ran. YA NO es lo que se manda al deshacer —el
   *  servidor lee la versión de su propia base— sino lo que alimenta el diff
   *  del pie del turno (`CambiosDelTurno`). */
  preEditHtml: string;
  /** LA DIRECCIÓN DEL DESHACER: la versión que el servidor archivó con el
   *  documento de ANTES del turno («Before AI edit», `persistPage`).
   *
   *  Viaja por el evento `html` del Agente y por el `done` del Chat clásico. Se
   *  queda el PRIMERO del turno, no el último: un turno puede escribir varias
   *  veces y sólo el primer «antes» es el de antes del turno.
   *
   *  Ausente = turno anterior al 2026-09-04 o restaurado de otra sesión → sin
   *  Deshacer, ver ./undo-turn. No vive en la transcripción a propósito: al
   *  recargar, el turno ya no ofrece Deshacer por no tener preimagen, así que
   *  persistirlo sólo añadiría una columna que nadie lee. */
  versionPrevia?: string | null;
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
  /** LA CARPETA (pieza 9 de Len 2.5): los ficheros que el turno cambió, cada
   *  uno con la versión de su «antes» (evento `ficheros`). Deshacer los
   *  devuelve con la página o no se ofrece — ver ./undo-turn. Local, como
   *  `paginasTocadas`. */
  ficherosTocados?: ReadonlyArray<{ readonly ruta: string; readonly versionPrevia: string | null }>;
  /** El turno se cortó DESPUÉS de haber cambiado la página. Se pinta como
   *  aviso sobre un turno aplicado, no como error: el cambio ya vive en la
   *  base y decir «falló» manda al usuario a repetirlo. */
  avisoTurno?: string;
  /** Se cortó a medias: en vivo (`aplicado-con-aviso`) o leído de una fila que
   *  el servidor guardó como cortada. Es lo que el historial marca para el
   *  modelo y lo que pinta el aviso al recargar. */
  cortado?: boolean;
  /** El servidor rechazó el último Deshacer. El turno SIGUE aplicado. */
  undoFallo?: FalloDeUndo;
  /** F2 de las apps web: el id con el que el servidor guardó lo que cambió el
   *  turno (evento `deshacible`): con él, Deshacer lo hace el servidor entero.
   *  Ver `TurnoParaUndo.deshacerEnServidor`. */
  deshacerEnServidor?: string;
  /** Lo que el turno cambió y NO volvió al deshacerlo (la base de datos de
   *  /supabase, la memoria, los ajustes): se dice bajo «Revertido». */
  noSeDeshizo?: string[];
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
  /** El borrador de `draft_reply` (plans/len-resultados/): una tarjeta
   *  que sólo manda si el usuario toca. Local, como `confirm`: no se guarda. */
  respuesta?: RespuestaPreparada;
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
  /** LEN 2.1 · el turno sigue trabajando EN EL SERVIDOR y esta vista no tiene
   *  su stream: vino así al cargar (otra pestaña, el móvil) o esta pestaña lo
   *  perdió por el camino. El panel relee su fila hasta que cierra. */
  enServidor?: boolean;
  /** Lo que COBRÓ el turno (centicréditos) y lo que tardó, según el servidor
   *  (el `done` y, al recargar, la fila). El cierre del chat nuevo los enseña
   *  (plans/new-chat/). Ausentes en turnos viejos y en los de `ai-design`. */
  centicredits?: number;
  durationMs?: number;
}

const FLUSH_INTERVAL_MS = 800;
const FLUSH_CHAR_BUDGET = 2000;
/** Lo que se espera a que el servidor cierre un turno parado con ■ (N40). El
 *  bucle se entera en su siguiente llamada al modelo; una comprobación con el
 *  navegador en medio puede tardar unos segundos. */
const STOP_FALLBACK_MS = 20_000;

// F4 Task 7 — kill-switch fallback: flips true the first time /api/agent
// reports `code: "agent_off"` (server env OPENLEN_AGENT=0). Module state
// (not component state) so it survives an AIDesignChat remount — switching
// pages remounts the chat via the `key` in ChatPanel above — while still
// resetting on a hard reload, which is what "rest of the browser session"
// means here. Once true, `send()` skips the agent branch outright and goes
// straight to classic ai-design for every later turn in this session.
let agentKilledThisSession = false;

export interface AgentChatOptions {
  projectId: string;
  projectHtml: string;
  page?: string | null;
  /** Write a document's html into the parent's project state. `page`
   *  pins the slot (null = home); undefined = whatever page is active. */
  /** `untrusted` marca el HTML que todavía NO pasó por el sanitizador del
   *  servidor: el drip crudo de un rewrite Modo B. Viaja junto al html (y no
   *  como señal aparte) para que no puedan desincronizarse — el preview lo
   *  usa para pintar bajo CSP y sin instrumentar. */
  onLocalUpdate: (newHtml: string, page?: string | null, untrusted?: boolean) => void;
  initialChat?: StoredChatTurn[];
  onChatChange?: () => void;
  onRedesigningChange?: (active: boolean) => void;
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
  /** LO QUE VIAJA CON EL BORRADOR que se manda solo (plans/crear-es-len): las
   *  fotos y la referencia por URL del estado vacío, el primer mensaje de un
   *  proyecto en blanco. Se consume con el borrador. */
  pendingAttachments?: PendingAttachments | null;
}

/** Las fotos (ya subidas) y la referencia que acompañan a un borrador. */
export interface PendingAttachments extends PideNacer {
  readonly images: readonly AttachedImage[];
  readonly styleDirection: StyleDirection | null;
  // UNA APP NACE (`PideNacer`): la tarjeta App del estado vacío. El servidor
  // convierte el proyecto en blanco en app antes del turno
  // (`lib/projects/nacer-como-app.ts`), con el idioma de la interfaz de `lang`.
}

export function useAgentChat({
  page = null,
  projectId,
  projectHtml,
  onLocalUpdate,
  initialChat,
  onChatChange,
  onRedesigningChange,
  scopedSelection = null,
  onClearScope,
  pendingDraft = null,
  pendingDraftAutoSend = false,
  onPendingDraftConsumed,
  pendingAttachments = null,
}: AgentChatOptions) {
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
  // CUÁNTO PIENSA LEN. Vive en el PADRE porque lo necesitan dos sitios: el
  // mando que lo pinta y el `send` que lo fija en el turno. `auto` hasta que la
  // carga diga otra cosa — es el mismo estado que `null` en la base.
  const [esfuerzo, setEsfuerzo] = useState<EsfuerzoAgente>("auto");
  const [esfuerzoResuelveA, setEsfuerzoResuelveA] = useState<NivelEsfuerzo>(NIVEL_POR_DEFECTO);
  // LOS PELDAÑOS que el modelo del papel ofrece hoy. Los dice el servidor
  // (`capacidadDeEsfuerzo`), porque dependen del MODELO y no de una constante
  // del cliente. Hasta que conteste se arranca con NUESTRA reserva
  // —`["low","medium","high"]`— y no con los cinco: si la lectura falla, es
  // mejor ofrecer de menos que ofrecer un peldaño que este modelo no tiene.
  //
  // ⚰️ Esta línea la llamaba «la reserva de Claude Code». No lo es: la suya es
  // permisiva (ver `NIVELES_SIN_MEDIR` en `lib/agent/esfuerzo.ts`). La elección
  // de arrancar corto sigue siendo la correcta, pero es nuestra.
  const [esfuerzoNiveles, setEsfuerzoNiveles] = useState<readonly NivelEsfuerzo[]>([
    "low",
    "medium",
    "high",
  ]);
  // QUÉ LEN TRABAJA: Len o Len Dynamis (`lib/agent/dynamis.ts`). Viaja con el
  // turno como el esfuerzo y NO se guarda (ver `mode-picker.tsx`). El selector
  // sólo se pinta si el servidor lo ofrece, que es con la terminal encendida.
  const [mode, setMode] = useState<AgentMode>("len");
  // PIEZA 7 · EL MODO PLAN. `planKnown` es lo que dice el servidor (el último
  // turno cerrado y los eventos `plan` del turno en vuelo); `planWanted`, lo que
  // el dueño eligió y aún no ha viajado. Al servidor sólo viaja la elección
  // (`plan-mode-state.ts` dice por qué). Los refs, para que `send` y
  // `answerQuestion` lean el valor de AHORA.
  const [planKnown, setPlanKnown] = useState<boolean>(() => lastPlanMode(initialChat ?? []));
  const [planWanted, setPlanWanted] = useState<boolean | null>(null);
  const planKnownRef = useRef(planKnown);
  planKnownRef.current = planKnown;
  const planWantedRef = useRef(planWanted);
  planWantedRef.current = planWanted;
  /** La elección que viajó con el turno en vuelo: se da por aplicada cuando el
   *  servidor dice con qué modo empezó. */
  const planSentRef = useRef<boolean | null>(null);
  // PIEZA 8 · EL ENCARGO. `goalKnown` es lo que dice el servidor (el último
  // turno cerrado, y los eventos `goal`/`done` del turno en vuelo); `goalChip`,
  // la ficha «Encargo» del compositor (lo que se mande será el objetivo). Al
  // servidor viaja la orden (`goal: "create" | "resume"`), nunca el estado.
  const [goalKnown, setGoalKnown] = useState<GoalView | null>(() => lastGoal(initialChat ?? []));
  const goalKnownRef = useRef(goalKnown);
  goalKnownRef.current = goalKnown;
  const [goalChip, setGoalChip] = useState(false);
  const goalChipRef = useRef(goalChip);
  goalChipRef.current = goalChip;
  /** La cadena de rondas paró porque no quedaba saldo (`done.round.stopped`). */
  const [goalStoppedForCredits, setGoalStoppedForCredits] = useState(false);
  const [dynamisOffered, setDynamisOffered] = useState(false);
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
  // LEN 2.1 · EL TURNO QUE SIGUE EN EL SERVIDOR sin stream en esta vista (el id
  // de su fila). Mientras haya uno, el compositor está ocupado igual que con un
  // turno propio: ■ lo para y lo escrito lo corrige, con el `turnoId` que
  // devuelve su fila.
  const [reenganche, setReenganche] = useState<string | null>(null);
  // Se pulsó ■ sobre el turno reenganchado (N38): su fila borrada es «Cancelado.»,
  // no un error de red.
  const stopRequestedRef = useRef(false);
  // El turno que ESTA pestaña lee por su stream: la convergencia no puede
  // pisarlo con la fila del servidor, que va unos segundos por detrás.
  const enVueloRef = useRef<string | null>(null);
  // 🔴 N40 (plans/new-chat/): EL ■ DE UN TURNO DEL AGENTE NO CORTA LA LECTURA.
  // Cortarla pintaba «Cancelado.» en rojo, con Reintentar, sobre lo que el
  // servidor hacía de verdad. Visto en el taller el 03/10, las dos mitades: un
  // ■ antes del evento `turno` no llegaba a pedir nada y el servidor —que desde
  // Len 2.1 no para cuando el cliente se va— hizo el turno entero y lo cobró
  // (1,13 créditos); un ■ tras el primer cambio lo dejaba guardado («cortado»)
  // y el lienzo y el chat decían que no. Ahora se pide parar y se espera al
  // cierre del servidor (`error` cancelled + `done`), que es quien sabe si
  // cambió algo: rojo si no, el ámbar de C7 si sí.
  const agentStreamOpenRef = useRef(false);
  const stopFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // La red de seguridad saltó: el turno se sigue desde su fila, no se da por
  // cancelado sin saberlo.
  const stopFellBackRef = useRef(false);
  const requestStop = useCallback((turnoId: string) => {
    void fetch("/api/agent/cancelar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ turnoId }),
      keepalive: true,
    }).catch(() => {});
    // Si el servidor no cierra el turno a tiempo (una herramienta larga entre
    // dos llamadas al modelo, la red), se deja de esperar y se sigue la fila.
    if (agentStreamOpenRef.current && !stopFallbackRef.current) {
      stopFallbackRef.current = setTimeout(() => {
        stopFallbackRef.current = null;
        if (!agentStreamOpenRef.current) return;
        stopFellBackRef.current = true;
        abortRef.current?.abort();
      }, STOP_FALLBACK_MS);
    }
  }, []);

  // Bumps every 15s so "Applied · 12s ago" stays accurate without
  // per-message timers.
  const [, setNowTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setNowTick((n) => n + 1), 15_000);
    return () => window.clearInterval(id);
  }, []);

  // LA POSTURA GUARDADA, y a qué nivel resuelve `auto`. Las dos las dice el
  // SERVIDOR: `resuelveA` es la misma constante que usará el cable en ese
  // turno, y tenerla copiada aquí sería la segunda fuente por la que la
  // etiqueta acaba mintiendo. Si la lectura falla se queda `auto` con el
  // defecto — el mando sigue usable y el servidor resuelve igual.
  useEffect(() => {
    let vivo = true;
    fetch("/api/agent/esfuerzo")
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (
          d: {
            esfuerzo?: EsfuerzoAgente;
            niveles?: readonly NivelEsfuerzo[];
            resuelveA?: NivelEsfuerzo;
            dynamis?: boolean;
          } | null,
        ) => {
          if (!vivo || !d) return;
          if (d.esfuerzo) setEsfuerzo(d.esfuerzo);
          if (d.niveles?.length) setEsfuerzoNiveles(d.niveles);
          if (d.resuelveA) setEsfuerzoResuelveA(d.resuelveA);
          setDynamisOffered(d.dynamis === true);
        },
      )
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, []);

  // Bumps every 1s WHILE a turn is mid-stream so the elapsed-time label
  // in the streaming footer refreshes live. Cheaper than a global ticker
  // — only runs when there's something to count.
  useEffect(() => {
    if (!sending && !reenganche) return;
    const id = window.setInterval(() => setNowTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [sending, reenganche]);

  // 🔴 AQUÍ NO SE ABORTA NADA AL DESMONTAR, Y ES A PROPÓSITO.
  //
  // Hasta el 2026-09-10 este efecto hacía `abortRef.current?.abort()` en su
  // limpieza — el reflejo de «limpia tu fetch al desmontar», sin un comentario
  // que lo justificara. El efecto real era otro: este panel se monta bajo
  // `{mode === "chat" && <ChatPanel/>}` (left-sidebar.tsx), así que
  // CAMBIAR DE PESTAÑA EN LA BARRA LATERAL MATABA EL TURNO EN MARCHA. Sin
  // aviso, a media edición, y dejando la página con medio cambio aplicado: el
  // usuario pulsaba «Reintentar» y se aplicaba dos veces. El propio repo lo
  // tiene documentado como incidente en app/api/agent/route.ts, donde un turno
  // abortado al remontarse el panel se persiguió como un fallo del proveedor.
  //
  // LA VARA (Claude Code): el trabajo pertenece a la SESIÓN, no a la
  // vista. Mandar un turno al fondo (`←` / Ctrl+B) lo deja corriendo; mirar otra
  // cosa no cancela nada. Una vista es una vista.
  //
  // Lo que hace que esto sea seguro AHORA y no antes: desde `a5f71151` el
  // SERVIDOR registra el turno desde su `finally`, así que el turno que termina
  // con este panel desmontado deja fila igual. Y el efecto de convergencia de
  // aquí abajo la mete en la conversación en cuanto el padre refresca. El bucle
  // de lectura que queda suelto escribe sobre un componente desmontado, que en
  // React 18 es un no-op.
  //
  // El botón de parar SIGUE abortando (`handleCancel`): cancelar es una
  // decisión del usuario; cambiar de pestaña no lo es.

  // Mirror streaming state to the parent so the preview can overlay the
  // page-building loader while the model redesigns — but ONLY when the scan
  // effect can't render (kill switch / reduced motion). Otherwise the loader
  // would sit at z-40 over the iframe and hide the scan sweep entirely.
  // Cleanup forces it off si el chat se desmonta a media faena — que desde el
  // 2026-09-10 NO aborta el turno (ver el bloque de arriba): el turno sigue en
  // el servidor y esto sólo apaga el velo de esta vista.
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
    // `enCurso` y `cortado` viajan con `status: "applied"`: sin ellos en la
    // firma, un turno que termina en el servidor no volvería a converger.
    .map((s) => `${s.id}:${s.status}:${s.enCurso ? "c" : ""}${s.cortado ? "x" : ""}${s.planMode ? "p" : ""}`)
    .join("|");
  const chatSeededRef = useRef(false);
  useEffect(() => {
    if (!chatSeededRef.current) {
      // First run = the useState seed; nothing to reconcile.
      chatSeededRef.current = true;
      return;
    }
    const server = initialChatRef.current ?? [];
    // PIEZA 7: lo que dice el servidor del modo plan, salvo con un turno propio
    // en vuelo (su fila aún no está, y sus eventos son más nuevos). Cubre el
    // turno reenganchado, que no trae eventos.
    if (!enVueloRef.current) setPlanKnown(lastPlanMode(server));
    // PIEZA 8: y el encargo, por lo mismo.
    if (!enVueloRef.current) setGoalKnown(lastGoal(server));
    // Server turns first (chronological, the authority). Keep the local
    // DesignTurn where we have it — it carries preEditHtml for in-session
    // Undo — but take status from the server (another tab may have undone
    // it). Restore turns we've never seen. Desde Len 2.1 la regla entera —el
    // turno en vuelo y los que siguen en el servidor— vive en
    // `fusionarConversacion`, con sus pruebas.
    setTurns((prev) =>
      fusionarConversacion(prev, server, {
        enVuelo: enVueloRef.current,
        restaurar: restoreTurn,
        // El de otra pestaña (deshecho), sí; pero no le quita su error a un
        // turno que aquí falló (ver `server-status.ts`).
        conEstado: withServerStatus,
        // Los errores no se guardan (ni aquí ni, si fueron un rechazo
        // temprano, en el servidor): que no salten al final al converger.
        keepsPlace: (t) => t.status === "error",
      }),
    );
  }, [initialChatSig]);

  // External draft push (post-swap "Update copy?" chip flow). Apply once,
  // focus the textarea so the user can edit or hit Send, then consume.
  useEffect(() => {
    if (!pendingDraft) return;
    // El envío automático tiene su propio efecto, más abajo: éste sólo
    // rellenaría el campo y consumiría el borrador antes de que aquél lo vea.
    if (pendingDraftAutoSend) return;
    setDraft(pendingDraft);
    // Defer focus until the textarea has the new value applied.
    queueMicrotask(() => {
      taRef.current?.focus();
      // Place caret at end so the user can keep typing if they want.
      const el = taRef.current;
      if (el) el.setSelectionRange(el.value.length, el.value.length);
    });
    onPendingDraftConsumed?.();
  }, [pendingDraft, pendingDraftAutoSend, onPendingDraftConsumed]);

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
  // `done`/`error`; with tools in parallel (pieza 4) several can be running at
  // once — see `upsertActionInto` for which card an outcome replaces.
  const upsertAction = useCallback((id: string, action: AgentAction) => {
    setTurns((prev) =>
      prev.map((t) =>
        t.id === id
          ? { ...t, actions: upsertActionInto(t.actions, action) }
          : t,
      ),
    );
  }, []);

  /** `@Len` DESDE UN HILO DEL CÓDIGO: el servidor ya lo empezó (como Claude
   *  Tag); se pinta en marcha y el efecto de abajo lo sigue desde su fila. */
  const seguirTurnoDelHilo = useCallback((turno: { filaId: string; texto: string; origen: NonNullable<DesignTurn["origen"]> }) => {
    setTurns((prev) =>
      prev.some((t) => t.id === turno.filaId)
        ? prev
        : [
            ...prev,
            restoreTurn({
              id: turno.filaId,
              userText: turno.texto,
              assistantReasoning: "",
              status: "applied",
              appliedAt: Date.now(),
              enCurso: true,
              origen: turno.origen,
            }),
          ],
    );
  }, []);

  /** LEN 2.1 · Este turno sigue en el servidor y esta vista ya no tiene su
   *  stream: se pinta en marcha y se relee su fila (efecto de abajo). */
  const seguirEnElServidor = useCallback((id: string) => {
    setTurns((prev) =>
      // Sin `retrying`: si el stream se cayó entre un reintento y su texto, la
      // barra tiene que decir que sigue en el servidor, no «Reintentando».
      prev.map((t) => (t.id === id ? { ...t, status: "streaming", enServidor: true, retrying: undefined, compacting: undefined } : t)),
    );
    setReenganche(id);
  }, []);

  // LEN 2.1 · UN TURNO QUE LLEGA EN CURSO DESDE EL SERVIDOR —al cargar, o por
  // la convergencia con otra pestaña— se sigue desde su fila. Uno a la vez: el
  // compositor sólo puede corregir o parar uno.
  useEffect(() => {
    if (reenganche) return;
    const pendiente = turns.find((x) => x.enServidor && x.status === "streaming");
    if (pendiente) {
      // Un turno que esta pestaña no empezó: nadie le ha pulsado ■ todavía.
      stopRequestedRef.current = false;
      setReenganche(pendiente.id);
    }
  }, [turns, reenganche]);

  // LEN 2.1 · RELEER LA FILA cada ~3 s hasta que el turno cierra (decisión de
  // Jesús, 30/09: releer la fila, sin un stream que reenganchar). Al cerrar se
  // refresca el proyecto: la página nueva y la conversación ya asentada.
  useEffect(() => {
    if (!reenganche) return;
    const fila = reenganche;
    let vivo = true;
    // (Aquí se ponía `stopRequestedRef` a cero. Ya no: si el ■ de un turno
    // propio no recibió respuesta a tiempo (N40), se sigue desde su fila y su
    // 404 tiene que seguir siendo «Cancelado.». Se pone a cero al empezar cada
    // turno, y al recoger uno que esta pestaña no empezó.)
    const terminar = () => {
      turnoIdRef.current = null;
      setReenganche(null);
      onChatChangeRef.current?.();
      notifyCreditBalanceChanged();
    };
    const leer = async () => {
      let r: Response;
      try {
        r = await fetch(`/api/agent/turno/${encodeURIComponent(fila)}`, { cache: "no-store" });
      } catch {
        return; // sin red todavía: se vuelve a intentar en la siguiente vuelta
      }
      if (!vivo) return;
      if (r.status === 404) {
        // El servidor nunca llegó a abrir la fila (o el turno no produjo
        // nada): ahora sí es el error de red de siempre. SALVO si se pidió
        // parar (N38, plans/new-chat/): un ■ sobre un turno que aún no cambió
        // nada borra su fila, y esto decía «Error de red» a quien lo acababa de
        // parar. Visto en el taller el 03/10.
        const errorText = stopRequestedRef.current ? t("errors.cancelled") : t("errors.network");
        setTurns((prev) =>
          prev.map((x) => (x.id === fila ? { ...x, status: "error", enServidor: false, errorText } : x)),
        );
        terminar();
        return;
      }
      if (!r.ok) return;
      const cuerpo = (await r.json().catch(() => null)) as { turno?: StoredChatTurn; turnoId?: string; siguiente?: unknown; preguntas?: unknown } | null;
      if (!vivo || !cuerpo?.turno) return;
      const turno = cuerpo.turno;
      if (turno.enCurso) {
        if (cuerpo.turnoId) turnoIdRef.current = cuerpo.turnoId;
        setTurns((prev) =>
          prev.map((x) =>
            x.id === fila
              ? {
                  ...x,
                  userText: turno.userText,
                  assistantReasoning: turno.assistantReasoning,
                  actions: accionesAlRecargar(turno.actions),
                  // La pregunta que Len espera AHORA (`ask_user_question`):
                  // como DeepSeek, quien se reengancha la recibe otra vez y la
                  // puede contestar. Sin esto la tarjeta no salía hasta que
                  // vencía la espera. El servidor manda: sin pregunta, fuera.
                  pendingQuestions: questionsFrom(cuerpo.preguntas) ?? undefined,
                }
              : x,
          ),
        );
        return;
      }
      // PIEZA 8: el encargo como quedó y, si esta ronda dio paso a otra, la
      // siguiente se pinta en marcha (el efecto de arriba la recoge y la sigue).
      const goalTras = turno.goal ? goalViewOf(turno.goal, turno.goal.activation) : null;
      if (goalTras) setGoalKnown(goalTras);
      const siguiente = typeof cuerpo.siguiente === "string" ? cuerpo.siguiente : null;
      setTurns((prev) => {
        const restaurados = prev.map((x) => (x.id === fila ? restoreTurn(turno) : x));
        return siguiente && !restaurados.some((x) => x.id === siguiente)
          ? [...restaurados, rondaEnCamino(siguiente, goalTras)]
          : restaurados;
      });
      terminar();
    };
    void leer();
    const reloj = window.setInterval(() => void leer(), 3000);
    return () => {
      vivo = false;
      window.clearInterval(reloj);
    };
  }, [reenganche, t]);

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
      // La versión que el servidor archivó con el documento de ANTES del turno.
      // Sin ella el turno no ofrece Deshacer — ver ./undo-turn.
      let versionPrevia: string | null = null;
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
          // EL CÓDIGO GANA A LA PROSA, y el `error` crudo no se pinta nunca: ver
          // ./http-error (N44). Una página grande le decía «Page too large for
          // an agent turn» a un usuario japonés, en los 10 locales.
          const texto = httpErrorText(res.status, errPayload?.code);
          updateTurn(turnId, { status: "error", errorText: t(texto.key, texto.values) });
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let sseBuf = "";
        let finalHtml: string | null = null;
        let errorMessage: string | null = null;
        // Lo que cobró y tardó, del `done` (N35): el cierre los enseña igual que
        // en un turno del Agente.
        let centicredits: number | undefined;
        let durationMs: number | undefined;

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
              const data = payload as {
                html?: string;
                reasoning?: string;
                versionPrevia?: unknown;
                centicredits?: unknown;
                durationMs?: unknown;
              };
              if (typeof data.html === "string") finalHtml = data.html;
              if (typeof data.centicredits === "number" && Number.isFinite(data.centicredits) && data.centicredits >= 0) {
                centicredits = data.centicredits;
              }
              if (typeof data.durationMs === "number" && Number.isFinite(data.durationMs) && data.durationMs >= 0) {
                durationMs = data.durationMs;
              }
              // LA DIRECCIÓN DEL DESHACER. Aquí sólo hay UNA escritura por
              // turno, así que no hay «primero» que elegir como en el Agente.
              if (typeof data.versionPrevia === "string" && data.versionPrevia) {
                versionPrevia = data.versionPrevia;
              }
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
            versionPrevia,
            ...(centicredits !== undefined ? { centicredits } : {}),
            ...(durationMs !== undefined ? { durationMs } : {}),
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

  // LOS COMENTARIOS DE LÍNEAS que esperan el siguiente mensaje (la #8): los
  // añaden las lentes «Código» y «Cambios»; aquí se enseñan y se mandan.
  const comentarios = useSyncExternalStore(
    comentariosDelChat.subscribe,
    () => comentariosDelChat.lista(projectId),
    () => SIN_COMENTARIOS,
  );

  const send = useCallback(
    async (
      rawPrompt: string,
      imageOverride?: AttachedImage | null,
      /** Desde el compositor: los comentarios de líneas que esperan van DENTRO
       *  del mensaje (la #8). Reintentar no los pasa: su texto ya los lleva. */
      opciones?: {
        readonly comentarios?: readonly ComentarioDeLinea[];
        /** Pieza 8: «Reanudar» el encargo — un turno sin mensaje: la ronda siguiente. */
        readonly goal?: "resume";
        /** Crear es Len: VARIAS fotos (hasta `MAX_PHOTOS_PER_MESSAGE`). Ganan
         *  sobre la del compositor y sobre `imageOverride`. */
        readonly images?: readonly AttachedImage[];
        /** Crear es Len: la referencia por URL, que viaja con ESTE mensaje. */
        readonly styleDirection?: StyleDirection | null;
        /** El primer mensaje de un proyecto en blanco que nace como app. */
        readonly naceComo?: PideNacer["naceComo"];
        readonly idioma?: string;
      },
    ) => {
      const escrito = rawPrompt.trim();
      // Lo que escribes tiene su tope; con los comentarios, el del mensaje entero.
      if (escrito.length > (opciones?.comentarios ? MAX_TEXTO_ESCRITO : MAX_PROMPT)) return;
      const comentarios = opciones?.comentarios ?? [];
      const prompt = textoConComentarios(escrito, comentarios, {
        titulo: t("comentarios.titulo"),
        deAntes: t("comentarios.deAntes"),
      });
      // PIEZA 8 · la orden del dueño al encargo que viaja con ESTE turno: crear
      // (la ficha puesta: lo escrito es el objetivo) o reanudar. Con ella, el
      // turno es una ronda y su texto es el mensaje de esa ronda.
      const ordenDelEncargo = opciones?.goal ?? goalOrder(goalChipRef.current, goalKnownRef.current);
      const textoDelTurno = roundTextFor(ordenDelEncargo, prompt, goalKnownRef.current);
      // Con un turno aún trabajando en el servidor, otro turno sobre la misma
      // página serían dos agentes editándola a la vez: se corrige o se para.
      if ((!prompt && ordenDelEncargo !== "resume") || sending || reenganche) return;
      if (ordenDelEncargo) {
        setGoalChip(false);
        setGoalStoppedForCredits(false);
      }
      if (comentarios.length > 0) comentariosDelChat.vaciar(projectId);

      // imageOverride lets Retry re-send the failed turn's original image;
      // undefined = use the live composer image, null = explicitly none.
      const img = imageOverride !== undefined ? imageOverride : attachedImage;
      const imgs: readonly AttachedImage[] = opciones?.images?.length
        ? opciones.images.slice(0, MAX_PHOTOS_PER_MESSAGE)
        : img
          ? [img]
          : [];
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
        userText: textoDelTurno,
        attachedImage: imgs[0],
        ...(imgs.length > 1 ? { attachedImages: imgs } : {}),
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

      // EL HISTORIAL, CON LA FORMA QUE DE VERDAD TUVO — ver
      // `lib/chat/historial-del-agente.ts`, que es también lo que el arnés de
      // evals manda para reproducir una conversación.
      const { history, historyTotal, dichoAntes } = historialParaElAgente(
        // Los mensajes entre personas no son turnos de Len (el servidor los
        // pliega en su sobre, `lib/agent/plegar-equipo.ts`).
        turnsRef.current.filter((t) => t.tipo !== "persona"),
        turnPage,
      );

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
      const turnImage = imgs[0] ? { url: imgs[0].url, alt: imgs[0].alt } : null;
      const turnImages = imgs.map((f) => ({ url: f.url, alt: f.alt }));

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
        // El id del turno ANTERIOR no puede quedarse aquí: el ■ de este turno,
        // pulsado antes de que llegue su evento `turno`, pararía otro.
        turnoIdRef.current = null;
        stopRequestedRef.current = false;
        stopFellBackRef.current = false;
        agentStreamOpenRef.current = true;
        enVueloRef.current = turnId;
        /** Llegó el `done`: el turno terminó y lo dijo. Sin él y sin `error`,
         *  el stream se cortó por el camino y el turno sigue en el servidor. */
        let llegoElDone = false;
        let accumulatedReasoning = "";
        /** Hay un `retry` en curso: el siguiente texto o tarjeta lo borra de la barra. */
        let reintentando = false;
        /** Len está ordenando lo que lleva (`compaction_start`): igual. */
        let compactando = false;
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
        // ¿Hay en el lienzo una página A MEDIAS de este turno? Si el turno
        // acaba sin su `html` (una guarda rechazó el Write, se cortó, se
        // canceló), se devuelve el último documento GUARDADO de esa página —el
        // de antes del turno, o el de un Write anterior del mismo turno—: medio
        // HTML pintado no es la página de nadie.
        let previewPainted = false;
        let savedTurnPageHtml: string | null = null;
        // Cada evento `html` deja aquí la página que escribió. Es lo único que
        // permite saber, al cerrar el turno, si la única preimagen que tenemos
        // (la de `turnPage`) cubre de verdad lo que cambió.
        const paginasTocadas: (string | null)[] = [];
        // LA CARPETA (pieza 9 de Len 2.5, carril B): los ficheros que el turno
        // cambió, en orden (evento `ficheros`). Para Deshacer: van con la
        // página o el botón no se ofrece.
        const ficherosTocados: Array<{ ruta: string; versionPrevia: string | null }> = [];
        // F2: el servidor guardó lo que cambió el turno para deshacerlo entero.
        let deshacerEnServidor: string | null = null;
        // LA DIRECCIÓN DEL DESHACER, y se queda el PRIMERO. `persistPage`
        // archiva un «antes» por cada escritura, así que un turno con dos
        // `editar_pagina` deja dos versiones — y sólo la primera es el
        // documento de antes del TURNO. Quedarse con la última desharía media
        // faena y cantaría «Revertido» igual.
        let versionPrevia: string | null = null;
        // ¿El turno llegó a cambiar algo de forma DURABLE? Lo dice el servidor
        // en el terminal; `latestAgentHtml` es el respaldo para el caso en que
        // el `done` no llegue (la ruta reventó tras pintar el documento).
        let mutoDurable = false;
        // `null` = ninguna herramienta se pronunció (turnos de charla, de
        // ajustes, o herramientas que no tocan el documento). Sólo pasa a
        // `false` si alguna DIJO `sin_cambio` y ninguna dijo lo contrario: un
        // turno con dos edits, uno vacío y otro real, sí cambió la página.
        let huboCambioReal: boolean | null = null;

        let topeAlcanzado: "turn_limit" | "tool_limit" | "budget_limit" | null = null;
        /** Cuántos turnos vio Len de cuántos tiene la charla. Presente sólo
         *  cuando de verdad se quedó algo fuera de la ventana. */
        let ventana: { visibles: number; totales: number } | null = null;
        // Lo que cobró y tardó, en números: la frase la compone quien pinta.
        let centicredits: number | undefined;
        let durationMs: number | undefined;
        /** Pieza 8: el encargo tras el turno y la ronda que el servidor encadenó. */
        let goalTrasElTurno: GoalView | null = null;
        let rondaTrasElTurno: ReturnType<typeof roundAfterDone> = null;
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
          // Pieza 7: la elección del modo plan que viaja con ESTE turno.
          planSentRef.current = planWantedRef.current;
          const res = await fetch("/api/agent", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              projectId,
              prompt,
              history,
              historyTotal,
              // Lo que el dueño dijo antes de la ventana (H08-a).
              ...(dichoAntes.length > 0 ? { dichoAntes } : {}),
              // EL ID DE LA FILA, para que el servidor y este panel escriban la
              // MISMA. El servidor registra el turno desde su `finally` —o sea
              // también cuando el stream muere y este `fetch` nunca llega a
              // `persistTurn`— y sin este id serían dos filas para un turno.
              // No es el `turnoId` de las correcciones: ése lo sigue eligiendo
              // el servidor a propósito (una dirección elegible por el cliente
              // sería falsificable).
              turnId,
              // EL PIN DE ESTE TURNO. Viaja en el cuerpo en vez de releerse del
              // perfil en el servidor, que es lo que hace Claude Code al fijar
              // el esfuerzo por mensaje: el nivel que corre es el que el usuario
              // VEÍA al pulsar enviar, y cambiar el mando a media respuesta no
              // reescribe con qué esfuerzo corrió lo que ya salió.
              esfuerzo,
              // EL MODO, con el mismo pestillo. Sólo se manda Dynamis: sin el
              // campo, el turno es de Len y el cuerpo sale como siempre.
              ...(mode === "dynamis" ? { mode } : {}),
              // LA HORA DEL USUARIO: «hoy» es su día, no el de UTC
              // (plans/len-resultados/diseno.md §7).
              zonaHoraria: Intl.DateTimeFormat().resolvedOptions().timeZone,
              // EL IDIOMA DE LA INTERFAZ: el de los avisos de una mención que
              // salga de este turno (el chat del equipo), y el `lang` de una app
              // que nace (`camposDeNacer` lo pisa con el suyo si viene).
              idioma: locale,
              // PIEZA 3: este chat SABE contestar las preguntas de Len dentro del
              // turno (la tarjeta con opciones y `POST /api/agent/responder`).
              answersQuestions: true,
              // PIEZA 7: la elección del dueño, si tocó la ficha (como el `/plan`
              // de DeepSeek: un evento). Sin elección no viaja nada y el servidor
              // sigue con lo que ya estaba.
              ...(planSentRef.current !== null ? { plan: planSentRef.current } : {}),
              // PIEZA 8: la orden del dueño al encargo (el `/goal` de DeepSeek).
              ...(ordenDelEncargo ? { goal: ordenDelEncargo } : {}),
              // Same value + same conditional shape ai-design sends below —
              // absent/empty means home, cloned for parity.
              ...(turnPage ? { page: turnPage } : {}),
              ...(turnScope ? { scope: turnScope } : {}),
              ...(turnImages.length > 0 ? { attachedImages: turnImages } : {}),
              ...(opciones?.styleDirection ? { styleDirection: opciones.styleDirection } : {}),
              // UNA APP NACE con este mensaje (la tarjeta App del estado vacío).
              ...camposDeNacer(opciones),
            }),
            signal: abort.signal,
          });

          if (!res.ok || !res.body) {
            const errPayload = await res
              .json()
              .catch(() => ({ error: `HTTP ${res.status}` }));
            scanController.cancel();
            // EL CÓDIGO GANA A LA PROSA, igual que en `runAiDesignTurn` (N2 y
            // N44, plans/new-chat/): «unauthorized», «page not found»… salían
            // tal cual en los diez idiomas. Ver ./http-error.
            const texto = httpErrorText(res.status, errPayload?.code);
            updateTurn(turnId, { status: "error", errorText: t(texto.key, texto.values) });
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
                if (id) {
                  turnoIdRef.current = id;
                  // ■ pulsado antes de saber a qué turno iba (N40): ahora sí
                  // se le puede pedir al servidor.
                  if (stopRequestedRef.current) requestStop(id);
                }
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
              } else if (evName === "retry") {
                // EL INTENTO FALLIDO NO EXISTIÓ (`lib/agent/loop.ts`, reintentos):
                // se retira lo que llegó a escribir y la barra dice que reintenta.
                const p = payload as { attempt?: unknown; maxAttempts?: unknown; delayMs?: unknown; discardChars?: unknown };
                const discard = typeof p.discardChars === "number" && p.discardChars > 0 ? p.discardChars : 0;
                const attempt = typeof p.attempt === "number" ? p.attempt : 1;
                const maxAttempts = typeof p.maxAttempts === "number" ? p.maxAttempts : 5;
                const until = Date.now() + (typeof p.delayMs === "number" && p.delayMs > 0 ? p.delayMs : 0);
                if (discard > 0) {
                  accumulatedReasoning = accumulatedReasoning.slice(0, Math.max(0, accumulatedReasoning.length - discard));
                }
                setTurns((prev) =>
                  prev.map((t) =>
                    t.id === turnId
                      ? {
                          ...t,
                          assistantReasoning:
                            discard > 0 ? t.assistantReasoning.slice(0, Math.max(0, t.assistantReasoning.length - discard)) : t.assistantReasoning,
                          retrying: { attempt, maxAttempts, until },
                        }
                      : t,
                  ),
                );
                reintentando = true;
              } else if (evName === "plan") {
                // PIEZA 7: el modo con el que empezó el turno, y cada cambio
                // (aceptar entrar, aprobar el plan). La elección que viajó ya
                // está aplicada.
                const active = (payload as { active?: unknown } | null)?.active;
                if (typeof active === "boolean") {
                  setPlanKnown(active);
                  const enviada = planSentRef.current;
                  if (enviada !== null) {
                    planSentRef.current = null;
                    setPlanWanted((w) => (w === enviada ? null : w));
                  }
                }
              } else if (evName === "goal") {
                // PIEZA 8: el encargo con el que empezó el turno, y cada cambio
                // (crearlo, completarlo, atascarlo, pausarlo).
                const p = payload as { goal?: unknown; activation?: unknown } | null;
                setGoalKnown(p?.goal === null ? null : goalViewOf(p?.goal, p?.activation));
              } else if (evName === "question") {
                // PIEZA 3: Len pregunta y ESPERA (`ask_user_question`, 120 s). La
                // tarjeta se contesta con un toque y la respuesta vuelve al
                // turno vivo (`POST /api/agent/responder`).
                const preguntas = questionsFrom((payload as { questions?: unknown } | null)?.questions);
                if (preguntas) updateTurn(turnId, { pendingQuestions: preguntas });
              } else if (evName === "compaction_start") {
                // LA COMPACTACIÓN (`lib/agent/compaction/`, como DeepSeek): Len
                // resume lo más viejo para seguir; la barra lo dice mientras dura.
                compactando = true;
                updateTurn(turnId, { compacting: true });
              } else if (evName === "compaction") {
                // Acabó. Si fue para recuperarse de un desborde a media vuelta,
                // lo que el intento llegó a escribir no existió, como en `retry`.
                const p = payload as { discardChars?: unknown };
                const discard = typeof p.discardChars === "number" && p.discardChars > 0 ? p.discardChars : 0;
                if (discard > 0) {
                  accumulatedReasoning = accumulatedReasoning.slice(0, Math.max(0, accumulatedReasoning.length - discard));
                }
                compactando = false;
                setTurns((prev) =>
                  prev.map((t) =>
                    t.id === turnId
                      ? {
                          ...t,
                          assistantReasoning:
                            discard > 0 ? t.assistantReasoning.slice(0, Math.max(0, t.assistantReasoning.length - discard)) : t.assistantReasoning,
                          compacting: undefined,
                        }
                      : t,
                  ),
                );
              } else if (evName === "text") {
                if (reintentando) {
                  reintentando = false;
                  updateTurn(turnId, { retrying: undefined });
                }
                if (compactando) {
                  compactando = false;
                  updateTurn(turnId, { compacting: undefined });
                }
                const text = strField(payload, "text");
                if (text) {
                  appendReasoning(turnId, text);
                  accumulatedReasoning += text;
                }
              } else if (evName === "action") {
                if (reintentando) {
                  reintentando = false;
                  updateTurn(turnId, { retrying: undefined });
                }
                if (compactando) {
                  compactando = false;
                  updateTurn(turnId, { compacting: undefined });
                }
                const p = payload as {
                  tool?: unknown;
                  status?: unknown;
                  summary?: unknown;
                };
                const tool = typeof p.tool === "string" ? p.tool : "";
                // 🔴 ESTA LISTA ES BLANCA Y CAE A `done`, o sea que un estado
                // nuevo del servidor se pinta VERDE sin que nada chille. Al
                // añadir `warning` (2026-09-04) había que tocarla aquí o el
                // arreglo entero —que existe para que «con problemas» deje de
                // salir con tick— no habría llegado a la pantalla.
                const status =
                  p.status === "running" ||
                  p.status === "done" ||
                  p.status === "warning" ||
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
                const observacion = (payload as { observacion?: unknown } | null)?.observacion;
                // EL RECUENTO DE COBERTURA («1 de 2 páginas»). Los dos juntos o
                // ninguno: la tarjeta sólo lo pinta cuando tiene los dos, y un
                // turno guardado antes de hoy no los trae y se pinta igual.
                const pMiradas = (payload as { paginasMiradas?: unknown } | null)?.paginasMiradas;
                const pTocadas = (payload as { paginasTocadas?: unknown } | null)?.paginasTocadas;
                // EL MOTIVO DEL FALLO. El servidor ya lo acota (`TOPE_MOTIVO`);
                // se recorta otra vez aquí por lo mismo que el `summary`: un
                // campo largo haría 400 a `persistTurn` y el turno entero
                // desaparecería al recargar, en silencio.
                const motivo = (payload as { motivo?: unknown } | null)?.motivo;
                // N41 · el motivo del DUEÑO de una roja: un código que la
                // tarjeta traduce. Pasa por la puerta que valida el código.
                const ownerReason = ownerReasonFrom((payload as { ownerReason?: unknown } | null)?.ownerReason);
                const valores = (payload as { valores?: unknown } | null)?.valores;
                // La pregunta de `ask_user_question` (antes `preguntar`), sólo de
                // pantalla (plans/new-chat/); con sus opciones y, si se contestó
                // dentro del turno, la respuesta (pieza 3).
                const pregunta = (payload as { pregunta?: unknown } | null)?.pregunta;
                const preguntas = questionsFrom((payload as { preguntas?: unknown } | null)?.preguntas);
                const respuesta = (payload as { respuesta?: unknown } | null)?.respuesta;
                // Alinear con DeepSeek: la pregunta descartada, «cancelada».
                const descartada = (payload as { dismissed?: unknown } | null)?.dismissed === true;
                // Su tarjeta llegó: ya no espera.
                if (asksTheOwner(tool) && status !== "running") updateTurn(turnId, { pendingQuestions: undefined, answeredLive: undefined });
                if (tool) {
                  const action: AgentAction = {
                    tool,
                    status,
                    summary,
                    // Cuelgan de la ACCIÓN porque es lo único del turno que se
                    // guarda como JSON — ver el comentario en `AgentAction`.
                    ...(typeof edits === "number" && Number.isFinite(edits) ? { edits } : {}),
                    ...(Array.isArray(ops) && ops.length ? { ops: ops as OpDescrita[] } : {}),
                    ...(typeof observacion === "string" && observacion.trim()
                      ? { observacion }
                      : {}),
                    ...(typeof pMiradas === "number" &&
                    Number.isFinite(pMiradas) &&
                    typeof pTocadas === "number" &&
                    Number.isFinite(pTocadas)
                      ? { paginasMiradas: pMiradas, paginasTocadas: pTocadas }
                      : {}),
                    ...(typeof motivo === "string" && motivo.trim()
                      ? { motivo: motivo.slice(0, 200) }
                      : {}),
                    ...(ownerReason ? { ownerReason } : {}),
                    ...(typeof pregunta === "string" && pregunta.trim()
                      ? { pregunta: pregunta.slice(0, 600) }
                      : {}),
                    ...(preguntas ? { preguntas } : {}),
                    ...(typeof respuesta === "string" && respuesta.trim()
                      ? { respuesta: respuesta.slice(0, 200) }
                      : {}),
                    ...(descartada ? { dismissed: true as const } : {}),
                    ...(typeof valores === "string" && valores.trim()
                      ? { valores: valores.slice(0, 200) }
                      : {}),
                  };
                  upsertAction(turnId, action);
                  finalActions = upsertActionInto(finalActions, action);
                }

              } else if (evName === "terminal") {
                // F6a · un comando de la terminal de Len, para la lente
                // «Terminal» del lienzo. No toca el turno ni su tarjeta: la
                // tarjeta de `bash` ya llegó como `action`.
                const command = strField(payload, "command");
                const salida = strField(payload, "salida");
                const exitCode = (payload as { exitCode?: unknown } | null)?.exitCode;
                // La #10 · lo que cambió en los ficheros, para la lente y la tarjeta.
                const cambios = leerCambiosDelComando((payload as { cambios?: unknown } | null)?.cambios);
                if (command) {
                  terminalEnVivo.empujar(projectId, {
                    command,
                    salida,
                    exitCode: typeof exitCode === "number" ? exitCode : -1,
                    turnId,
                    ...(cambios ? { cambios } : {}),
                  });
                }
              } else if (evName === "cambios") {
                // Lo que cambió en el turno, fichero a fichero (la forma de
                // DeepSeek): para la tarjeta de su pie y la lente «Cambios».
                // Vive lo que la pestaña; al recargar no hay tarjeta.
                const ficheros = (payload as { ficheros?: unknown } | null)?.ficheros;
                const validos = Array.isArray(ficheros) ? ficheros.filter(esFicheroCambiado) : [];
                if (validos.length > 0) cambiosEnVivo.guardar(projectId, { turnId, pedido: prompt, ficheros: validos });
              } else if (evName === "deshacible") {
                // F2 de las apps web: Deshacer lo hará el servidor, entero.
                const id = (payload as { turnId?: unknown } | null)?.turnId;
                if (typeof id === "string" && id) deshacerEnServidor = id;
              } else if (evName === "ficheros") {
                // LA CARPETA (pieza 9 de Len 2.5): lo que cambió de la carpeta
                // una herramienta, con la versión de su «antes».
                ficherosTocados.push(...ficherosDelEvento(payload));
                notifyFolderChanged(projectId);
              } else if (evName === "page_preview") {
                // Sólo la página que el dueño tiene delante, y marcada como no
                // confiable, como el goteo del chat viejo (`html_chunk`).
                const html = strField(payload, "html");
                const evPage =
                  payload && typeof payload === "object" && typeof (payload as { page?: unknown }).page === "string"
                    ? (payload as { page: string }).page
                    : null;
                if (html && evPage === turnPage) {
                  previewPainted = true;
                  onLocalUpdate(html, evPage, true);
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
                  if (evPage === turnPage) {
                    previewPainted = false;
                    savedTurnPageHtml = html;
                  }
                  // EL NOMBRE DEL CAMPO NO ES UNA CONVENCIÓN: es el del evento
                  // del bucle. Tipado contra él a propósito — si allí se
                  // renombra, esto deja de compilar en vez de quedarse mudo, que
                  // es como un botón se apaga sin que nadie se entere.
                  const vp = (payload as Partial<EventoHtmlDelAgente> | null)?.versionPrevia;
                  if (versionPrevia === null && typeof vp === "string" && vp) {
                    versionPrevia = vp;
                  }
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
                  condicion?: unknown;
                  turnosMaximos?: unknown;
                };
                const subdominio =
                  typeof c.subdominio === "string" ? c.subdominio : "";
                if (c.action === "publish" && subdominio) {
                  const idiomas = Array.isArray(c.idiomas)
                    ? c.idiomas.filter((x): x is string => typeof x === "string")
                    : [];
                  updateTurn(turnId, {
                    confirm: {
                      action: "publish",
                      subdominio,
                      idiomas,
                      republicar: c.republicar === true,
                    },
                  });
                }
                // El borrador de respuesta (plans/len-resultados/). Se sanea
                // campo a campo: viene del stream, y un botón desconocido no
                // se pinta.
                if (c.action === "responder") {
                  const r = payload as Partial<RespuestaPreparada>;
                  if (
                    (r.para === "chat" || r.para === "formulario") &&
                    typeof r.id === "string" &&
                    typeof r.texto === "string" &&
                    Array.isArray(r.botones)
                  ) {
                    updateTurn(turnId, {
                      respuesta: {
                        action: "responder",
                        para: r.para,
                        id: r.id,
                        con: typeof r.con === "string" ? r.con : null,
                        texto: r.texto,
                        botones: r.botones.filter((b): b is RespuestaPreparada["botones"][number] =>
                          ["enviar", "correo", "whatsapp", "copiar"].includes(String(b)),
                        ),
                        correo: typeof r.correo === "string" ? r.correo : null,
                        whatsapp: typeof r.whatsapp === "string" ? r.whatsapp : null,
                      },
                    });
                  }
                }
              } else if (evName === "done") {
                llegoElDone = true;
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
                // `budget_limit` (Len 2.1): el techo de DINERO del turno.
                if (tope === "turn_limit" || tope === "tool_limit" || tope === "budget_limit") topeAlcanzado = tope;
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
                const cc = (payload as { centicredits?: unknown } | null)?.centicredits;
                if (typeof cc === "number" && Number.isFinite(cc) && cc >= 0) centicredits = cc;
                const ms = (payload as { durationMs?: unknown } | null)?.durationMs;
                if (typeof ms === "number" && Number.isFinite(ms) && ms >= 0) durationMs = ms;
                // PIEZA 8: el encargo como queda y lo que sigue (la ronda que el
                // servidor ya abrió, o que paró por el saldo).
                const d = payload as { goal?: unknown; goalActivation?: unknown } | null;
                if (d?.goal !== undefined) {
                  goalTrasElTurno = goalViewOf(d.goal, d.goalActivation);
                  setGoalKnown(goalTrasElTurno);
                }
                rondaTrasElTurno = roundAfterDone(payload);
                if (rondaTrasElTurno && "stopped" in rondaTrasElTurno) setGoalStoppedForCredits(true);
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
                // El ■ de quien mira: se dice con la misma palabra que el ■
                // de un turno reenganchado (N38).
                if (code === "cancelled" && stopRequestedRef.current) errorMessage = t("errors.cancelled");
              }
            }
          }

          if (fellBackToAiDesign) {
            // F4 Task 7 — the SAME turn, the SAME abort controller, routed
            // through classic ai-design instead. No error surfaces; the
            // outer try/finally below still owns abortRef/sending cleanup.
            // ai-design sí para cortando la conexión: su ■ vuelve a abortar.
            agentStreamOpenRef.current = false;
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

          // 🔴 LEN 2.1 · EL STREAM SE CORTÓ, EL TURNO NO. Sin `done` y sin
          // `error`, la conexión murió por el camino (un proxy, la red, el
          // móvil dormido) y el turno sigue en el servidor: se sigue desde su
          // fila en vez de pintarlo en rojo e invitar a «Reintentar», que lo
          // aplicaría dos veces.
          if (!llegoElDone && errorMessage === null) {
            scanController.cancel();
            seguirEnElServidor(turnId);
            return;
          }

          // PIEZA 8 · LA RONDA SIGUIENTE ya corre en el servidor (la abrió antes
          // del `done`): se pinta en marcha detrás de ésta y el efecto de Len
          // 2.1 la sigue desde su fila, como un turno que llega en curso.
          if (rondaTrasElTurno && "next" in rondaTrasElTurno) {
            const next = rondaTrasElTurno.next;
            const goalDeLaRonda = goalTrasElTurno;
            setTurns((prev) => (prev.some((x) => x.id === next) ? prev : [...prev, rondaEnCamino(next, goalDeLaRonda)]));
          }

          // UN TURNO QUE YA MUTÓ NO PUEDE TERMINAR EN ROJO.
          //
          // Una herramienta guarda y el stream siguiente se cae (503, cancelado
          // o max_tokens): el turno se pintaba rojo, no se persistía en la
          // transcripción y no dejaba Undo — con el cambio ya vivo en la base.
          // El usuario pulsaba «Reintentar» y aplicaba el mismo cambio DOS
          // veces. Es el mismo arreglo que el Chat clásico lleva desde el 24/08
          // (`cambioDurable` en ai-design); esta superficie se quedó sin él.
          // `errors.turn_limit` y `errors.tool_limit` ya existen en los 10
          // idiomas: el tope se contaba como error cuando lo era, y como nada
          // cuando el bucle cerraba con elegancia. Ahora se dice siempre.
          const avisoDeTope = topeAlcanzado ? tAgent(`errors.${topeAlcanzado}`) : null;
          const cierre = cierreDeTurno({
            errorMessage,
            avisoDeTope,
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
            ...(centicredits !== undefined ? { centicredits } : {}),
            ...(durationMs !== undefined ? { durationMs } : {}),
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
            // (b) Al revés: `toggle_module` y compañía mutan de forma durable
            //     SIN emitir html, y el pie decía «No cambió nada de la página»
            //     sobre un turno que sí cambió cosas. `mutoDurable` ya viajaba
            //     en el terminal y sólo se usaba para elegir rojo o ámbar.
            //
            // `noDocChange` deja de significar «no llegó html» y pasa a
            // significar lo que su etiqueta ya prometía: la página no cambió.
            ...(latestAgentHtml !== null ? { postEditHtml: latestAgentHtml } : {}),
            ...(laPaginaNoCambio({
              huboCambioReal,
              hayDocumentoNuevo: latestAgentHtml !== null,
              mutoDurable,
            })
              ? { noDocChange: true }
              : {}),
            // Lo que el turno escribió DE VERDAD. `page` de abajo sigue siendo
            // la página en la que empezó (de donde viene la preimagen); estas
            // son las que tocó. Cuando no coinciden, Deshacer no puede cumplir.
            paginasTocadas: [...paginasTocadas],
            ...(ficherosTocados.length > 0 ? { ficherosTocados: [...ficherosTocados] } : {}),
            ...(deshacerEnServidor ? { deshacerEnServidor } : {}),
            versionPrevia,
            // Aplicado CON aviso: el cambio está y el usuario tiene que ver el
            // aviso. La marca de corte, en cambio, sólo si de verdad se cortó
            // —ver `cierre.cortado`—: el historial se la reenvía al modelo como
            // «lo demás NO llegó a hacerse».
            ...(cierre.kind === "aplicado-con-aviso"
              ? { avisoTurno: cierre.aviso, ...(cierre.cortado ? { cortado: true } : {}) }
              : {}),
          });
          void persistTurn({
            id: turnId,
            // El mismo texto que se está viendo en pantalla — mismo `↳`, mismo
            // orden. Sin correcciones es `prompt` y nada más, byte a byte.
            // Pieza 8: en una ronda, su mensaje (el que guarda el servidor).
            userText: [textoDelTurno, ...correcciones.map((c) => `↳ ${c}`)].join("\n"),
            attachedImage: imgs[0],
            ...(imgs.length > 1 ? { attachedImages: [...imgs] } : {}),
            // El aviso viaja a la transcripción: al recargar, el turno tiene
            // que seguir contando que se cortó. Sin esto el usuario ve un turno
            // aplicado y limpio sobre un trabajo a medias.
            assistantReasoning: [
              accumulatedReasoning,
              lineaGuardadaDelCierre(cierre, {
                avisoDeTope,
                plantillaDeCorte: (reason) => tAgent("cortado", { reason }),
              }),
            ]
              .filter(Boolean)
              .join("\n\n"),
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
            // LA MISMA decisión que la de arriba, y por eso es una llamada y no
            // una copia: aquí vivía `latestAgentHtml === null`, la forma vieja,
            // así que lo guardado discrepaba de lo que el usuario acababa de ver.
            ...(laPaginaNoCambio({
              huboCambioReal,
              hayDocumentoNuevo: latestAgentHtml !== null,
              mutoDurable,
            })
              ? { noDocChange: true }
              : {}),
          });
          notifyCreditBalanceChanged();
        } catch (err) {
          scanController.cancel();
          if (abort.signal.aborted && stopFellBackRef.current) {
            // El ■ se pidió y el servidor no cerró a tiempo (N40): lo que
            // diga su fila —borrada, cortada o aplicada— es la respuesta.
            seguirEnElServidor(turnId);
          } else if (abort.signal.aborted) {
            updateTurn(turnId, {
              status: "error",
              errorText: t("errors.cancelled"),
            });
          } else {
            // 🔴 LEN 2.1: la red se cayó, pero el turno ya no muere con ella.
            // Se sigue desde su fila; si el servidor no llegó a abrirla, la
            // lectura lo dice (404) y entonces sí es un error de red.
            seguirEnElServidor(turnId);
          }
        } finally {
          if (previewPainted) onLocalUpdate(savedTurnPageHtml ?? preEditHtml, turnPage);
          if (abortRef.current === abort) {
            abortRef.current = null;
            agentStreamOpenRef.current = false;
            if (stopFallbackRef.current) {
              clearTimeout(stopFallbackRef.current);
              stopFallbackRef.current = null;
            }
          }
          if (enVueloRef.current === turnId) enVueloRef.current = null;
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
      // El esfuerzo y el modo viajan en el cuerpo: sin ellos aquí, `send`
      // mandaba los de cuando se creó (el `auto` del arranque, antes de que el
      // GET trajera lo guardado).
      esfuerzo,
      mode,
      onClearScope,
      onLocalUpdate,
      persistTurn,
      projectId,
      reenganche,
      requestStop,
      runAiDesignTurn,
      scopedSelection,
      seguirEnElServidor,
      sending,
      t,
      tAgent,
      updateTurn,
      upsertAction,
    ],
  );

  /**
   * EL BOTÓN «ARRÉGLALO» DE LA MEDIDA DEL NAVEGADOR.
   *
   * Cuando el navegador mide un defecto —el titular se sale a 390px, un texto
   * que nadie puede leer, el JavaScript que grita— ya no lo arregla nadie por
   * su cuenta: se le DICE al usuario y decide él. Esto es el «decide él».
   *
   * Va por el chat, como cualquier cosa que le pida, para que Len lo trate
   * igual que a «cámbiame el titular»: mismo turno, mismo Undo, misma
   * transcripción. No hay una vía especial para nuestros arreglos.
   *
   * Vive AQUÍ y no junto al otro efecto de `pendingDraft` porque necesita
   * `send`, que se define más arriba y no existe todavía allí.
   *
   * Se consume ANTES de mandar: si `send` tardara o fallara, un borrador sin
   * consumir volvería a dispararse en el siguiente render.
   */
  useEffect(() => {
    if (!pendingDraftAutoSend || !pendingDraft) return;
    const texto = pendingDraft;
    const adjuntos = pendingAttachments;
    onPendingDraftConsumed?.();
    // El primer mensaje de un proyecto en blanco lleva sus fotos y su
    // referencia (plans/crear-es-len); el resto de borradores, nada más.
    void send(texto, undefined, {
      ...(adjuntos?.images.length ? { images: adjuntos.images } : {}),
      ...(adjuntos?.styleDirection ? { styleDirection: adjuntos.styleDirection } : {}),
      ...camposDeNacer(adjuntos),
    });
  }, [pendingDraftAutoSend, pendingDraft, pendingAttachments, onPendingDraftConsumed, send]);

  const handleRetry = useCallback(
    (turn: DesignTurn) => {
      setTurns((prev) => prev.filter((t) => t.id !== turn.id));
      // PIEZA 8: reintentar una ronda del encargo es reanudarlo (la ronda
      // siguiente), no mandarle a Len su mensaje de ronda como si fuera tuyo.
      if (roundOfTurn(turn.userText)) {
        void send("", undefined, { goal: "resume" });
        return;
      }
      // Re-send with the turn's ORIGINAL image (the live composer was cleared
      // after the first send), so a vision/image edit retries as the same request.
      void send(turn.userText, turn.attachedImage ?? null, turn.attachedImages ? { images: turn.attachedImages } : undefined);
    },
    [send],
  );

  // PIEZA 8 · LOS CONTROLES DEL ENCARGO. La ficha «Encargo» (la puerta del
  // dueño: lo que mande será el objetivo), «Reanudar» (un turno: la ronda
  // siguiente) y «Quitar» (`/goal clear`, una ruta aparte: no es un turno).
  const toggleGoalChip = useCallback(() => setGoalChip((x) => !x), []);
  const resumeGoal = useCallback(() => {
    void send("", undefined, { goal: "resume" });
  }, [send]);
  const clearGoal = useCallback(async () => {
    try {
      const r = await fetch("/api/agent/encargo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, action: "clear" }),
      });
      if (r.ok) {
        setGoalKnown(null);
        setGoalStoppedForCredits(false);
      }
    } catch {
      // Sin red: la tarjeta sigue ahí, que es el aviso.
    }
  }, [projectId]);

  const handleCancel = useCallback(() => {
    // 🔴 PARAR ES UNA PETICIÓN, NO CERRAR LA CONEXIÓN (Len 2.1). El servidor
    // ya no corta el turno cuando el cliente se va —así sobrevive a una
    // pestaña cerrada o a la red caída—, de modo que el ■ tiene que pedírselo
    // (`POST /api/agent/cancelar`). Sin esto, el ■ sólo dejaría de MIRAR y el
    // turno seguiría gastando detrás. `keepalive` para que la petición salga
    // aunque la pestaña se cierre justo después.
    const turnoId = turnoIdRef.current;
    // Un turno reenganchado no tiene conexión que abortar: lo que diga su fila
    // después (un 404 si no llegó a cambiar nada) es la respuesta al ■.
    stopRequestedRef.current = true;
    // Sin `turnoId` todavía, la petición sale en cuanto llegue (ver el evento
    // `turno` en `send`).
    if (turnoId) requestStop(turnoId);
    // 🔴 N40: un turno del Agente leído por su stream NO se aborta. El
    // servidor lo cierra (`error` cancelled + `done`) y ese cierre decide
    // rojo o ámbar por el camino de siempre. Abortar aquí era decidirlo a
    // ciegas: «Cancelado.» sobre un turno que seguía, o que ya había cambiado
    // la página.
    if (agentStreamOpenRef.current) return;
    // ai-design: abortar lleva al `catch` de su turno, que lo marca
    // «Cancelado.» y deshace lo que goteaba en el lienzo.
    abortRef.current?.abort();
  }, [requestStop]);

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
        // Los ficheros devueltos no cambian el documento: el lienzo se recarga
        // con el aviso (lib/lienzo/carpeta-cambiada.ts).
        ficherosRestaurados: () => notifyFolderChanged(projectId),
        noSeDeshizo: (rutas) => updateTurn(turn.id, { noSeDeshizo: [...rutas] }),
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
      const noteId = publishNoteId();
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
    (sending || reenganche !== null) &&
    latest &&
    latest.status === "streaming" &&
    latest.assistantReasoning.length === 0 &&
    (latest.actions?.length ?? 0) === 0;

  /**
   * EL BOTÓN SIGUE A LA CAJA. Con el turno corriendo, lo que escribes no abre
   * otro turno: corrige el que hay. Sin texto no se llega aquí — ahí el botón
   * es el cuadrado y llama a `handleCancel`. Vale igual para un turno que
   * sigue en el servidor (Len 2.1).
   */
  const submit = useCallback(() => {
    if (sending || reenganche) {
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
    void send(draft, undefined, { comentarios });
  }, [comentarios, draft, reenganche, send, sending]);

  /**
   * PIEZA 3 · CONTESTAR A LEN DESDE LA TARJETA. Si el turno sigue esperando la
   * respuesta (`ask_user_question`), vuelve a ESE turno y Len sigue. Si ya nadie
   * espera (venció, cerró, o es una fila vieja), sale como un mensaje normal y
   * abre el siguiente: la respuesta nunca se pierde.
   */
  /** La respuesta que salió como mensaje con un turno aún en vuelo: espera aquí. */
  const respuestaEnColaRef = useRef<string | null>(null);
  const answerQuestion = useCallback(
    async (turnId: string, questions: readonly UserQuestion[], answers: QuestionAnswer[]) => {
      const turnoId = liveQuestionTurno(
        turnsRef.current.find((x) => x.id === turnId),
        turnoIdRef.current,
      );
      if (turnoId) {
        try {
          const r = await fetch("/api/agent/responder", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ turnoId, answers }),
          });
          const code = r.ok ? undefined : ((await r.json().catch(() => ({}))) as { error?: string }).error;
          if (outcomeOfResponder(r.status, code) !== "fallback") {
            updateTurn(turnId, { answeredLive: answerSummary(answers) });
            return;
          }
        } catch {
          // Sin red: cae al mensaje normal, abajo.
        }
      }
      // Pieza 7: con las etiquetas del modo plan en el idioma del dueño.
      const mensaje = composeAnswerMessage(questions, planAnswersForMessage(questions, answers, (k) => t(k as never)));
      if (!mensaje.trim()) return;
      // PIEZA 7: contestar después la tarjeta del modo plan es la puerta del
      // dueño: aceptar entrar lo enciende, aprobar el plan lo apaga.
      const tras = planModeAfterAnswer(questions, answers);
      if (tras !== null) {
        const eleccion = tras === planKnownRef.current ? null : tras;
        planWantedRef.current = eleccion;
        setPlanWanted(eleccion);
      }
      // 🔴 Con el turno aún en vuelo (el que preguntó, cerrándose justo al vencer
      // la espera), `send()` la tiraría en silencio: queda en cola y sale en
      // cuanto el turno acaba (el efecto de abajo).
      if (fallbackDelivery(sending || reenganche !== null) === "after-turn") {
        respuestaEnColaRef.current = mensaje;
        return;
      }
      void send(mensaje);
    },
    [reenganche, send, sending, t, updateTurn],
  );
  useEffect(() => {
    if (sending || reenganche !== null || !respuestaEnColaRef.current) return;
    const mensaje = respuestaEnColaRef.current;
    respuestaEnColaRef.current = null;
    void send(mensaje);
  }, [reenganche, send, sending]);

  /**
   * LOTE 7-8 · «PEDIR CAMBIOS» EN LA REVISIÓN DEL PLAN, como el «discuss» de
   * DeepSeek (`PlanReviewPanel`: `pending.dismiss()`): no hay caja en la
   * tarjeta. El foco va al compositor y, si el turno espera la revisión, se
   * descarta: el servidor cierra el turno en modo plan y lo que escriba el
   * dueño es el turno siguiente. Si la revisión ya cerró el turno (no contestó
   * en 120 s), sólo el foco.
   */
  const dismissQuestion = useCallback(async (turnId: string) => {
    taRef.current?.focus();
    const turnoId = liveQuestionTurno(
      turnsRef.current.find((x) => x.id === turnId),
      turnoIdRef.current,
    );
    if (!turnoId) return;
    await fetch("/api/agent/responder", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ turnoId, dismiss: true }),
    }).catch(() => undefined);
  }, []);

  const changeEsfuerzo = useCallback((e: EsfuerzoAgente) => {
    // OPTIMISTA A PROPÓSITO, y aquí sí es correcto: la preferencia sólo
    // afecta a turnos FUTUROS, así que un guardado que falle no deja nada
    // a medias — el siguiente turno viajaría con el nivel que se ve en
    // pantalla igualmente, porque el pin va en el cuerpo del turno y no
    // se relee de la base.
    setEsfuerzo(e);
    void fetch("/api/agent/esfuerzo", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ esfuerzo: e }),
    }).catch(() => {});
  }, []);

  // PIEZA 7 · la ficha «Plan» y la opción del «+»: eligen lo contrario de lo que
  // se ve; volver a lo que ya era deshace la elección.
  const togglePlan = useCallback(() => {
    setPlanWanted((w) => togglePlanSelection({ wanted: w, known: planKnownRef.current }));
  }, []);

  const removeComentario = useCallback((id: number) => comentariosDelChat.quitar(projectId, id), [projectId]);

  /**
   * LA CHARLA CAMBIÓ EN EL SERVIDOR («Empezar de cero» o volver a una
   * archivada, plans/new-chat/). Se vacía la vista ANTES de refrescar: la
   * convergencia conserva lo local que el servidor no tiene
   * (`fusionarConversacion`), así que sin esto los turnos de la charla vieja
   * seguirían pegados detrás de la nueva. Luego el padre refresca y la charla
   * que toque llega por `initialChat`. Con un turno en marcha no se llama: el
   * servidor lo rechaza (409).
   */
  const conversationChanged = useCallback(() => {
    setTurns([]);
    // Una charla nueva empieza sin modo plan (el servidor pliega de sus filas).
    setPlanKnown(false);
    setPlanWanted(null);
    // Y sin encargo: el de antes se queda en la charla archivada.
    setGoalKnown(null);
    setGoalChip(false);
    setGoalStoppedForCredits(false);
    onChatChangeRef.current?.();
  }, []);

  return {
    turns,
    draft,
    setDraft,
    /** Un turno propio en vuelo. */
    sending,
    /** El id de la fila de un turno que sigue en el servidor sin stream aquí. */
    reenganche,
    /** Hay un turno trabajando, propio o reenganchado: ■ y corregir valen. */
    busy: sending || reenganche !== null,
    latest,
    showThinkingDots: Boolean(showThinkingDots),
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
    /** El selector «Len / Len Dynamis» se ofrece: lo dice el servidor, y el
     *  chat clásico (`ai-design`, la vía de escape) no sabe de modos. */
    modeOffered: dynamisOffered && agentModeUI,
    agentModeUI,
    send,
    submit,
    handleRetry,
    handleCancel,
    handleUndo,
    handlePublished,
    answerQuestion,
    dismissQuestion,
    conversationChanged,
    /** Pieza 7: el modo plan que se ve (lo elegido, o lo que dice el servidor). */
    planMode: planWanted ?? planKnown,
    togglePlan,
    /** El chat clásico (`ai-design`, la vía de escape) no tiene modo plan. */
    planOffered: agentModeUI,
    /** Pieza 8: el encargo que se ve, la ficha «Encargo» y sus controles. El
     *  chat clásico (`ai-design`) no lo tiene. */
    goal: goalKnown,
    goalChip,
    goalAvailable: canCreateGoal(goalKnown),
    goalStoppedForCredits,
    toggleGoalChip,
    resumeGoal,
    clearGoal,
    goalOffered: agentModeUI,
    seguirTurnoDelHilo,
  };
}

export type AgentChat = ReturnType<typeof useAgentChat>;

export function restoreTurn(s: StoredChatTurn): DesignTurn {
  return {
    id: s.id,
    userText: s.userText,
    attachedImage: s.attachedImage,
    ...(s.attachedImages ? { attachedImages: s.attachedImages } : {}),
    assistantReasoning: s.assistantReasoning,
    // Len 2.1: sigue trabajando en el servidor. Se pinta en marcha, contando
    // desde que empezó, y el panel relee su fila hasta que cierra.
    status: s.enCurso ? "streaming" : s.status,
    ...(s.enCurso ? { enServidor: true, startedAt: s.appliedAt } : {}),
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
    // reload reads as the honest dead state instead. La regla vive en
    // `accionesAlRecargar`: Len-Bench rehace el historial con la misma.
    actions: accionesAlRecargar(s.actions),
    noDocChange: s.noDocChange,
    // Guardado como cortado por el servidor: el aviso se compone al pintar,
    // en el idioma de quien lo mira (`AvisoDeTurno`).
    ...(s.cortado ? { cortado: true } : {}),
    // Lo que cobró y tardó, si el servidor lo apuntó (plans/new-chat/).
    ...(typeof s.centicredits === "number" ? { centicredits: s.centicredits } : {}),
    ...(typeof s.durationMs === "number" ? { durationMs: s.durationMs } : {}),
    ...(s.origen ? { origen: s.origen } : {}),
    ...(s.autor ? { autor: s.autor } : {}),
    ...(s.tipo ? { tipo: s.tipo } : {}),
    ...(s.autorId ? { autorId: s.autorId } : {}),
    ...(s.menciones ? { menciones: s.menciones } : {}),
  };
}

/** PIEZA 8 · la ronda siguiente de un encargo, que el servidor ya abrió: se
 *  pinta en marcha y se sigue desde su fila, como un turno de Len 2.1. Su texto
 *  es el mensaje de esa ronda, el mismo que guardará el servidor. */
function rondaEnCamino(id: string, goal: GoalView | null): DesignTurn {
  return restoreTurn({
    id,
    userText: goal ? roundTextFor("resume", "", goal) : "",
    assistantReasoning: "",
    status: "applied",
    appliedAt: Date.now(),
    enCurso: true,
  });
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
  budget_limit: true,
  cancelled: true,
  truncated: true,
  upstream: true,
  no_credits: true,
  agent_off: true,
};

function isAgentErrorCode(value: unknown): value is AgentErrorCode {
  return typeof value === "string" && value in AGENT_ERROR_CODE_KEYS;
}

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
