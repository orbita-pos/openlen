// AI brief panel — sidebar entry for `?mode=ai` in /new-v2. Visually
// mirrors ChatPanel (V2 design tokens, chat-style composer + empty-state
// quick prompts) so the AI generation flow feels like the editing chat
// the user already knows. Submits to the orchestrator via the parent's
// `onGenerate` (which wraps `useGeneration.generate`).

"use client";

import { useEffect, useRef } from "react";
import {
  Crosshair,
  ImageIcon,
  Loader,
  SendUp,
  Sparkles,
  Wand,
} from "../icons";
import { ModelPicker } from "../model-picker";
import type { BriefFormState } from "@/components/workspace/types";
import type { AIModel } from "@/lib/ai-provider";
import { QUICK_PROMPTS } from "@/lib/quick-prompts";

export interface AiBriefPanelProps {
  state: BriefFormState;
  onGenerate: () => void;
  generating: boolean;
  model: AIModel;
  onModelChange: (m: AIModel) => void;
}

export function AiBriefPanel({
  state,
  onGenerate,
  generating,
  model,
  onModelChange,
}: AiBriefPanelProps) {
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
              Describe your page
            </h3>
            <p className="mt-1 text-[11px] fg-faint leading-relaxed">
              Tell me what you want — I&apos;ll compose the page for you.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {QUICK_PROMPTS.map((p) => (
              <button
                key={p.label}
                type="button"
                disabled={generating}
                onClick={() => state.setPrompt(p.prompt)}
                className="text-left text-[11.5px] fg leading-tight px-2.5 py-2 rounded-md ring-1 ring-[color:var(--border)] bg-[color:var(--bg)] hover:bg-hover hover:ring-[color:var(--border-strong)] transition disabled:opacity-50"
              >
                {p.label}
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
            placeholder="A landing page for my SaaS that…"
            maxLength={2000}
            className="block w-full bg-transparent text-[12.5px] leading-relaxed px-3 pt-2.5 pb-1 fg placeholder:fg-faint focus:outline-none resize-none disabled:opacity-60"
            style={{ minHeight: 32 }}
          />
          <div className="flex items-center justify-between px-1.5 pb-1.5 pt-0.5">
            <div className="flex items-center gap-0.5">
              {/* Same icon row as ChatPanel, intentionally disabled until
                  the project exists. Gives the user a preview of the
                  editing affordances that unlock after generation. */}
              <button
                type="button"
                disabled
                aria-label="Attach an image — available after generation"
                title="Available once your project is created"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md fg-faint opacity-40 cursor-not-allowed"
              >
                <ImageIcon size={13} />
              </button>
              <button
                type="button"
                disabled
                aria-label="Scope to a section — available after generation"
                title="Available once your project is created"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md fg-faint opacity-40 cursor-not-allowed"
              >
                <Crosshair size={13} />
              </button>
              <button
                type="button"
                disabled
                aria-label="Autofill with my info — available after generation"
                title="Available once your project is created"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md fg-faint opacity-40 cursor-not-allowed"
              >
                <Wand size={13} />
              </button>
              <ModelPicker
                model={model}
                onChange={onModelChange}
                disabled={generating}
              />
            </div>
            <button
              type="button"
              onClick={onGenerate}
              disabled={!canGenerate}
              className={`inline-flex items-center justify-center gap-1 h-7 rounded-md text-[11.5px] font-medium transition ${
                canGenerate
                  ? "px-2.5 bg-[var(--accent)] text-white shadow-coral hover:brightness-105"
                  : "w-7 bg-hover fg-faint cursor-not-allowed"
              }`}
            >
              {generating ? (
                <Loader size={12} className="animate-spin" />
              ) : canGenerate ? (
                <>
                  <SendUp size={12} /> <span>Generate</span>
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
