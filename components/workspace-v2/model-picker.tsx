"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronUp } from "./icons";
import { StatusDot } from "./ui";
import type { AIModel } from "@/lib/ai-provider";

// Model picker shared by the Chat redesign composer and the AI generation
// brief panel — a small dropdown to switch between the two Gemini tiers.

// Model display names are product nouns (kept literal); `noteKey` resolves
// to a translated descriptor at render time.
const MODEL_META: Record<
  AIModel,
  { label: string; short: string; dot: string; noteKey: string }
> = {
  "gemini-pro": {
    label: "Gemini 3.1 Pro",
    short: "Pro",
    dot: "#4285F4",
    noteKey: "modelPicker.note.deeper",
  },
  "gemini-flash": {
    label: "Gemini 3.5 Flash",
    short: "Flash",
    dot: "#10B981",
    noteKey: "modelPicker.note.recommended",
  },
};

const STORAGE_KEY = "openlen:ai-model";

/** The model choice, backed by localStorage so it survives reloads and is
 *  shared across the chat + generation surfaces. */
export function useAIModel(): [AIModel, (m: AIModel) => void] {
  const [model, setModel] = useState<AIModel>("gemini-flash");
  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "gemini-pro" || stored === "gemini-flash") setModel(stored);
  }, []);
  const choose = useCallback((m: AIModel) => {
    setModel(m);
    try {
      window.localStorage.setItem(STORAGE_KEY, m);
    } catch {
      /* private mode — the choice still applies this session */
    }
  }, []);
  return [model, choose];
}

export function ModelPicker({
  model,
  onChange,
  disabled = false,
  compact = false,
}: {
  model: AIModel;
  onChange: (m: AIModel) => void;
  disabled?: boolean;
  /** Narrow surfaces (the chat composer) show the tier word only
   *  ("Flash"/"Pro") instead of the full model name to save row width. */
  compact?: boolean;
}) {
  const t = useTranslations("wsChrome");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        title={t("modelPicker.switch")}
        className="inline-flex items-center gap-1.5 h-7 px-2 rounded-md text-[10px] fg-muted ui-small hover:fg hover:bg-hover transition disabled:opacity-40"
      >
        <StatusDot color={MODEL_META[model].dot} pulse />
        <span>{compact ? MODEL_META[model].short : MODEL_META[model].label}</span>
        <ChevronUp size={10} className={open ? "rotate-180" : ""} />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 mb-1.5 w-48 rounded-lg border bd bg-elev shadow-card p-1 z-30">
          {(Object.keys(MODEL_META) as AIModel[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                onChange(m);
                setOpen(false);
              }}
              className={`w-full inline-flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[11.5px] transition ${
                m === model ? "bg-accent-soft text-accent" : "fg hover:bg-hover"
              }`}
            >
              <StatusDot color={MODEL_META[m].dot} pulse={m === model} />
              <span>{MODEL_META[m].label}</span>
              <span className="ml-auto text-[9.5px] fg-faint ui-small">
                {t(MODEL_META[m].noteKey)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
