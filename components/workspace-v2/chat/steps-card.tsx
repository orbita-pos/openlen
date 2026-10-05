"use client";

// LOS PASOS DE UN TURNO, en el chat nuevo (plans/new-chat/): «Len hizo 3 pasos ·
// 12 s», plegados cuando el turno cerró bien, como Claude Code y DeepSeek. Cada
// paso es una fila con su icono, su nombre en tu idioma y su detalle; las que
// tienen algo más (la salida de un comando, el motivo de un fallo, qué cubre una
// comprobación) se despliegan, y las de un fichero lo abren en el taller.
//
// Las REGLAS no son de aquí: el nombre, el detalle, el motivo y la cobertura
// son las de `agent-action-card.tsx` (`KNOWN_TOOLS`, `summaryLabel`,
// `coberturaTitle`); cuándo se pliega, `lib/workspace-v2/proceso-del-turno.ts`;
// la salida de la terminal, `SalidaEnLaTarjeta`. Esto sólo cambia la piel.

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  AlertTriangle,
  BarChart3,
  Bookmark,
  Check,
  ChevronRight,
  ExternalLink,
  Eye,
  Globe,
  HelpCircle,
  ImageIcon,
  MessageSquare,
  PenLine,
  Rocket,
  ScanSearch,
  Sparkles,
  SquareTerminal,
  ToggleRight,
  Undo2,
  type LucideIcon,
} from "lucide-react";

import { KNOWN_TOOLS, coberturaTitle, reasonLine, summaryLabel, type AgentAction } from "../agent-action-card";
import { SalidaEnLaTarjeta } from "../salida-en-la-tarjeta";
import { rutaDeLaTarjeta } from "@/lib/workspace-v2/abrir-fichero";
import { duracionLegible, procesoDelTurno } from "@/lib/workspace-v2/proceso-del-turno";
import { activityOf, type Activity } from "./live-status";
import { asksTheOwner } from "@/lib/agent/ask-user-question";
import type { DesignTurn } from "./use-agent-chat";

const ICON_OF: Readonly<Record<Activity, LucideIcon>> = {
  reading: Eye,
  editing: PenLine,
  terminal: SquareTerminal,
  photos: ImageIcon,
  image: ImageIcon,
  web: Globe,
  checking: ScanSearch,
  publishing: Rocket,
  remembering: Bookmark,
  results: BarChart3,
  reply: MessageSquare,
  module: ToggleRight,
  undoing: Undo2,
  asking: HelpCircle,
  working: Sparkles,
};

/** Los pasos que se pintan en la tarjeta: la pregunta con la que acaba un turno
 *  va en su propia tarjeta, no como un paso más. */
export function visibleSteps(actions: readonly AgentAction[] | undefined): AgentAction[] {
  const list = actions ?? [];
  // Pieza 3: una contestada dentro del turno (`respuesta`) sí es un paso.
  // Alinear con DeepSeek: una cancelada va en su tarjeta, esté donde esté.
  return list.filter(
    (a, i) =>
      !(asksTheOwner(a.tool) && a.dismissed) &&
      !(asksTheOwner(a.tool) && a.status !== "error" && !a.respuesta && i === list.length - 1),
  );
}

/** Cuántas tarjetas de la terminal van antes de la `i`-ésima: su posición entre ellas. */
function terminalIndex(actions: readonly AgentAction[], i: number): number {
  return actions.slice(0, i).filter((a) => a.tool === "bash").length;
}

