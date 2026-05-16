"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { cn } from "@/lib/cn";

export interface EditPromptModalProps {
  sectionName: string;
  onCancel: () => void;
  onApply: (instruction: string) => void;
}

// Centered modal for the per-section "Edit prompt" action. Reuses the
// regenerate-section pipeline under the hood — passes its text as the
// `additionalInstruction` so the copy step rewrites the section accordingly.
export function EditPromptModal({
  sectionName,
  onCancel,
  onApply,
}: EditPromptModalProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (value.trim()) onApply(value.trim());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [value, onApply, onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-[#0a0a0a] ring-1 ring-zinc-200 dark:ring-zinc-800 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-zinc-100 dark:border-zinc-900">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-coral-50 dark:bg-coral-500/10 text-coral-600 dark:text-coral-400">
              <Sparkles size={13} />
            </span>
            <div className="min-w-0">
              <div className="text-[14px] font-semibold tracking-tight truncate">
                Edit {sectionName}
              </div>
              <div className="text-[11px] text-zinc-500 truncate">
                Tell us how to rewrite this section
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition"
          >
            <X size={14} />
          </button>
        </div>
        <div className="p-5">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder='e.g. "Make the headline more punchy" or "Add a third pricing tier called Studio at $199/mo"'
            rows={5}
            className="w-full resize-none rounded-lg bg-zinc-50 dark:bg-zinc-900 ring-1 ring-zinc-200 dark:ring-zinc-800 px-3 py-2.5 text-[13px] text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-coral-500/40 transition"
          />
          <div className="mt-3 text-[11px] text-zinc-500">
            Costs ~$0.02 and takes about 10 seconds. Existing images stay.
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-zinc-100 dark:border-zinc-900 bg-zinc-50/60 dark:bg-zinc-900/40">
          <button
            type="button"
            onClick={onCancel}
            className="h-8 px-3 rounded-md text-[12px] font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!value.trim()}
            onClick={() => onApply(value.trim())}
            className={cn(
              "inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[12px] font-medium transition",
              value.trim()
                ? "bg-coral-500 text-white hover:bg-coral-600 active:bg-coral-700 btn-coral-shadow"
                : "bg-zinc-200 dark:bg-zinc-800 text-zinc-400 cursor-not-allowed",
            )}
          >
            <Sparkles size={11} />
            Apply
            <kbd className="ml-1 inline-flex items-center gap-0.5 text-[10px] opacity-80">
              ⌘↵
            </kbd>
          </button>
        </div>
      </div>
    </div>
  );
}
