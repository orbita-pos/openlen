// Section library gallery — curated, re-themeable HTML fragments grouped by
// section type. Clicking "Insert" drops the section into the CURRENT project
// (via the iframe section-insert message) — unlike the templates gallery,
// which clones a whole new project. The section arrives host-safe (scoped at
// ingest) and adopts the page's look on a later re-theme pass (F3).

"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Eye, Sparkles } from "../icons";
import { TemplatePreviewFrame } from "../template-preview-frame";
import {
  SECTION_TYPES_ORDERED,
  type SectionSpec,
  type SectionType,
} from "../sections-data";
import { useSections } from "../use-sections";

interface SectionsPanelProps {
  /** Open the preview dialog for this section. The match-then-insert commit
   *  happens from inside the dialog ("Use on my page"). */
  onPreview: (s: SectionSpec) => void;
}

function SectionCard({
  section,
  onPreview,
}: {
  section: SectionSpec;
  onPreview: (s: SectionSpec) => void;
}) {
  const t = useTranslations("panelsA");
  return (
    <button
      type="button"
      onClick={() => onPreview(section)}
      aria-label={t("sections.previewAria", { name: section.name })}
      className="group relative block w-full text-left rounded-lg overflow-hidden ring-1 ring-[color:var(--border)] hover:ring-[color:var(--border-strong)] transition-all duration-200 cursor-pointer"
      style={{ background: "var(--bg)" }}
    >
      <div className="pointer-events-none">
        <TemplatePreviewFrame
          url={section.previewUrl}
          name={section.variantLabel}
          nativeHeight={620}
        />
      </div>

      <div className="px-3 pt-2.5 pb-3 border-t bd">
        <div className="flex items-baseline justify-between gap-2 mb-1.5">
          <h3 className="text-[13px] font-semibold fg leading-tight tracking-tight truncate">
            {section.variantLabel}
          </h3>
          <div className="flex items-center gap-1 shrink-0">
            {section.needsJs && (
              <span
                className="text-[8.5px] uppercase tracking-[0.12em] px-1 py-0.5 rounded fg-faint bg-hover font-semibold"
                title={t("sections.jsTooltip")}
              >
                JS
              </span>
            )}
            {section.hasPlaceholders && (
              <span
                className="text-[8.5px] uppercase tracking-[0.12em] px-1 py-0.5 rounded fg-faint bg-hover font-semibold"
                title={t("sections.imgTooltip")}
              >
                IMG
              </span>
            )}
          </div>
        </div>

        <span className="w-full inline-flex items-center justify-center gap-1.5 text-[11px] font-medium h-7 rounded-md fg bg-hover group-hover:bg-app group-hover:fg transition">
          <Eye size={12} />
          {t("sections.preview")}
        </span>
      </div>
    </button>
  );
}

export function SectionsPanel({ onPreview }: SectionsPanelProps) {
  const t = useTranslations("panelsA");
  const ts = useTranslations("sections");
  const [typeFilter, setTypeFilter] = useState<SectionType | "all">("all");
  const { sections, byType, isLoading, error } = useSections();

  const visibleTypes = SECTION_TYPES_ORDERED.filter(
    (t) => typeFilter === "all" || typeFilter === t,
  );

  return (
    <div className="overflow-y-auto nice-scroll h-full px-3 py-3">
      <div className="flex items-center gap-2 mb-2">
        <Sparkles size={13} className="text-accent" />
        <h2 className="text-[11px] uppercase tracking-[0.16em] fg-faint font-semibold ui-small">
          {t("sections.heading")}
        </h2>
      </div>
      <p className="text-[11px] fg-muted leading-snug mb-3">
        {t("sections.intro")}
      </p>

      <div className="flex flex-wrap gap-1 mb-4">
        <button
          type="button"
          onClick={() => setTypeFilter("all")}
          className={`text-[10.5px] px-2.5 py-1 rounded-md transition font-medium ${
            typeFilter === "all"
              ? "bg-[var(--accent-strong)] text-white"
              : "fg-muted bg-hover hover:fg"
          }`}
        >
          {t("sections.all")}
          {sections.length > 0 ? ` ${sections.length}` : ""}
        </button>
        {SECTION_TYPES_ORDERED.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTypeFilter(t)}
            className={`text-[10.5px] px-2.5 py-1 rounded-md transition font-medium ${
              typeFilter === t
                ? "bg-[var(--accent-strong)] text-white"
                : "fg-muted bg-hover hover:fg"
            }`}
          >
            {ts(t)}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-3 px-2.5 py-2 rounded-md ring-1 ring-rose-300/60 dark:ring-rose-500/30 bg-rose-50 dark:bg-rose-500/5 text-[11px] text-rose-700 dark:text-rose-300">
          {t("sections.loadError", { error })}
        </div>
      )}

      {isLoading &&
        Array.from({ length: 3 }).map((_, i) => (
          <div
            key={`skel-${i}`}
            className="mb-3 h-40 rounded-lg ring-1 ring-[color:var(--border)] animate-pulse"
            style={{ background: "var(--bg-elev)" }}
          />
        ))}

      {!isLoading &&
        visibleTypes.map((type) => {
          const ofType = byType(type);
          if (ofType.length === 0) return null;
          return (
            <section key={type} className="mb-5 last:mb-2">
              <div className="mb-3 mt-1 first:mt-0 flex items-baseline justify-between gap-2">
                <h3 className="text-[10.5px] uppercase tracking-[0.18em] fg font-semibold ui-small">
                  {ts(type)}
                </h3>
                <span className="text-[10px] fg-faint tabular-nums">
                  {ofType.length}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-3">
                {ofType.map((s) => (
                  <SectionCard key={s.id} section={s} onPreview={onPreview} />
                ))}
              </div>
            </section>
          );
        })}

      <div className="mt-4 px-1 text-[10px] fg-faint leading-relaxed">
        {t("sections.footer")}
      </div>
    </div>
  );
}
