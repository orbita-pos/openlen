"use client";

// THE TEMPLATE GALLERY — the can't-fail catalog (a mosaic of verified templates, $0, one click). It lived under the box
// of /new's start screen until 06/11; since that screen is the home's (only the question and the box, like Gemini), it
// has its own place: «Plantillas» in the start rail opens it in the template flow (`/new?mode=template`), and picking
// one previews it there with «Usar plantilla» (`handleUseTemplate`, `app/[locale]/new/page.tsx`).

import { useMemo, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { TemplatePreviewFrame } from "./template-preview-frame";
import { useTemplates } from "./use-templates";
import { TEMPLATE_FAMILIES, type TemplateFamily, type TemplateSpec } from "./templates-data";
import { Search } from "./icons";
import { registrarUso } from "@/lib/uso/cliente";

export function TemplateGallery({ onPreviewTemplate }: { onPreviewTemplate: (t: TemplateSpec) => void }) {
  const tw = useTranslations("wsChrome");
  const tp = useTranslations("panelsA");
  const tf = useTranslations("families");
  const { templates, isLoading, error } = useTemplates();
  const [familyFilter, setFamilyFilter] = useState<TemplateFamily | "all">("all");
  const [familiesExpanded, setFamiliesExpanded] = useState(false);
  const [query, setQuery] = useState("");

  // Only surface family chips that actually have templates — a dead chip reads as a broken filter.
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
      return `${tpl.name} ${tpl.pitch} ${tpl.family}`.toLowerCase().includes(q);
    });
    // Featured ("popular") templates lead the wall — the verified picks a creator should see first. Stable otherwise.
    return list.sort((a, b) => Number(b.featured) - Number(a.featured));
  }, [templates, familyFilter, query]);

  return (
    <section data-template-gallery className="nice-scroll min-h-0 min-w-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-5xl px-6 pb-12 pt-4">
        {/* Heading + search */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h2 className="shrink-0 text-[12px] font-semibold uppercase tracking-[0.16em] fg-faint">
            {tw("start.galleryHeading")}
          </h2>
          <div className="h-px min-w-[40px] flex-1 bg-[color:var(--border)]" />
          <div className="relative shrink-0">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 fg-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tw("start.search")}
              aria-label={tw("start.search")}
              className="h-8 w-44 rounded-md border bd bg-elev pl-8 pr-2.5 text-[12px] fg transition placeholder:fg-faint focus:border-[color:var(--accent)] focus:outline-none focus:ring-1 focus:ring-[color:var(--accent-ring)]/30 sm:w-56"
            />
          </div>
        </div>

        {/* Family chips */}
        {!isLoading && availableFamilies.length > 0 && (
          <div className="mb-5 flex flex-wrap gap-1.5">
            <FamilyChip active={familyFilter === "all"} onClick={() => setFamilyFilter("all")}>
              {tp("templates.all")}
              {templates.length > 0 ? ` ${templates.length}` : ""}
            </FamilyChip>
            {shownChips.map((f) => (
              <FamilyChip key={f.id} active={familyFilter === f.id} onClick={() => setFamilyFilter(f.id)}>
                {tf(`${f.id}.label`)}
              </FamilyChip>
            ))}
            {hiddenCount > 0 ? (
              <button
                type="button"
                onClick={() => setFamiliesExpanded(true)}
                className="rounded-md bg-hover px-2.5 py-1 text-[10.5px] font-medium text-accent transition hover:fg"
              >
                {tp("templates.moreFamilies", { count: hiddenCount })}
              </button>
            ) : familiesExpanded ? (
              <button
                type="button"
                onClick={() => setFamiliesExpanded(false)}
                className="rounded-md bg-hover px-2.5 py-1 text-[10.5px] font-medium fg-muted transition hover:fg"
              >
                {tp("templates.fewerFamilies")}
              </button>
            ) : null}
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-md bg-rose-50 px-3 py-2 text-[11.5px] text-rose-700 ring-1 ring-rose-300/60 dark:bg-rose-500/5 dark:text-rose-300 dark:ring-rose-500/30">
            {tp("templates.loadError", { error })}
          </div>
        )}

        {/* Mosaic */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          {isLoading &&
            Array.from({ length: 6 }).map((_, i) => (
              <div
                key={`skel-${i}`}
                className="animate-pulse rounded-lg ring-1 ring-[color:var(--border)]"
                style={{ aspectRatio: "16 / 11", background: "var(--bg-elev)" }}
              />
            ))}
          {!isLoading &&
            filtered.map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                onClick={() => {
                  registrarUso("crear_plantilla", { plantilla: tpl.id });
                  onPreviewTemplate(tpl);
                }}
                aria-label={tpl.name}
                className="group overflow-hidden rounded-lg text-left ring-1 ring-[color:var(--border)] transition-all duration-200 hover:-translate-y-px hover:shadow-card hover:ring-[color:var(--border-strong)]"
                style={{ background: "var(--bg)" }}
              >
                <TemplatePreviewFrame url={tpl.previewUrl} name={tpl.name} imageUrl={tpl.imageUrl} />
                <div className="flex items-center justify-between gap-2 border-t bd px-3 py-2">
                  <span className="truncate text-[12px] font-semibold fg">{tpl.name}</span>
                  <span className="max-w-[45%] shrink-0 truncate text-right text-[10px] fg-faint">
                    {tf(`${tpl.family}.label`)}
                  </span>
                </div>
              </button>
            ))}
        </div>

        {!isLoading && filtered.length === 0 && !error && (
          <div className="py-12 text-center text-[12.5px] fg-faint">{tw("start.noResults", { query })}</div>
        )}
      </div>
    </section>
  );
}

function FamilyChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-2.5 py-1 text-[10.5px] font-medium transition ${
        active ? "bg-[var(--accent-strong)] text-white" : "fg-muted bg-hover hover:fg"
      }`}
    >
      {children}
    </button>
  );
}
