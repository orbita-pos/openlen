"use client";

// EL COMPOSITOR DEL CHAT NUEVO (plans/new-chat/, la forma del mock). Hace TODO
// lo que hace el de hoy —fichas de comentarios de código, el elemento acotado y
// la imagen (las dos se van con el mensaje), Enter manda y Mayús+Enter salta,
// el botón que sigue a la caja (enviar / ■ / Dirigir), el modo Len / Len
// Dynamis y el esfuerzo— con otra piel: «+» abre imagen y acotar, la mira
// sigue a mano, y el modo y el esfuerzo son pastillas al final de la fila.
//
// Lo que hace cada botón lo decide `useAgentChat` (`submit`, `handleCancel`…):
// aquí no hay lógica de turno.

import { useState, type ReactNode, type RefObject } from "react";
import { useTranslations } from "next-intl";
import { ArrowUp, Crosshair, Flag, ImageIcon, ListChecks, MessageSquare, Plus, Square, X } from "lucide-react";

import { MandoEsfuerzo } from "../panels/mando-esfuerzo";
import { ModePicker } from "../panels/mode-picker";
import { useMandoDesplegable } from "../use-mando-desplegable";
import type { AgentMode } from "@/lib/agent/dynamis";
import type { EsfuerzoAgente, NivelEsfuerzo } from "@/lib/agent/esfuerzo";
import type { ComentarioDeLinea } from "@/lib/workspace-v2/comentarios-de-lineas";
import type { AttachedImage, ScopedSelection } from "./use-agent-chat";
import { CajaConMenciones, useArroba } from "../hilos-del-codigo";
import type { PersonaMencionable } from "@/lib/workspace-v2/menciones";

const NADIE: readonly PersonaMencionable[] = [];
const SIN_COLOR = () => "";

