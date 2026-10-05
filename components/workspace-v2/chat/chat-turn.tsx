"use client";

// UN TURNO EN EL CHAT NUEVO (plans/new-chat/): tu mensaje y lo que hizo Len.
//
// Tu mensaje: el texto, la imagen y el elemento acotado que viajaron con él (la
// prueba de que se mandaron), y lo que escribiste a media faena (`↳`) como
// burbujas aparte. Lo de Len, de arriba abajo: los pasos (plegados al cerrar),
// lo que dijo, la pregunta si acabó preguntando, lo que cambió, las tarjetas de
// publicar y de responder, y el cierre. Todo con las piezas y reglas de siempre.

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { Crosshair, CornerDownRight, Flag } from "lucide-react";

import { TextoDeLen } from "../texto-de-len";
import { AgentConfirmCard } from "../agent-confirm-card";
import { AgentReplyCard, type EtiquetasDeRespuesta } from "../agent-reply-card";
import { mismaPagina } from "../panels/undo-turn";
import { cambiosEnVivo, type CambiosDeUnTurno } from "@/lib/workspace-v2/cambios-en-vivo";
import { abrirEnElCodigo, abrirFicheroDelTurno, rutasDelTurno } from "@/lib/workspace-v2/abrir-fichero";
import type { FeedbackReason, TurnFeedback } from "@/lib/chat/feedback-reasons";
import { ChangesCard } from "./changes-card";
import { wroteOnlyItsOwnPage } from "./turn-changes";
import { questionOf, questionsOf } from "./live-status";
import { asksTheOwner, questionText, type QuestionAnswer, type UserQuestion } from "@/lib/agent/ask-user-question";
import { QuestionCard, withoutTrailingQuestion } from "./question-card";
import { StepsCard, visibleSteps } from "./steps-card";
import { LenFace } from "./len-face";
import { TurnClose } from "./turn-close";
import type { DesignTurn } from "./use-agent-chat";
import { roundOfTurn } from "./goal-state";

const NO_TURNS: readonly CambiosDeUnTurno[] = [];

/** Tu mensaje y lo que corregiste a media faena (las líneas `↳`). */
export function splitCorrections(userText: string): { text: string; corrections: string[] } {
  const parts = userText.split("\n↳ ");
  return { text: parts[0] ?? "", corrections: parts.slice(1) };
}

