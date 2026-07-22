// Section library gallery — curated, re-themeable HTML fragments grouped by
// section type. Clicking "Insert" drops the section into the CURRENT project
// (via the iframe section-insert message) — unlike the templates gallery,
// which clones a whole new project. The section arrives host-safe (scoped at
// ingest) and adopts the page's look on a later re-theme pass (F3).

"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Calendar, Eye, Grid3, MessageSq, Sparkles } from "../icons";
import { TemplatePreviewFrame } from "../template-preview-frame";
import {
  SECTION_TYPES_ORDERED,
  type SectionSpec,
  type SectionType,
} from "../sections-data";
import { useSections } from "../use-sections";
import type {
  ContentModule,
  ModuleDestination,
} from "@/lib/workspace-v2/module-add-plan";

export interface ModuleCardState {
  module: ContentModule;
  enabled: boolean;
  alreadyOnPage: boolean;
  needsMembers: boolean;
}

interface SectionsPanelProps {
  /** Open the preview dialog for this section. The match-then-insert commit
   *  happens from inside the dialog ("Use on my page"). */
  onPreview: (s: SectionSpec) => void;
  /** Module cards shown above the section filters (collections/bookings/
   *  comments) — omitted entirely when the caller doesn't pass them. */
  moduleCards?: ModuleCardState[];
  /** Fired when a module card's action button is clicked. */
  onAddModule?: (module: ContentModule, destination: ModuleDestination) => void;
  /** Readable name of the destination page ("inicio" or "/<slug>") — names
   *  where a module lands so the user never has to guess. */
  activePageLabel?: string;
  /** One-shot: open on the Módulos view (hub deep-link). Consumed via
   *  onModulesViewConsumed — the panel mounts AFTER the click when the
   *  sidebar wasn't on the Library tab, so a nonce-ref misfires. */
  openModulesView?: boolean;
  onModulesViewConsumed?: () => void;
  /** Open the Colecciones manager (add/edit products) — the answer to
   *  "¿y de dónde salen los productos?" is one click away, never a hunt. */
  onManageCollections?: () => void;
  /** Destination-page SELECTOR (Business-style): a visible control beats a
   *  faint text line for non-technical creators. Switching also switches the
   *  canvas page, so what you see is where it lands. */
  sitePages?: { slug: string; title: string }[];
  activeSitePage?: string | null;
  onSwitchPage?: (slug: string | null) => void;
  homeLabel?: string;
}

const MODULE_ICON: Record<ContentModule, (p: { size?: number }) => ReactNode> = {
  collections: (p) => <Grid3 size={p.size ?? 15} />,
  bookings: (p) => <Calendar size={p.size ?? 15} />,
  comments: (p) => <MessageSq size={p.size ?? 15} />,
};

function ModuleCard({
  card,
  onAddModule,
  onManageCollections,
}: {
  card: ModuleCardState;
  onAddModule: (module: ContentModule, destination: ModuleDestination) => void;
  onManageCollections?: () => void;
}) {
  const t = useTranslations("panelsA");
  const key = card.module === "collections" ? "Catalog" : card.module === "bookings" ? "Bookings" : "Comments";
  return (
    <div className="rounded-lg ring-1 ring-[color:var(--border)] px-3 py-2.5" style={{ background: "var(--bg)" }}>
      <div className="flex items-center gap-2 mb-0.5">
        <span className="text-accent">{MODULE_ICON[card.module]({})}</span>
        <h4 className="text-[12.5px] font-semibold fg leading-tight">{t(`sections.module${key}Title`)}</h4>
        <span className="ml-auto text-[8.5px] uppercase tracking-[0.12em] px-1 py-0.5 rounded fg-faint bg-hover font-semibold">
          {t("sections.moduleScopePage")}
        </span>
      </div>
      <p className="text-[10.5px] fg-muted leading-snug mb-2">{t(`sections.module${key}Desc`)}</p>
      {card.alreadyOnPage ? (
        <button
          type="button"
          onClick={() => onAddModule(card.module, "section")}
          className="w-full inline-flex items-center justify-center text-[11px] font-medium h-7 rounded-md fg-muted bg-hover hover:fg transition"
        >
          {t("sections.moduleAlreadyHere")}
        </button>
      ) : (
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => onAddModule(card.module, "section")}
            className="flex-1 inline-flex items-center justify-center text-[11px] font-medium h-7 rounded-md text-white bg-[var(--accent-strong)] hover:opacity-90 transition"
          >
            {t("sections.moduleInsertHere")}
          </button>
          {card.module !== "comments" && (
            <button
              type="button"
              onClick={() => onAddModule(card.module, "page")}
              className="flex-1 inline-flex items-center justify-center text-[11px] font-medium h-7 rounded-md fg bg-hover hover:bg-app transition"
            >
              {t("sections.moduleAsPage")}
            </button>
          )}
        </div>
      )}
      {card.needsMembers && !card.alreadyOnPage && (
        <p className="mt-1.5 text-[10px] fg-faint leading-snug">{t("sections.moduleNeedsMembers")}</p>
      )}
      {card.module === "collections" && card.enabled && onManageCollections && (
        <button
          type="button"
          onClick={onManageCollections}
          className="mt-1.5 w-full inline-flex items-center justify-center text-[11px] font-medium h-7 rounded-md fg-muted bg-hover hover:fg transition"
        >
          {t("sections.manageProducts")}
        </button>
      )}
    </div>
  );
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

