// Section library gallery — curated, re-themeable HTML fragments grouped by
// section type. Clicking "Insert" drops the section into the CURRENT project
// (via the iframe section-insert message) — unlike the templates gallery,
// which clones a whole new project. The section arrives host-safe (scoped at
// ingest) and adopts the page's look on a later re-theme pass (F3).

"use client";

import { useState } from "react";
import { ChevronRight, Sparkles } from "../icons";
import { TemplatePreviewFrame } from "../template-preview-frame";
import {
  SECTION_TYPE_META,
  SECTION_TYPES_ORDERED,
  type SectionSpec,
  type SectionType,
} from "../sections-data";
import { useSections } from "../use-sections";

interface SectionsPanelProps {
  /** Insert this section into the current project. */
  onInsert: (s: SectionSpec) => void;
  /** Id currently being inserted (shows a pending state on the card). */
  insertingId?: string | null;
}

function SectionCard({
  section,
  onInsert,
  inserting,
}: {
  section: SectionSpec;
  onInsert: (s: SectionSpec) => void;
  inserting: boolean;
}) {
  return (
    <div
      className="group relative w-full rounded-lg overflow-hidden ring-1 ring-[color:var(--border)] hover:ring-[color:var(--border-strong)] transition-all duration-200"
      style={{ background: "var(--bg)" }}
    >
      <TemplatePreviewFrame
        url={section.previewUrl}
        name={section.variantLabel}
        nativeHeight={620}
      />

      <div className="px-3 pt-2.5 pb-3 border-t bd">
        <div className="flex items-baseline justify-between gap-2 mb-1">
          <h3 className="text-[13px] font-semibold fg leading-tight tracking-tight truncate">
            {section.variantLabel}
          </h3>
          <div className="flex items-center gap-1 shrink-0">
            {section.needsJs && (
              <span
                className="text-[8.5px] uppercase tracking-[0.12em] px-1 py-0.5 rounded fg-faint bg-hover font-semibold"
                title="Renders content via JS — preserved on insert, limited inline-edit"
              >
                JS
              </span>
            )}
            {section.hasPlaceholders && (
              <span
                className="text-[8.5px] uppercase tracking-[0.12em] px-1 py-0.5 rounded fg-faint bg-hover font-semibold"
                title="Ships gradient placeholders — swap real images after insert"
              >
                IMG
              </span>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={() => onInsert(section)}
          disabled={inserting}
          aria-label={`Insert ${section.name} into the current page`}
          className="mt-1 w-full inline-flex items-center justify-center gap-1.5 text-[11px] font-medium h-7 rounded-md text-white transition disabled:opacity-60"
          style={{ background: "var(--accent)" }}
        >
          {inserting ? "Inserting…" : "Insert"}
          {!inserting && <ChevronRight size={11} stroke={2.5} />}
        </button>
      </div>
    </div>
  );
}

export function SectionsPanel({ onInsert, insertingId }: SectionsPanelProps) {
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
          Section library
        </h2>
      </div>
      <p className="text-[11px] fg-muted leading-snug mb-3">
        Insert a section into your current page. It drops in at the bottom —
        drag it into place with the section handles. The look adapts to your
        page on the next restyle.
      </p>

      <div className="flex flex-wrap gap-1 mb-4">
        <button
          type="button"
          onClick={() => setTypeFilter("all")}
          className={`text-[10.5px] px-2.5 py-1 rounded-md transition font-medium ${
            typeFilter === "all"
              ? "bg-[var(--accent)] text-white"
              : "fg-muted bg-hover hover:fg"
          }`}
        >
          All{sections.length > 0 ? ` ${sections.length}` : ""}
        </button>
        {SECTION_TYPES_ORDERED.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTypeFilter(t)}
            className={`text-[10.5px] px-2.5 py-1 rounded-md transition font-medium ${
              typeFilter === t
                ? "bg-[var(--accent)] text-white"
                : "fg-muted bg-hover hover:fg"
            }`}
          >
            {SECTION_TYPE_META[t].label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-3 px-2.5 py-2 rounded-md ring-1 ring-rose-300/60 dark:ring-rose-500/30 bg-rose-50 dark:bg-rose-500/5 text-[11px] text-rose-700 dark:text-rose-300">
          Failed to load sections — {error}
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
                  {SECTION_TYPE_META[type].label}
                </h3>
                <span className="text-[10px] fg-faint tabular-nums">
                  {ofType.length}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-3">
                {ofType.map((s) => (
                  <SectionCard
                    key={s.id}
                    section={s}
                    onInsert={onInsert}
                    inserting={insertingId === s.id}
                  />
                ))}
              </div>
            </section>
          );
        })}

      <div className="mt-4 px-1 text-[10px] fg-faint leading-relaxed">
        Sections are scoped fragments — their styles can&apos;t clash with your
        page. Insert, then reorder and restyle to taste.
      </div>
    </div>
  );
}
