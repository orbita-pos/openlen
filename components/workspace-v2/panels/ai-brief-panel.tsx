// AI brief panel — sidebar entry for `?mode=ai` in /new. Visually
// mirrors ChatPanel (V2 design tokens, chat-style composer + empty-state
// quick prompts) so the AI generation flow feels like the editing chat
// the user already knows. Submits to the orchestrator via the parent's
// `onGenerate` (which wraps `useGeneration.generate`).

"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  ChevronUp,
  Loader,
  SendUp,
  Sparkles,
  WandSparkles,
  Zap,
} from "../icons";
import type { BriefFormState } from "@/components/workspace/types";
import { QUICK_PROMPTS } from "@/lib/quick-prompts";

/** Cuánto trabajo se pone en la página. Hoy sólo existe `low` — es el nivel con
 *  el que nacieron las páginas que ya funcionan; `medium` y `high` se ven en el
 *  selector, apagados, porque todavía no hay nada detrás de ellos. */
export type PageEffort = "low" | "medium" | "high";

export interface AiBriefPanelProps {
  state: BriefFormState;
  onGenerate: () => void;
  generating: boolean;
  effort: PageEffort;
  onEffortChange: (effort: PageEffort) => void;
}

export function AiBriefPanel({
  state,
  onGenerate,
  generating,
  effort,
  onEffortChange,
}: AiBriefPanelProps) {
  const t = useTranslations("panelsA");
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Focus the composer on mount so users can just start typing.
  useEffect(() => {
    taRef.current?.focus();
  }, []);

  // Auto-grow the textarea up to ~10 lines.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [state.prompt]);

  const canGenerate = state.prompt.trim().length >= 10 && !generating;

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto nice-scroll px-3 py-3">
        <div className="pt-2">
          <div className="text-center mb-4">
            <div className="mx-auto mb-2.5 inline-flex h-9 w-9 items-center justify-center rounded-md ring-1 ring-[color:var(--border)] bg-elev text-accent">
              <Sparkles size={15} />
            </div>
            <h3 className="text-[14px] font-semibold fg leading-tight">
              {t("aiBrief.title")}
            </h3>
            <p className="mt-1 text-[11px] fg-faint leading-relaxed">
              {t("aiBrief.subtitle")}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {QUICK_PROMPTS.map((p) => (
              <button
                key={p.key}
                type="button"
                disabled={generating}
                onClick={() => state.setPrompt(p.prompt)}
                className="text-left text-[11.5px] fg leading-tight px-2.5 py-2 rounded-md ring-1 ring-[color:var(--border)] bg-[color:var(--bg)] hover:bg-hover hover:ring-[color:var(--border-strong)] transition disabled:opacity-50"
              >
                {t(`quickPrompts.${p.key}`)}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="shrink-0 px-3 pb-3">
        <div className="rounded-xl border bd bg-elev focus-within:border-[color:var(--accent)] focus-within:ring-1 focus-within:ring-[color:var(--accent-ring)]/30 transition">
          <textarea
            ref={taRef}
            value={state.prompt}
            onChange={(e) => state.setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (canGenerate) onGenerate();
              }
            }}
            rows={1}
            disabled={generating}
            placeholder={t("aiBrief.placeholder")}
            maxLength={2000}
            className="block w-full bg-transparent text-[12.5px] leading-relaxed px-3 pt-2.5 pb-1 fg placeholder:fg-faint focus:outline-none resize-none nice-scroll disabled:opacity-60"
            style={{ minHeight: 32 }}
          />
          <div className="flex items-center justify-between px-1.5 pb-1.5 pt-0.5">
            {/* Just the effort chooser on the left — the editing affordances
                (image / scope / autofill) belong to the edit chat, not the
                brief, and crowding them here overflowed the row. */}
            <div className="flex items-center gap-0.5 min-w-0">
              <EffortSelect
                effort={effort}
                onEffortChange={onEffortChange}
                disabled={generating}
              />
            </div>
            <button
              type="button"
              onClick={onGenerate}
              disabled={!canGenerate}
              aria-label={t("aiBrief.generate")}
              className={`inline-flex shrink-0 items-center justify-center gap-1 h-7 rounded-md text-[11.5px] font-medium transition ${
                canGenerate
                  ? "px-2.5 bg-[var(--accent-strong)] text-white shadow-coral hover:brightness-105"
                  : "w-7 bg-hover fg-faint cursor-not-allowed"
              }`}
            >
              {generating ? (
                <Loader size={12} className="animate-spin" />
              ) : canGenerate ? (
                <>
                  <SendUp size={12} /> <span>{t("aiBrief.generate")}</span>
                </>
              ) : (
                <SendUp size={13} />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Effort select — cuánto trabajo se pone en la página, como un desplegable
// compacto para que los nombres vivan en el popover y no aprieten la fila del
// composer. Exportado para que el inicio de /new use exactamente el mismo
// control.
//
// Los niveles que aún no existen se MUESTRAN apagados en vez de esconderse: es
// lo que hace legible que hay más y que esto es un dial, no un interruptor.
export function EffortSelect({
  effort,
  onEffortChange,
  disabled,
}: {
  effort: PageEffort;
  onEffortChange: (effort: PageEffort) => void;
  disabled: boolean;
}) {
  const t = useTranslations("panelsA");
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

  const OPTIONS = [
    { value: "low" as const, icon: <Zap size={12} />, label: t("aiBrief.effortLow"), ready: true },
    { value: "medium" as const, icon: <Sparkles size={12} />, label: t("aiBrief.effortMedium"), ready: false },
    { value: "high" as const, icon: <WandSparkles size={12} />, label: t("aiBrief.effortHigh"), ready: false },
  ];
  const current = OPTIONS.find((o) => o.value === effort) ?? OPTIONS[0];

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 h-7 px-2 rounded-md text-[10.5px] fg-muted hover:fg hover:bg-hover transition disabled:opacity-40"
      >
        {current.icon}
        <span>{current.label}</span>
        <ChevronUp size={10} className={open ? "rotate-180" : ""} />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 mb-1.5 w-44 rounded-lg border bd bg-elev shadow-card p-1 z-30">
          {OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              disabled={!o.ready}
              onClick={() => {
                onEffortChange(o.value);
                setOpen(false);
              }}
              className={`w-full inline-flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[11.5px] transition ${
                !o.ready
                  ? "fg-faint cursor-not-allowed"
                  : o.value === effort
                    ? "bg-accent-soft text-accent"
                    : "fg hover:bg-hover"
              }`}
            >
              {o.icon}
              <span>{o.label}</span>
              {!o.ready && (
                <span className="ml-auto text-[8.5px] font-semibold uppercase tracking-wide fg-faint">
                  {t("aiBrief.effortSoon")}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