export function SectionsPanel({
  onPreview,
  moduleCards,
  onAddModule,
  activePageLabel,
  openModulesView,
  onModulesViewConsumed,
  onManageCollections,
  sitePages,
  activeSitePage,
  onSwitchPage,
  homeLabel,
}: SectionsPanelProps) {
  const t = useTranslations("panelsA");
  const ts = useTranslations("sections");
  const [typeFilter, setTypeFilter] = useState<SectionType | "all">("all");
  const { sections, byType, isLoading, error } = useSections();
  // Secciones | Módulos live as two segmented views — mixing module cards into
  // the section gallery read as clutter ("se ve todo revoltoso"). The hub's
  // "Agregar a una página" deep-link bumps focusModulesNonce to land directly
  // on the Módulos view.
  const hasModules = !!(moduleCards && moduleCards.length > 0 && onAddModule);
  const [view, setView] = useState<"sections" | "modules">("sections");
  useEffect(() => {
    if (openModulesView) {
      setView("modules");
      onModulesViewConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openModulesView]);
  const showModules = hasModules && view === "modules";

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

      {hasModules && (
        <div className="flex gap-1 mb-3 p-0.5 rounded-lg bg-hover">
          <button
            type="button"
            onClick={() => setView("sections")}
            className={`flex-1 h-7 text-[11px] rounded-md transition font-medium ${
              !showModules ? "bg-[var(--accent-strong)] text-white" : "fg-muted hover:fg"
            }`}
          >
            {t("sections.sectionsTab")}
          </button>
          <button
            type="button"
            onClick={() => setView("modules")}
            className={`flex-1 h-7 text-[11px] rounded-md transition font-medium ${
              showModules ? "bg-[var(--accent-strong)] text-white" : "fg-muted hover:fg"
            }`}
          >
            {t("sections.modulesHeading")}
          </button>
        </div>
      )}

      {showModules && moduleCards && onAddModule && (
        <section className="mb-5">
          <p className="text-[11px] fg-muted leading-snug mb-1.5">{t("sections.modulesIntro")}</p>
          {onSwitchPage ? (
            <div className="mb-3">
              <label className="block text-[10px] uppercase tracking-[0.12em] fg-faint font-semibold mb-1">
                {t("sections.modulesTargetLabel")}
              </label>
              <select
                value={activeSitePage ?? ""}
                onChange={(e) => onSwitchPage(e.target.value || null)}
                className="w-full bg-app ring-1 ring-[color:var(--border)] rounded-lg px-2.5 h-8 text-[12px] fg outline-none focus:ring-[color:var(--accent)] transition"
              >
                <option value="">{homeLabel ?? "inicio"}</option>
                {(sitePages ?? []).map((p) => (
                  <option key={p.slug} value={p.slug}>
                    /{p.slug} — {p.title}
                  </option>
                ))}
              </select>
            </div>
          ) : activePageLabel ? (
            <p className="text-[10px] fg-faint mb-3">
              {t("sections.modulesTarget", { page: activePageLabel })}
            </p>
          ) : null}
          <div className="grid grid-cols-1 gap-2">
            {moduleCards.map((card) => (
              <ModuleCard
                key={card.module}
                card={card}
                onAddModule={onAddModule}
                onManageCollections={onManageCollections}
              />
            ))}
          </div>
        </section>
      )}

      {!showModules && (
      <>
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
      </>
      )}
    </div>
  );
}