export function ChatComposer({
  value,
  onChange,
  onSubmit,
  onStop,
  busy,
  textareaRef,
  comments,
  onRemoveComment,
  scopedSelection,
  onClearScope,
  sectionSelectMode,
  onToggleSectionSelect,
  attachedImage,
  onAttachImage,
  onClearAttachedImage,
  effort,
  effortLevels,
  effortResolvesTo,
  onEffortChange,
  mode,
  onModeChange,
  planMode = false,
  onTogglePlan,
  goalChip = false,
  goalAvailable = true,
  onToggleGoal,
  debajo,
  etiquetaEnviar,
  placeholder,
  esApp = false,
  mencionables,
  bloqueado = false,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  busy: boolean;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  comments: readonly ComentarioDeLinea[];
  onRemoveComment: (id: number) => void;
  scopedSelection: ScopedSelection | null;
  onClearScope?: () => void;
  sectionSelectMode: boolean;
  onToggleSectionSelect?: (active: boolean) => void;
  attachedImage: AttachedImage | null;
  onAttachImage: () => void;
  onClearAttachedImage: () => void;
  effort: EsfuerzoAgente;
  effortLevels: readonly NivelEsfuerzo[];
  effortResolvesTo: NivelEsfuerzo;
  onEffortChange: (e: EsfuerzoAgente) => void;
  mode: AgentMode;
  /** Sin él no se ofrece Len Dynamis (el servidor no lo ofrece). */
  onModeChange?: (m: AgentMode) => void;
  /** Pieza 7: el modo plan que se ve y quien lo cambia. Sin `onTogglePlan` no
   *  se ofrece (el chat clásico no lo tiene). */
  planMode?: boolean;
  onTogglePlan?: () => void;
  /** Pieza 8: la ficha «Encargo» (el mensaje será el objetivo), si se puede
   *  poner (sin un encargo vivo) y quien la cambia. Sin `onToggleGoal` no se
   *  ofrece. */
  goalChip?: boolean;
  goalAvailable?: boolean;
  onToggleGoal?: () => void;
  /** EL CHAT DEL EQUIPO: la línea de a quién va, debajo de la caja. */
  debajo?: ReactNode;
  /** «Enviar a Eli» cuando el mensaje es para una persona: también con Len
   *  trabajando, porque entonces el botón no dirige a Len. */
  etiquetaEnviar?: string;
  /** El texto de la caja vacía, si no es el de siempre (sin turno corriendo). */
  placeholder?: string;
  /** El proyecto es una app: la caja vacía habla de la app, no de «tu página». */
  esApp?: boolean;
  /** EL CHAT DEL EQUIPO: con gente, «@» sugiere a Len (si puede) y a cada
   *  persona, y las menciones se ven en su color dentro de la caja, como en los
   *  hilos del código. Sin esto, la caja de siempre. */
  mencionables?: { gente: readonly PersonaMencionable[]; colorDe: (userId: string) => string; conLen: boolean };
  /** No se puede enviar lo que hay en la caja (un mensaje al equipo en vuelo,
   *  o un lector que le pide algo a Len): ni el botón ni Enter envían. */
  bloqueado?: boolean;
}) {
  const t = useTranslations("panelsChat");
  const [plusOpen, setPlusOpen] = useState(false);
  const [effortOpen, setEffortOpen] = useState(false);
  const [modeOpen, setModeOpen] = useState(false);
  const plus = useMandoDesplegable({ abierto: plusOpen, cerrar: () => setPlusOpen(false) });
  // Con comentarios esperando se puede mandar sin escribir nada más.
  const hasContent = value.trim().length > 0 || comments.length > 0;
  const typed = value.trim().length > 0;
  const tr = t as unknown as (k: string, v?: Record<string, string>) => string;
  const arroba = useArroba(value, onChange, textareaRef, mencionables?.gente ?? NADIE, mencionables?.conLen ?? false, mencionables?.colorDe);

  return (
    <div>
      <div className="nc-composer relative rounded-[16px] border bd-strong bg-elev px-3 pb-[7px] pt-2 shadow-[0_1px_2px_rgb(0_0_0/0.04)] transition">
        {(comments.length > 0 || scopedSelection || attachedImage || (planMode && onTogglePlan) || (goalChip && onToggleGoal)) && (
          <div className="mb-1 flex flex-wrap gap-1.5">
            {/* PIEZA 7 · LA FICHA «PLAN», la de DeepSeek: está mientras dura el
                modo plan y su ✕ lo apaga. Mientras Len trabaja no se toca (se
                elige al mandar, como el modo y el esfuerzo). */}
            {planMode && onTogglePlan && (
              <Chip title={t("newChat.plan.optionHint")} onRemove={busy ? undefined : onTogglePlan} removeLabel={t("newChat.plan.chipOff")}>
                <ListChecks size={12} className="shrink-0 text-[var(--nc-accent-text)]" />
                <b className="shrink-0 font-semibold">{t("newChat.plan.chip")}</b>
              </Chip>
            )}
            {/* PIEZA 8 · LA FICHA «ENCARGO», el `/goal <objetivo>` de DeepSeek:
                lo que mandes es el objetivo, y Len sigue solo hasta terminarlo. */}
            {goalChip && onToggleGoal && (
              <Chip title={t("newChat.goal.optionHint")} onRemove={busy ? undefined : onToggleGoal} removeLabel={t("newChat.goal.chipOff")}>
                <Flag size={12} className="shrink-0 text-[var(--nc-accent-text)]" />
                <b className="shrink-0 font-semibold">{t("newChat.goal.chip")}</b>
              </Chip>
            )}
            {comments.map((c) => (
              <Chip key={c.id} title={c.texto} onRemove={() => onRemoveComment(c.id)} removeLabel={t("comentarios.quitar")}>
                <MessageSquare size={12} className="shrink-0 text-[var(--nc-accent-text)]" />
                <b className="shrink-0 font-mono text-[11px] font-semibold">
                  {c.ruta.replace(/^\/+/, "")}:{c.linea}
                </b>
                <span className="min-w-0 truncate fg-muted">{c.texto}</span>
              </Chip>
            ))}
            {scopedSelection && (
              <Chip onRemove={onClearScope} removeLabel={t("composer.clearScope")}>
                <Crosshair size={12} className="shrink-0 text-[var(--nc-accent-text)]" />
                <b className="shrink-0 font-semibold">{t("composer.scoped")}</b>
                <span className="min-w-0 truncate font-mono text-[11px]">{scopedSelection.hint}</span>
              </Chip>
            )}
            {attachedImage && (
              <Chip onRemove={onClearAttachedImage} removeLabel={t("composer.removeImage")}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={attachedImage.url} alt="" className="h-[18px] w-[18px] rounded object-cover" />
                <b className="shrink-0 font-semibold">{t("composer.image")}</b>
                <span className="min-w-0 truncate">{attachedImage.alt || hostOf(attachedImage.url)}</span>
              </Chip>
            )}
          </div>
        )}
        {(() => {
          const caja = {
            value,
            onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => {
              onChange(e.target.value);
              arroba.onSeleccion(e);
            },
            onSelect: arroba.onSeleccion,
            onClick: arroba.onSeleccion,
            onKeyUp: arroba.onSeleccion,
            onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
              // Con el desplegable del @ abierto, Enter/Tab/flechas son suyos.
              if (arroba.tecla(e)) return;
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (!bloqueado) onSubmit();
              }
            },
            rows: 1,
            placeholder: busy
              ? t("composer.placeholderRunning")
              : goalChip && onToggleGoal
                ? t("newChat.goal.placeholder")
                : scopedSelection
                ? t("composer.placeholderScoped", { target: scopedSelection.hint.split(" ")[0] ?? "" })
                : (placeholder ?? t(esApp ? "composer.placeholderApp" : "composer.placeholder")),
            style: { minHeight: 44 },
          };
          // UNA sola caja, con o sin gente: si la gente llega mientras se
          // escribe, se encienden los colores sin desmontarla ni quitarle el foco.
          return (
            <div className="mt-0.5">
              {arroba.menu && <div className="absolute bottom-full left-0 right-0 z-20 mb-1.5">{arroba.menu}</div>}
              <CajaConMenciones
                {...caja}
                cajaRef={textareaRef}
                pintar={!!mencionables}
                gente={mencionables?.gente ?? NADIE}
                colorDe={mencionables?.colorDe ?? SIN_COLOR}
                medida="text-[14px] leading-normal"
                className="outline-none placeholder:fg-faint nice-scroll"
              />
            </div>
          );
        })()}
        <div className="mt-0.5 flex items-center gap-[3px]">
          <div className="relative" ref={plus.refContenedor} onKeyDown={plus.alPulsarTecla}>
            <button
              type="button"
              ref={plus.refDisparador}
              aria-label={t("newChat.composer.plus")}
              title={t("newChat.composer.plus")}
              aria-haspopup="menu"
              aria-expanded={plusOpen}
              onClick={() => setPlusOpen((x) => !x)}
              disabled={busy}
              className={`grid h-[30px] w-[30px] place-items-center rounded-[9px] transition disabled:opacity-40 ${
                attachedImage || scopedSelection ? "text-[var(--nc-accent-text)]" : "fg-muted"
              } hover:bg-side hover:fg`}
            >
              <Plus size={16} className={`transition-transform duration-200 ${plusOpen ? "rotate-45" : ""}`} />
            </button>
            {plusOpen && (
              <div
                role="menu"
                aria-label={t("newChat.composer.plus")}
                className="nc-card-in absolute bottom-[calc(100%+8px)] left-0 z-20 w-[290px] rounded-[14px] border bd-strong bg-elev p-1.5 shadow-[0_18px_40px_-12px_rgb(20_10_5/0.35)]"
              >
                <PlusOption
                  icon={<ImageIcon size={15} />}
                  title={t("composer.attachImage")}
                  hint={t("composer.attachImageTitle")}
                  on={attachedImage !== null}
                  onLabel={t("newChat.composer.on")}
                  onClick={() => {
                    setPlusOpen(false);
                    onAttachImage();
                  }}
                />
                {onTogglePlan && (
                  <PlusOption
                    icon={<ListChecks size={15} />}
                    title={t("newChat.plan.option")}
                    hint={t("newChat.plan.optionHint")}
                    on={planMode}
                    onLabel={t("newChat.composer.on")}
                    onClick={() => {
                      setPlusOpen(false);
                      onTogglePlan();
                    }}
                  />
                )}
                {onToggleGoal && (
                  <PlusOption
                    icon={<Flag size={15} />}
                    title={t("newChat.goal.option")}
                    hint={goalAvailable ? t("newChat.goal.optionHint") : t("newChat.goal.optionTaken")}
                    on={goalChip}
                    onLabel={t("newChat.composer.on")}
                    disabled={!goalAvailable}
                    onClick={() => {
                      setPlusOpen(false);
                      onToggleGoal();
                    }}
                  />
                )}
                {onToggleSectionSelect && (
                  <PlusOption
                    icon={<Crosshair size={15} />}
                    title={t("composer.selectSection")}
                    hint={t("composer.selectSectionTitle")}
                    on={sectionSelectMode || scopedSelection !== null}
                    onLabel={t("newChat.composer.on")}
                    onClick={() => {
                      setPlusOpen(false);
                      onToggleSectionSelect(!sectionSelectMode);
                    }}
                  />
                )}
              </div>
            )}
          </div>
          {onToggleSectionSelect && (
            <button
              type="button"
              aria-label={sectionSelectMode ? t("composer.cancelSelection") : t("composer.selectSection")}
              title={sectionSelectMode ? t("composer.cancelSelectionTitle") : t("composer.selectSectionTitle")}
              aria-pressed={sectionSelectMode}
              onClick={() => onToggleSectionSelect(!sectionSelectMode)}
              disabled={busy}
              className={`grid h-[30px] w-[30px] place-items-center rounded-[9px] transition hover:bg-side disabled:opacity-40 ${
                sectionSelectMode ? "bg-side text-[var(--nc-accent-text)]" : "fg-muted hover:fg"
              }`}
            >
              <Crosshair size={16} />
            </button>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            {onModeChange && (
              <ModePicker
                mode={mode}
                onChange={onModeChange}
                abierto={modeOpen}
                onAbrir={(v) => {
                  setModeOpen(v);
                  if (v) setEffortOpen(false);
                }}
                variant="pill"
                t={tr}
              />
            )}
            <MandoEsfuerzo
              esfuerzo={effort}
              niveles={effortLevels}
              resuelveA={effortResolvesTo}
              onChange={onEffortChange}
              abierto={effortOpen}
              onAbrir={(v) => {
                setEffortOpen(v);
                if (v) setModeOpen(false);
              }}
              locked={onModeChange !== undefined && mode === "dynamis"}
              variant="pill"
              t={tr}
            />
          </div>
          {/* EL BOTÓN SIGUE A LA CAJA: vacía y corriendo = ■; con texto y
              corriendo = «Dirigir», que corrige sin parar; parado = enviar. */}
          <button
            type="button"
            onClick={busy && !typed ? onStop : onSubmit}
            disabled={(!busy && !hasContent) || (bloqueado && typed)}
            aria-label={etiquetaEnviar && typed ? etiquetaEnviar : busy ? (typed ? t("composer.steer") : t("composer.stop")) : t("composer.send")}
            title={etiquetaEnviar && typed ? etiquetaEnviar : busy ? (typed ? t("composer.steer") : t("composer.stop")) : t("composer.send")}
            className={`ml-1 flex h-8 min-w-8 shrink-0 items-center justify-center gap-1.5 rounded-[10px] text-white transition hover:-translate-y-px disabled:translate-y-0 disabled:cursor-default ${
              bloqueado && typed
                ? "bg-[var(--border-strong)]"
                : busy && typed && !etiquetaEnviar
                ? "bg-[var(--accent-strong)] px-2.5 text-[12.5px] font-semibold"
                : busy && !(typed && etiquetaEnviar)
                  ? "bg-[var(--fg)] !text-[var(--bg)]"
                  : hasContent
                    ? "bg-[var(--accent-strong)]"
                    : "bg-[var(--border-strong)]"
            }`}
          >
            {busy && !typed ? (
              <Square size={12} className="fill-current" />
            ) : (
              <>
                <ArrowUp size={16} />
                {busy && !etiquetaEnviar && <span>{t("composer.steer")}</span>}
              </>
            )}
          </button>
        </div>
      </div>
      {debajo}
      <p className="mb-[-4px] mt-[7px] text-center text-[11px] fg-faint">{t(esApp ? "newChat.composer.disclaimerApp" : "newChat.composer.disclaimer")}</p>
    </div>
  );
}

