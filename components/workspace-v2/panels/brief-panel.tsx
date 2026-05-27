// Brief mode panel — per-project AI context. A single textarea whose
// contents get auto-prepended to every Chat tab prompt sent to Gemini
// (see `/api/templates/ai-design`). Mirrors Claude.ai's "Project
// instructions" pattern: persistent, AI-aware context that travels across
// chat turns instead of having to be re-typed each time.
//
// UX: autosave on debounce (700ms) — no Save button. Save indicator at the
// bottom mirrors the inline-edit pattern. Character count to make the
// 4000-char server cap visible.

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { HistoryIcon, Sparkles } from "../icons";

interface BriefPanelProps {
  /** Project the user is currently viewing. Null = no project loaded —
   *  panel surfaces an empty state pointing the user at Pages. */
  currentProjectId?: string | null;
  /** Server-loaded initial value. Updated by the parent when the project
   *  reloads (e.g. after a route change). Re-syncs the local draft when
   *  the project changes underneath us. */
  initialBrief?: string;
  /** Called after a successful PATCH so the parent can mirror the new
   *  value into `loadedProject.userBrief` (so unmount/remount picks it
   *  up without an extra fetch). */
  onSaved?: (brief: string) => void;
}

const MAX_LEN = 4000;
const SAVE_DEBOUNCE_MS = 700;

type SaveState = "idle" | "saving" | "saved" | "error";

export function BriefPanel({
  currentProjectId,
  initialBrief = "",
  onSaved,
}: BriefPanelProps) {
  const [draft, setDraft] = useState(initialBrief);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [errorText, setErrorText] = useState<string | null>(null);

  // Re-sync the draft when the project (or its server-side value) changes.
  // Keep a ref of the last-server-value so we don't blow away in-flight edits
  // every time the parent re-renders.
  const lastServerValueRef = useRef(initialBrief);
  useEffect(() => {
    if (initialBrief !== lastServerValueRef.current) {
      lastServerValueRef.current = initialBrief;
      setDraft(initialBrief);
      setSaveState("idle");
    }
  }, [initialBrief, currentProjectId]);

  const timerRef = useRef<number | null>(null);
  const inflightRef = useRef<AbortController | null>(null);

  const save = useCallback(
    async (value: string) => {
      if (!currentProjectId) return;
      inflightRef.current?.abort();
      const abort = new AbortController();
      inflightRef.current = abort;
      setSaveState("saving");
      setErrorText(null);
      try {
        const res = await fetch(`/api/projects/${currentProjectId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userBrief: value }),
          signal: abort.signal,
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        lastServerValueRef.current = value;
        setSaveState("saved");
        onSaved?.(value);
      } catch (err) {
        if (abort.signal.aborted) return;
        setSaveState("error");
        setErrorText(
          err instanceof Error ? err.message : "Couldn't save — try again.",
        );
      } finally {
        if (inflightRef.current === abort) inflightRef.current = null;
      }
    },
    [currentProjectId, onSaved],
  );

  // Debounced save on every keystroke once the project is loaded.
  useEffect(() => {
    if (!currentProjectId) return;
    if (draft === lastServerValueRef.current) return;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void save(draft);
    }, SAVE_DEBOUNCE_MS);
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [draft, currentProjectId, save]);

  // Cleanup on unmount — flush any pending save, cancel in-flight.
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      inflightRef.current?.abort();
    };
  }, []);

  if (!currentProjectId) {
    return (
      <div className="h-full flex items-center justify-center px-6 py-8 text-center">
        <div className="max-w-[220px]">
          <div className="mx-auto mb-3 inline-flex h-9 w-9 items-center justify-center rounded-md ring-1 ring-[color:var(--border)] bg-elev fg-faint">
            <HistoryIcon size={14} />
          </div>
          <p className="text-[11.5px] fg-muted leading-relaxed">
            The Brief lives per project.
          </p>
          <p className="mt-1.5 text-[10.5px] fg-faint leading-relaxed">
            Open a project from the Pages tab to write its brief.
          </p>
        </div>
      </div>
    );
  }

  const remaining = MAX_LEN - draft.length;

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 pt-3 pb-2 shrink-0">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] fg-faint font-semibold ui-small">
          <Sparkles size={11} className="text-accent" />
          <span>Brief</span>
        </div>
        <div className="text-[11px] fg-faint mt-0.5 leading-relaxed">
          Persistent context the AI sees on every chat. Brand, voice,
          constraints, reminders.
        </div>
      </div>
      <div className="flex-1 min-h-0 px-3 pb-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, MAX_LEN))}
          spellCheck={false}
          placeholder={`e.g.\n\n- This is a landing for Counter, a coffee shop in Polanco.\n- Voice: warm, friendly, no tech jargon.\n- Accent: warm orange (#C66B3D).\n- Pendiente: pedir el logo final al diseñador.`}
          className="w-full h-full resize-none rounded-md ring-1 ring-[color:var(--border)] bg-[color:var(--bg)] fg placeholder:fg-faint text-[12px] leading-relaxed px-3 py-2.5 focus:outline-none focus:ring-[color:var(--border-strong)] nice-scroll"
        />
      </div>
      <div className="shrink-0 px-3 py-2 border-t bd flex items-center justify-between text-[10.5px] fg-faint ui-small">
        <SaveIndicator state={saveState} errorText={errorText} />
        <span
          className={
            remaining < 200
              ? remaining < 0
                ? "text-red-600 dark:text-red-400 tabular"
                : "text-amber-600 dark:text-amber-400 tabular"
              : "tabular"
          }
        >
          {draft.length} / {MAX_LEN}
        </span>
      </div>
    </div>
  );
}

function SaveIndicator({
  state,
  errorText,
}: {
  state: SaveState;
  errorText: string | null;
}) {
  if (state === "saving") {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] pulse-soft" />
        <span>Saving…</span>
      </span>
    );
  }
  if (state === "saved") {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        <span>Saved · injected on every chat</span>
      </span>
    );
  }
  if (state === "error") {
    return (
      <span className="inline-flex items-center gap-1.5 text-red-600 dark:text-red-400">
        <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
        <span>{errorText ?? "Save failed"}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--border-strong)]" />
      <span>Ready</span>
    </span>
  );
}
