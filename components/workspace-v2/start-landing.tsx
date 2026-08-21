// Start landing — the center surface a first-time user sees at a bare /new
// (no project yet). It leads with the can't-fail CATALOG (a mosaic of verified
// templates, $0, one click) while keeping the AI brief visible as the hero
// input — "catalog-first, AI not buried". Picking a template previews it in
// place (same flow as the sidebar gallery); typing + generate runs the normal
// AI flow. No new machinery — this just composes the pieces that already exist.

"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { BriefFormState } from "@/components/workspace/types";
import { type PageEffort } from "./panels/ai-brief-panel";
import { TemplatePreviewFrame } from "./template-preview-frame";
import { useTemplates } from "./use-templates";
import {
  TEMPLATE_FAMILIES,
  type TemplateFamily,
  type TemplateSpec,
} from "./templates-data";
import { Loader, Search, SendUp } from "./icons";
import { ReferenceField } from "./reference-field";

export interface StartLandingProps {
  /** The shared AI brief form state ({ prompt, setPrompt }). */
  aiState: BriefFormState;
  onGenerate: () => void;
  generating: boolean;
  /** Cuánto trabajo se pone en la página; hoy sólo `low` está vivo. */
  effort: PageEffort;
  onEffortChange: (effort: PageEffort) => void;
  /** Preview a template in the main area (it clones on commit). */
  onPreviewTemplate: (t: TemplateSpec) => void;
  /** Switch to the paste-HTML entry flow. */
  onPaste: () => void;
}

export function StartLanding({
  aiState,
  onGenerate,
  generating,
  effort,
  onEffortChange,
  onPreviewTemplate,
  onPaste,
}: StartLandingProps) {
  const tw = useTranslations("wsChrome");
  const tp = useTranslations("panelsA");
  const tf = useTranslations("families");

  const { templates, isLoading, error } = useTemplates();
  const [familyFilter, setFamilyFilter] = useState<TemplateFamily | "all">(
    "all",
  );
  const [familiesExpanded, setFamiliesExpanded] = useState(false);
  const [query, setQuery] = useState("");

  // Only surface family chips that actually have templates — a dead chip on
  // the home screen reads as a broken filter.
  const familyCounts = useMemo(() => {
    const m = new Map<TemplateFamily, number>();
    for (const tpl of templates) m.set(tpl.family, (m.get(tpl.family) ?? 0) + 1);
    return m;
  }, [templates]);
  const availableFamilies = useMemo(
    () => TEMPLATE_FAMILIES.filter((f) => (familyCounts.get(f.id) ?? 0) > 0),
    [familyCounts],
  );
  const shownChips = familiesExpanded
    ? availableFamilies
    : availableFamilies.filter((f, i) => i < 10 || f.id === familyFilter);
  const hiddenCount = availableFamilies.length - shownChips.length;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = templates.filter((tpl) => {
      if (familyFilter !== "all" && tpl.family !== familyFilter) return false;
      if (!q) return true;
      return `${tpl.name} ${tpl.pitch} ${tpl.family}`
        .toLowerCase()
        .includes(q);
    });
    // Featured ("popular") templates lead the wall — the verified hero picks
    // a creator should see first. Stable otherwise, so server order is kept.
    return list.sort((a, b) => Number(b.featured) - Number(a.featured));
  }, [templates, familyFilter, query]);

  return (
    <section className="flex-1 min-w-0 min-h-0 overflow-y-auto nice-scroll bg-app">
      <div className="mx-auto max-w-5xl px-6 py-10 sm:py-12">
        {/* Hero copy */}
        <div className="text-center mb-6">
          <h2 className="text-[26px] sm:text-[31px] font-semibold fg tracking-tight leading-tight">
            {tw("start.headline")}
          </h2>
          <p className="mt-2.5 text-[13px] fg-muted leading-relaxed max-w-md mx-auto">
            {tw("start.subtitle")}
          </p>
        </div>

        {/* AI brief — the hero input (visible, not buried) */}
        <div className="max-w-2xl mx-auto">
          <HeroComposer
            state={aiState}
            onGenerate={onGenerate}
            generating={generating}
            effort={effort}
            onEffortChange={onEffortChange}
          />
          <div className="mt-2.5 text-center">
            <button
              type="button"
              onClick={onPaste}
              className="text-[11.5px] fg-faint hover:fg transition px-2.5 py-1 rounded-md hover:bg-hover"
            >
              {tw("start.pasteHtml")}
            </button>
          </div>
        </div>

        {/* Gallery heading + search */}
        <div className="mt-10 mb-4 flex items-center gap-3 flex-wrap">
          <h3 className="text-[12px] uppercase tracking-[0.16em] fg-faint font-semibold shrink-0">
            {tw("start.galleryHeading")}
          </h3>
          <div className="h-px bg-[color:var(--border)] flex-1 min-w-[40px]" />
          <div className="relative shrink-0">
            <Search
              size={13}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 fg-faint pointer-events-none"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tw("start.search")}
              aria-label={tw("start.search")}
              className="w-44 sm:w-56 h-8 pl-8 pr-2.5 rounded-md text-[12px] bg-elev border bd fg placeholder:fg-faint focus:outline-none focus:border-[color:var(--accent)] focus:ring-1 focus:ring-[color:var(--accent-ring)]/30 transition"
            />
          </div>
        </div>

        {/* Family chips */}
        {!isLoading && availableFamilies.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-5">
            <FamilyChip
              active={familyFilter === "all"}
              onClick={() => setFamilyFilter("all")}
            >
              {tp("templates.all")}
              {templates.length > 0 ? ` ${templates.length}` : ""}
            </FamilyChip>
            {shownChips.map((f) => (
              <FamilyChip
                key={f.id}
                active={familyFilter === f.id}
                onClick={() => setFamilyFilter(f.id)}
              >
                {tf(`${f.id}.label`)}
              </FamilyChip>
            ))}
            {hiddenCount > 0 ? (
              <button
                type="button"
                onClick={() => setFamiliesExpanded(true)}
                className="text-[10.5px] px-2.5 py-1 rounded-md transition font-medium text-accent bg-hover hover:fg"
              >
                {tp("templates.moreFamilies", { count: hiddenCount })}
              </button>
            ) : familiesExpanded ? (
              <button
                type="button"
                onClick={() => setFamiliesExpanded(false)}
                className="text-[10.5px] px-2.5 py-1 rounded-md transition font-medium fg-muted bg-hover hover:fg"
              >
                {tp("templates.fewerFamilies")}
              </button>
            ) : null}
          </div>
        )}

        {error && (
          <div className="mb-4 px-3 py-2 rounded-md ring-1 ring-rose-300/60 dark:ring-rose-500/30 bg-rose-50 dark:bg-rose-500/5 text-[11.5px] text-rose-700 dark:text-rose-300">
            {tp("templates.loadError", { error })}
          </div>
        )}

        {/* Mosaic */}
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          {isLoading &&
            Array.from({ length: 6 }).map((_, i) => (
              <div
                key={`skel-${i}`}
                className="rounded-lg ring-1 ring-[color:var(--border)] animate-pulse"
                style={{ aspectRatio: "16 / 11", background: "var(--bg-elev)" }}
              />
            ))}
          {!isLoading &&
            filtered.map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                onClick={() => onPreviewTemplate(tpl)}
                aria-label={tpl.name}
                className="group text-left rounded-lg overflow-hidden ring-1 ring-[color:var(--border)] hover:ring-[color:var(--border-strong)] hover:-translate-y-px hover:shadow-card transition-all duration-200"
                style={{ background: "var(--bg)" }}
              >
                <TemplatePreviewFrame
                  url={tpl.previewUrl}
                  name={tpl.name}
                  imageUrl={tpl.imageUrl}
                />
                <div className="px-3 py-2 border-t bd flex items-center justify-between gap-2">
                  <span className="text-[12px] font-semibold fg truncate">
                    {tpl.name}
                  </span>
                  <span className="text-[10px] fg-faint shrink-0 truncate max-w-[45%] text-right">
                    {tf(`${tpl.family}.label`)}
                  </span>
                </div>
              </button>
            ))}
        </div>

        {!isLoading && filtered.length === 0 && !error && (
          <div className="text-center py-12 text-[12.5px] fg-faint">
            {tw("start.noResults", { query })}
          </div>
        )}
      </div>
    </section>
  );
}

function FamilyChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-[10.5px] px-2.5 py-1 rounded-md transition font-medium ${
        active
          ? "bg-[var(--accent-strong)] text-white"
          : "fg-muted bg-hover hover:fg"
      }`}
    >
      {children}
    </button>
  );
}

// The centered AI composer. Mirrors the sidebar AiBriefPanel composer (auto-grow
// textarea + Enter-to-send + the shared EffortSelect) at a larger, hero size.
function HeroComposer({
  state,
  onGenerate,
  generating,
  effort,
  onEffortChange,
}: {
  state: BriefFormState;
  onGenerate: () => void;
  generating: boolean;
  effort: PageEffort;
  onEffortChange: (effort: PageEffort) => void;
}) {
  const t = useTranslations("panelsA");
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [state.prompt]);

  const canGenerate = state.prompt.trim().length >= 10 && !generating;

  return (
    <div className="rounded-2xl border bd bg-elev shadow-card focus-within:border-[color:var(--accent)] focus-within:ring-1 focus-within:ring-[color:var(--accent-ring)]/30 transition">
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
        rows={2}
        disabled={generating}
        placeholder={t("aiBrief.placeholder")}
        maxLength={2000}
        className="block w-full bg-transparent text-[13.5px] leading-relaxed px-4 pt-3.5 pb-1 fg placeholder:fg-faint focus:outline-none resize-none nice-scroll disabled:opacity-60"
        style={{ minHeight: 56 }}
      />
      <div className="flex items-center justify-between px-2.5 pb-2.5 pt-1">
        {/* El dial está aparcado mientras la puerta es /api/generate: ahí no
            compra nada todavía, y un selector que no compra nada es la mentira
            que se arregló en page-effort.ts. Su hueco lo ocupa ahora la
            referencia visual, que sí compra algo: la dirección de una web que
            al usuario le gusta. Se ve y se quita antes de generar. */}
        <ReferenceField
          reference={state.reference}
          onChange={state.setReference}
          disabled={generating}
        />
        <button
          type="button"
          onClick={onGenerate}
          disabled={!canGenerate}
          aria-label={t("aiBrief.generate")}
          className={`inline-flex shrink-0 items-center justify-center gap-1.5 h-9 rounded-lg text-[12.5px] font-medium transition ${
            canGenerate
              ? "px-4 bg-[var(--accent-strong)] text-white shadow-coral hover:brightness-105"
              : "w-9 bg-hover fg-faint cursor-not-allowed"
          }`}
        >
          {generating ? (
            <Loader size={14} className="animate-spin" />
          ) : canGenerate ? (
            <>
              <SendUp size={13} /> <span>{t("aiBrief.generate")}</span>
            </>
          ) : (
            <SendUp size={14} />
          )}
        </button>
      </div>
    </div>
  );
}