export function UserMessage({ turn, initial }: { turn: DesignTurn; initial: string }) {
  const t = useTranslations("panelsChat");
  const { text: escrito, corrections } = splitCorrections(turn.userText);
  // PIEZA 8 · LAS RONDAS DEL ENCARGO: su mensaje (el de DeepSeek) queda en la
  // charla porque lo lee el modelo, pero el dueño no lo escribió. La ronda 1 es
  // su mensaje —su objetivo—; las siguientes, una línea.
  const ronda = roundOfTurn(escrito);
  const text = ronda ? ronda.objective : escrito;
  if (ronda && ronda.round > 1) {
    return (
      <div className="flex flex-col items-end gap-1.5">
        <div className="nc-up flex w-full items-center gap-2 text-[11.5px] fg-faint">
          <span className="h-px flex-1 bg-[var(--border)]" />
          <Flag size={11} className="shrink-0 text-[var(--nc-accent-text)]" />
          <span className="shrink-0 tabular-nums">{t("newChat.goal.roundLine", { round: ronda.round, max: ronda.maxGoalRounds })}</span>
          <span className="h-px flex-1 bg-[var(--border)]" />
        </div>
        {corrections.map((c, i) => (
          <div
            key={i}
            className="nc-up mr-8 flex max-w-[88%] items-start gap-1.5 rounded-[16px_16px_4px_16px] border border-dashed bd-strong bg-elev px-2.5 py-1.5 text-[12.5px] fg"
          >
            <CornerDownRight size={13} className="mt-0.5 shrink-0 text-[var(--nc-accent-text)]" />
            <span className="min-w-0 whitespace-pre-wrap break-words">{c}</span>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="nc-up flex items-end justify-end gap-2">
        <div className="max-w-[84%] whitespace-pre-wrap break-words rounded-[16px_16px_4px_16px] border bd bg-elev px-3 py-2 text-[14px] leading-relaxed fg">
          {turn.attachedImage && (
            <div className="mb-1.5 flex items-center gap-1.5 text-[11.5px] fg-muted">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={turn.attachedImage.url} alt="" className="h-9 w-9 rounded-[7px] object-cover" />
              {t("turn.imageSent")}
            </div>
          )}
          {turn.scope && (
            <div className="mb-1.5 flex min-w-0 items-center gap-1.5 text-[11.5px] fg-muted">
              <Crosshair size={12} className="shrink-0 text-[var(--nc-accent-text)]" />
              <span className="min-w-0 truncate font-mono">{turn.scope.hint}</span>
            </div>
          )}
          {ronda && (
            <div className="mb-1 flex items-center gap-1.5 text-[11.5px] font-semibold text-[var(--nc-accent-text)]">
              <Flag size={12} className="shrink-0" />
              {t("newChat.goal.label")}
            </div>
          )}
          {text}
        </div>
        <span
          aria-hidden
          className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#FF7E55] to-[#C72E10] text-[10.5px] font-bold text-white"
        >
          {initial}
        </span>
      </div>
      {corrections.map((c, i) => (
        <div
          key={i}
          className="nc-up mr-8 flex max-w-[88%] items-start gap-1.5 rounded-[16px_16px_4px_16px] border border-dashed bd-strong bg-elev px-2.5 py-1.5 text-[12.5px] fg"
        >
          <CornerDownRight size={13} className="mt-0.5 shrink-0 text-[var(--nc-accent-text)]" />
          <span className="min-w-0 whitespace-pre-wrap break-words">{c}</span>
        </div>
      ))}
    </div>
  );
}

export function LenTurn({
  turn,
  next,
  isLast,
  currentPage,
  projectId,
  when,
  vote,
  labels,
  onUndo,
  onRetry,
  onPublished,
  onConfirmSettled,
  onAnswerQuestion,
  onDismissQuestion,
  onRate,
  onClearRate,
}: {
  turn: DesignTurn;
  /** El turno siguiente, si lo hay: su mensaje es la respuesta a una pregunta. */
  next: DesignTurn | undefined;
  isLast: boolean;
  currentPage: string | null;
  projectId: string;
  when: string;
  vote: TurnFeedback | undefined;
  labels: EtiquetasDeRespuesta;
  onUndo: (turn: DesignTurn) => void;
  onRetry: (turn: DesignTurn) => void;
  onPublished: (url: string) => void;
  onConfirmSettled: (turnId: string) => void;
  /** Pieza 3: la respuesta a una pregunta de Len, desde su tarjeta. */
  onAnswerQuestion: (turnId: string, questions: readonly UserQuestion[], answers: QuestionAnswer[]) => void;
  /** Lote 7-8: «Pedir cambios» en la revisión del plan (descartar y escribir). */
  onDismissQuestion: (turnId: string) => void;
  /** Devuelve si el servidor guardó el voto: «Gracias» sólo entonces. */
  onRate: (rating: "up" | "down", reasons?: readonly FeedbackReason[], note?: string | null) => Promise<boolean>;
  onClearRate: () => Promise<boolean>;
}) {
  const t = useTranslations("panelsChat");
  // LAS RUTAS DE ESTE TURNO ABREN SU FICHERO (la #9): las de sus pasos y las que
  // Len nombra entre comillas de código, si el turno las leyó o las cambió.
  const turnsWithChanges = useSyncExternalStore(
    cambiosEnVivo.subscribe,
    () => cambiosEnVivo.turnos(projectId),
    () => NO_TURNS,
  );
  const paths = useMemo(
    () =>
      rutasDelTurno(
        turn.actions,
        turnsWithChanges.find((x) => x.turnId === turn.id)?.ficheros.map((f) => f.ruta) ?? [],
      ),
    [turn.actions, turn.id, turnsWithChanges],
  );
  const openFile = useCallback(
    (path: string) => abrirFicheroDelTurno(projectId, turn.id, path, { cambios: cambiosEnVivo, codigo: abrirEnElCodigo }),
    [projectId, turn.id],
  );
  const question = questionOf(turn);
  // Alinear con DeepSeek: las preguntas que el dueño DESCARTÓ, asentadas y
  // «canceladas», con el plan a la vista (allí la fila queda en el hilo).
  const cancelledQuestions = (turn.actions ?? []).filter((a) => asksTheOwner(a.tool) && a.dismissed && a.preguntas?.length);
  // PIEZA 3: la pregunta que el turno ESPERA ahora mismo (se contesta y Len
  // sigue), o la que dejó al cerrar (se contesta y abre el turno siguiente;
  // sólo en el último turno, y sólo si nadie la contestó ya).
  const liveQuestions = turn.status === "streaming" && turn.pendingQuestions?.length ? turn.pendingQuestions : null;
  const endedQuestions: readonly UserQuestion[] | null = question === null ? null : (questionsOf(turn) ?? (question ? [{ id: "q1", question }] : null));
  const text = withoutTrailingQuestion(turn.assistantReasoning, question);
  const streaming = turn.status === "streaming";
  const samePage = mismaPagina(turn.page, currentPage);
  const hasSteps = visibleSteps(turn.actions).length > 0;
  const showChanges = turn.status === "applied" || turn.status === "reverted";

  // Nada que enseñar todavía: la barra viva dice «Pensando».
  if (streaming && !hasSteps && text.length === 0) return null;

  return (
    <div className="nc-turn nc-up flex flex-col gap-2.5" data-last={isLast}>
      <div className="flex items-center gap-1.5 text-[12.5px]">
        <LenFace size={18} className="shrink-0" />
        <b className="font-semibold">Len</b>
        <span className="text-[11.5px] fg-faint">{when}</span>
        {!samePage && (
          <span className="ml-auto rounded-full border bd px-2 py-px text-[10.5px] fg-faint">
            {turn.page ? `/${turn.page}` : t("turn.homePage")}
          </span>
        )}
      </div>
      {hasSteps && <StepsCard turn={turn} projectId={projectId} onOpenFile={openFile} />}
      {text.length > 0 && (
        <p className="m-0 whitespace-pre-wrap break-words text-[14px] leading-[1.62] fg [text-wrap:pretty]">
          <TextoDeLen texto={text} rutas={paths} onAbrir={openFile} />
          {streaming && <span className="nc-caret" />}
        </p>
      )}
      {liveQuestions && (
        <QuestionCard
          question={questionText(liveQuestions)}
          questions={liveQuestions}
          answer={turn.answeredLive ?? null}
          onAnswer={(answers) => onAnswerQuestion(turn.id, liveQuestions, answers)}
          onDismiss={() => onDismissQuestion(turn.id)}
        />
      )}
      {cancelledQuestions.map((a, i) => (
        <QuestionCard key={`cancelada-${i}`} question={questionText(a.preguntas!)} questions={a.preguntas} answer={null} cancelled />
      ))}
      {question !== null && (
        <QuestionCard
          question={question}
          questions={endedQuestions}
          answer={next ? next.userText : null}
          onAnswer={!next && isLast && endedQuestions ? (answers) => onAnswerQuestion(turn.id, endedQuestions, answers) : undefined}
          onDismiss={!next && isLast && endedQuestions ? () => onDismissQuestion(turn.id) : undefined}
        />
      )}
      {/* «Ver» y «Comparar» necesitan que el turno escribiera la página que se
          mira, no sólo que empezara en ella (N33). La pastilla de arriba sí va
          por dónde empezó. */}
      {showChanges && !turn.noDocChange && (
        <ChangesCard turn={turn} projectId={projectId} samePage={samePage && wroteOnlyItsOwnPage(turn)} />
      )}
      {turn.confirm && (
        <AgentConfirmCard
          projectId={projectId}
          confirm={turn.confirm}
          onPublished={(url) => {
            onConfirmSettled(turn.id);
            onPublished(url);
          }}
          onCancelled={() => onConfirmSettled(turn.id)}
        />
      )}
      {turn.respuesta && <AgentReplyCard respuesta={turn.respuesta} labels={labels} />}
      <TurnClose
        turn={turn}
        currentPage={currentPage}
        vote={vote}
        onUndo={onUndo}
        onRetry={onRetry}
        onRate={onRate}
        onClearRate={onClearRate}
      />
    </div>
  );
}