function Chip({
  children,
  title,
  onRemove,
  removeLabel,
}: {
  children: ReactNode;
  title?: string;
  onRemove?: () => void;
  removeLabel: string;
}) {
  return (
    <span
      title={title}
      className="nc-pop inline-flex max-w-full items-center gap-1.5 rounded-lg border border-[color:color-mix(in_oklab,var(--accent)_30%,transparent)] bg-accent-soft py-[3px] pl-[7px] pr-1 text-[11.5px] fg"
    >
      {children}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
          className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] fg-muted hover:bg-[color-mix(in_oklab,var(--accent)_15%,transparent)] hover:fg"
        >
          <X size={10} />
        </button>
      )}
    </span>
  );
}

function PlusOption({
  icon,
  title,
  hint,
  on,
  onLabel,
  onClick,
  disabled = false,
}: {
  icon: ReactNode;
  title: string;
  hint: string;
  on: boolean;
  onLabel: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className="nc-up flex w-full items-center gap-2.5 rounded-[10px] p-2 text-left hover:bg-side disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
    >
      <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px] bg-accent-soft text-[var(--nc-accent-text)]">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <b className="block text-[13px] font-semibold">{title}</b>
        <small className="block text-[11.5px] leading-snug fg-muted">{hint}</small>
      </span>
      {on && <span className="shrink-0 text-[11px] font-semibold text-[var(--nc-accent-text)]">{onLabel}</span>}
    </button>
  );
}

function hostOf(raw: string): string {
  try {
    const u = new URL(raw);
    const path = u.pathname + (u.search || "");
    return u.host + (path.length > 24 ? `${path.slice(0, 24)}…` : path);
  } catch {
    return raw.length > 40 ? `${raw.slice(0, 40)}…` : raw;
  }
}