export function StepsCard({
  turn,
  projectId,
  onOpenFile,
}: {
  turn: DesignTurn;
  projectId: string;
  onOpenFile: (path: string) => void;
}) {
  const t = useTranslations("panelsChat");
  const locale = useLocale();
  const all = turn.actions ?? [];
  const steps = visibleSteps(all);
  const process = procesoDelTurno({
    status: turn.status,
    enServidor: turn.enServidor,
    cortado: turn.cortado,
    avisoTurno: turn.avisoTurno,
    pasos: steps.length,
    startedAt: turn.startedAt,
    appliedAt: turn.appliedAt,
  });
  const foldable = process.plegable;
  const [open, setOpen] = useState(!foldable);
  const box = useRef<HTMLDivElement>(null);
  const before = useRef(foldable);
  useEffect(() => {
    if (foldable === before.current) return;
    before.current = foldable;
    if (!foldable) {
      setOpen(true);
      return;
    }
    // Se pliega solo al cerrar bien, salvo que el foco esté dentro.
    const focus = typeof document === "undefined" ? null : document.activeElement;
    if (focus && box.current?.contains(focus)) return;
    setOpen(false);
  }, [foldable]);

  if (steps.length === 0) return null;
  const running = turn.status === "streaming";
  const hasWarn = steps.some((a) => a.status === "warning" || a.status === "error");
  // La duración: la del servidor si la dijo (también al recargar); si no, la
  // que vio esta pestaña.
  const durationMs = turn.durationMs ?? (process.plegable ? process.duracionMs : null);
  const title = running ? t("newChat.steps.running") : t("newChat.steps.done", { count: steps.length });

  return (
    <div className="nc-card-in rounded-[14px] border bd bg-elev">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((x) => !x)}
        className="flex w-full items-center gap-2 rounded-[14px] px-3 py-2.5 text-left text-[12.5px]"
      >
        <span className="grid h-3.5 w-3.5 place-items-center">
          {running ? (
            <span className="nc-spin" />
          ) : hasWarn ? (
            <AlertTriangle size={14} className="nc-warn" />
          ) : (
            <Check size={14} className="nc-ok" />
          )}
        </span>
        <span className={`font-semibold ${running ? "nc-shimmer" : ""}`}>{title}</span>
        {durationMs !== null && !running && (
          <span className="fg-muted tabular-nums">· {duracionLegible(durationMs, locale)}</span>
        )}
        <ChevronRight
          size={14}
          className={`ml-auto fg-faint transition-transform duration-300 ${open ? "rotate-90" : ""}`}
        />
      </button>
      <div className="nc-fold" data-open={open}>
        <div>
          <div ref={box} className="px-1.5 pb-1.5">
            {steps.map((a, i) => (
              <StepRow
                key={`${a.tool}-${i}`}
                action={a}
                onOpenFile={onOpenFile}
                {...(a.tool === "bash"
                  ? { terminal: { projectId, turnId: turn.id, indice: terminalIndex(all, all.indexOf(a)) } }
                  : {})}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function StepRow({
  action,
  terminal,
  onOpenFile,
}: {
  action: AgentAction;
  terminal?: { projectId: string; turnId: string; indice: number };
  onOpenFile: (path: string) => void;
}) {
  const t = useTranslations("wsPage");
  const [open, setOpen] = useState(false);
  const label = KNOWN_TOOLS.has(action.tool) ? t(`agent.tool.${action.tool}`) : action.tool;
  const detail = summaryLabel(action, t);
  const coverage = coberturaTitle(action, t);
  // Qué porqué y en qué color: `reasonLine` (N41) — en rojo, nunca lo que leyó el modelo.
  const reason = reasonLine(action, t);
  const Icon = ICON_OF[activityOf(action.tool)];
  const tone = action.status === "error" ? "bad" : action.status === "warning" ? "warn" : undefined;
  const isTerminal = action.tool === "bash" && terminal !== undefined && action.status !== "running";
  // Lo que se despliega: la salida del comando, el motivo entero o qué cubre
  // la comprobación. Un fallo NUNCA se esconde detrás de un clic: su motivo
  // va también en la línea.
  const expandable = isTerminal || Boolean(reason) || Boolean(coverage);
  const path = action.status !== "running" ? rutaDeLaTarjeta(action) : null;

  const row = (
    <>
      <span className="nc-step-ic" data-running={action.status === "running"} data-tone={tone}>
        <Icon size={14} />
      </span>
      <span className="shrink-0 max-w-full break-words font-semibold">{label}</span>
      <span className={`min-w-0 flex-1 truncate ${tone === "warn" ? "nc-warn" : "fg-muted"}${action.tool === "bash" ? " font-mono text-[12px]" : ""}`}>
        {action.status === "error" ? [t("agent.failed"), reason].filter(Boolean).join(" · ") : detail}
      </span>
      <span className="flex shrink-0 items-center gap-1.5 text-[11.5px] fg-faint">
        {action.status === "running" ? (
          <span className="nc-spin" style={{ borderColor: "var(--border-strong)", borderTopColor: "var(--accent)" }} />
        ) : action.status === "done" ? (
          <Check size={14} className="nc-ok nc-pop" />
        ) : (
          <AlertTriangle size={14} className={tone === "bad" ? "nc-bad" : "nc-warn"} />
        )}
        {path ? (
          <ExternalLink size={12} className="opacity-0 transition-opacity group-hover:opacity-100" />
        ) : expandable ? (
          <ChevronRight size={12} className={`transition-transform duration-300 ${open ? "rotate-90" : ""}`} />
        ) : null}
      </span>
    </>
  );

  if (path) {
    return (
      <button
        type="button"
        onClick={() => onOpenFile(path)}
        title={reason || coverage || t("agent.abrirFichero")}
        className="group nc-up flex w-full items-center gap-2.5 rounded-[9px] p-1.5 text-left text-[13px] hover:bg-side"
      >
        {row}
      </button>
    );
  }
  if (!expandable) {
    return <div className="nc-up flex w-full items-center gap-2.5 rounded-[9px] p-1.5 text-[13px]">{row}</div>;
  }
  return (
    <div className="nc-up">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((x) => !x)}
        className="flex w-full items-center gap-2.5 rounded-[9px] p-1.5 text-left text-[13px] hover:bg-side"
      >
        {row}
      </button>
      <div className="nc-fold" data-open={open}>
        <div>
          {open && (
            <div className="pb-2.5 pl-[39px] pr-1.5">
              {isTerminal && terminal ? (
                <div className="overflow-hidden rounded-[9px] border bd bg-app">
                  <SalidaEnLaTarjeta
                    donde={terminal}
                    resumen={action.summary}
                    fallo={action.status === "error"}
                    onAbrirFichero={onOpenFile}
                  />
                </div>
              ) : null}
              {reason ? (
                <div className="nc-notice-warn mt-1 rounded-[9px] px-2.5 py-1.5 text-[12px] leading-snug break-words">
                  {reason}
                </div>
              ) : null}
              {coverage && !reason ? (
                <p className="mt-1 whitespace-pre-line text-[11.5px] leading-snug fg-muted">{coverage}</p>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
