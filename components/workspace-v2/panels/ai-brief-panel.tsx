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
  Crosshair,
  ImageIcon,
  Loader,
  Pencil,
  SendUp,
  Sparkles,
  Wand,
  Zap,
} from "../icons";
import type { BriefFormState } from "@/components/workspace/types";
import { QUICK_PROMPTS } from "@/lib/quick-prompts";

export interface AiBriefPanelProps {
  state: BriefFormState;
  onGenerate: () => void;
  generating: boolean;
  /** "quick" = curated (free), "scratch" = bespoke from-scratch (Pro). */
  mode: "quick" | "scratch";
  onModeChange: (m: "quick" | "scratch") => void;
  /** Saved business profiles for the "Mi negocio" picker (curation only). */
  profiles?: { id: string; name: string }[];
  selectedProfileId?: string | null;
  onSelectProfile?: (id: string | null) => void;
  onManageProfiles?: () => void;
}

export function AiBriefPanel({
  state,
  onGenerate,
  generating,
  mode,
  onModeChange,
  profiles = [],
  selectedProfileId = null,
  onSelectProfile,
  onManageProfiles,
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
        {mode === "quick" && (
          <ProfilePicker
            profiles={profiles}
            selectedId={selectedProfileId}
            onSelect={onSelectProfile ?? (() => {})}
            onManage={onManageProfiles ?? (() => {})}
            disabled={generating}
          />
        )}
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
                aria-label={t("aiBrief.attachImage")}
                title={t("aiBrief.availableAfter")}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md fg-faint opacity-40 cursor-not-allowed"
              >
                <ImageIcon size={13} />
              </button>
              <button
                type="button"
                disabled
                aria-label={t("aiBrief.scopeSection")}
                title={t("aiBrief.availableAfter")}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md fg-faint opacity-40 cursor-not-allowed"
              >
                <Crosshair size={13} />
              </button>
              <button
                type="button"
                disabled
                aria-label={t("aiBrief.autofill")}
                title={t("aiBrief.availableAfter")}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md fg-faint opacity-40 cursor-not-allowed"
              >
                <Wand size={13} />
              </button>
              {/* Mode select — a compact dropdown (like the old model picker)
                  so the two mode names don't crowd the row. */}
              <ModeSelect
                mode={mode}
                onModeChange={onModeChange}
                disabled={generating}
              />
            </div>
            <button
              type="button"
              onClick={onGenerate}
              disabled={!canGenerate}
              aria-label={t("aiBrief.generate")}
              className={`inline-flex items-center justify-center gap-1 h-7 rounded-md text-[11.5px] font-medium transition ${
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

// Mode select — the curated/bespoke chooser, styled as a compact dropdown
// (the same pattern as the old model picker) so its two option names live in
// the popover instead of crowding the composer row.
function ModeSelect({
  mode,
  onModeChange,
  disabled,
}: {
  mode: "quick" | "scratch";
  onModeChange: (m: "quick" | "scratch") => void;
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
    { value: "quick" as const, icon: <Zap size={12} />, label: t("aiBrief.modeQuick"), pro: false },
    { value: "scratch" as const, icon: <Pencil size={12} />, label: t("aiBrief.modeScratch"), pro: true },
  ];
  const current = OPTIONS.find((o) => o.value === mode) ?? OPTIONS[0];

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
        {current.pro && (
          <span className="text-[8px] font-semibold uppercase tracking-wide text-accent">
            Pro
          </span>
        )}
        <ChevronUp size={10} className={open ? "rotate-180" : ""} />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 mb-1.5 w-44 rounded-lg border bd bg-elev shadow-card p-1 z-30">
          {OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                onModeChange(o.value);
                setOpen(false);
              }}
              className={`w-full inline-flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[11.5px] transition ${
                o.value === mode ? "bg-accent-soft text-accent" : "fg hover:bg-hover"
              }`}
            >
              {o.icon}
              <span>{o.label}</span>
              {o.pro && (
                <span className="ml-auto text-[8.5px] font-semibold uppercase tracking-wide text-accent">
                  Pro
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// "Mi negocio" picker — seeds the curation flow from a saved profile. Hidden in
// bespoke mode. With no profiles it's a single "add" link; with one or more it's
// a dropdown (+ "new business"). "None" = let the AI invent the copy.
function ProfilePicker({
  profiles,
  selectedId,
  onSelect,
  onManage,
  disabled,
}: {
  profiles: { id: string; name: string }[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onManage: () => void;
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

  if (profiles.length === 0) {
    return (
      <button
        type="button"
        onClick={onManage}
        disabled={disabled}
        className="mb-2 inline-flex items-center gap-1.5 text-[11px] fg-muted hover:fg transition disabled:opacity-40"
      >
        <Sparkles size={11} /> {t("profilePicker.add")}
      </button>
    );
  }

  const selected = profiles.find((p) => p.id === selectedId) ?? null;
  return (
    <div className="mb-2 flex items-center gap-1.5 text-[11px]" ref={ref}>
      <span className="fg-faint">{t("profilePicker.for")}</span>
      <div className="relative">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen((o) => !o)}
          className="inline-flex items-center gap-1 h-6 px-2 rounded-md fg hover:bg-hover ring-1 ring-[color:var(--border)] transition disabled:opacity-40"
        >
          <span className="max-w-[140px] truncate">
            {selected ? selected.name : t("profilePicker.none")}
          </span>
          <ChevronUp size={9} className={open ? "rotate-180" : ""} />
        </button>
        {open && (
          <div className="absolute bottom-full left-0 mb-1 w-48 rounded-lg border bd bg-elev shadow-card p-1 z-30">
            <PickItem
              active={selectedId === null}
              label={t("profilePicker.none")}
              onClick={() => {
                onSelect(null);
                setOpen(false);
              }}
            />
            {profiles.map((p) => (
              <PickItem
                key={p.id}
                active={selectedId === p.id}
                label={p.name}
                onClick={() => {
                  onSelect(p.id);
                  setOpen(false);
                }}
              />
            ))}
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onManage();
              }}
              className="w-full text-left px-2 py-1.5 rounded-md text-[11.5px] text-accent hover:bg-hover transition"
            >
              + {t("profilePicker.new")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function PickItem({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-2 py-1.5 rounded-md text-[11.5px] truncate transition ${
        active ? "bg-accent-soft text-accent" : "fg hover:bg-hover"
      }`}
    >
      {label}
    </button>
  );
}
