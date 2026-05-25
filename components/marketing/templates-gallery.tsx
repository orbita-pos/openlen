"use client";

import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import {
  TEMPLATE_FAMILY_META,
  type TemplateFamily,
} from "@/lib/templates/families";
import { TemplateCard, type TemplateCardData } from "./template-card";

// Order in which families are listed on the marketing /templates page.
// Keep aligned with the schema enum + add new families at the end.
// Any family in the schema but missing from this list renders zero cards
// in the family-grouped view (gallery filters by this list).
const FAMILIES_ORDER: TemplateFamily[] = [
  "technical-minimal",
  "editorial",
  "saas",
  "ai-ml",
  "documentation",
  "open-source",
  "commerce",
  "ecommerce",
  "fintech",
  "health-tech",
  "education",
  "mobile-app",
  "portfolio",
  "agency",
  "creator",
  "music",
  "podcast",
  "gaming",
  "pre-launch",
  "event",
  "wedding",
  "travel",
  "hospitality",
  "food-beverage",
  "fashion",
  "real-estate",
  "local-services",
  "wellness",
  "nonprofit",
  "climate",
  "web3",
  "hardware",
];

interface TemplatesGalleryProps {
  templates: TemplateCardData[];
}

// Client-side searchable gallery. Server component (app/templates/page.tsx)
// fetches everything once + passes the metadata slice; this component owns
// the query state and filters in place. When the query is empty, renders
// the family-grouped layout. When non-empty, renders a flat results grid.
export function TemplatesGallery({ templates }: TemplatesGalleryProps) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // "/" focuses the search input (v0 / Linear keyboard convention).
  // Skip when the user is already typing in an input/textarea.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) {
        return;
      }
      e.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? templates.filter((t) => {
        const familyLabel = TEMPLATE_FAMILY_META[t.family].label.toLowerCase();
        return (
          t.name.toLowerCase().includes(q) ||
          t.pitch.toLowerCase().includes(q) ||
          t.family.toLowerCase().includes(q) ||
          familyLabel.includes(q) ||
          t.id.toLowerCase().includes(q)
        );
      })
    : templates;

  return (
    <>
      {/* Search bar — sticky-ish below the hero. */}
      <section className="border-b border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-950/70 backdrop-blur-sm">
        <div className="mx-auto max-w-6xl px-6 py-4 sm:py-5">
          <div className="relative">
            <Search
              size={16}
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400 dark:text-zinc-500 pointer-events-none"
              aria-hidden
            />
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, family, or use case…"
              aria-label="Search templates"
              className="w-full h-11 pl-10 pr-24 rounded-lg ring-1 ring-zinc-200 dark:ring-zinc-800 bg-white dark:bg-zinc-950 text-[14px] text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-coral-500 transition"
            />
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
              {query && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    inputRef.current?.focus();
                  }}
                  aria-label="Clear search"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition"
                >
                  <X size={14} />
                </button>
              )}
              <kbd className="hidden sm:inline-flex items-center justify-center h-6 min-w-6 px-1.5 rounded text-[11px] font-mono text-zinc-400 dark:text-zinc-500 ring-1 ring-zinc-200 dark:ring-zinc-800 bg-zinc-50 dark:bg-zinc-900">
                /
              </kbd>
            </div>
          </div>

          <div className="mt-2 flex items-baseline justify-between text-[11px] text-zinc-500 dark:text-zinc-400 tabular-nums">
            <span>
              Showing {filtered.length} of {templates.length} templates
            </span>
            {q && filtered.length > 0 && (
              <span className="hidden sm:inline">
                Matching <code className="text-zinc-700 dark:text-zinc-300">{query.trim()}</code>
              </span>
            )}
          </div>
        </div>
      </section>

      {/* Results */}
      <div className="mx-auto max-w-6xl px-6 py-10 sm:py-12">
        {filtered.length === 0 ? (
          <EmptyState query={query.trim()} onClear={() => setQuery("")} />
        ) : q ? (
          <FlatGrid templates={filtered} />
        ) : (
          <>
            <FeaturedSection templates={templates} />
            <FamilySections
              templates={templates.filter((t) => !t.featured)}
            />
          </>
        )}
      </div>
    </>
  );
}

function FeaturedSection({ templates }: { templates: TemplateCardData[] }) {
  const featured = templates.filter((t) => t.featured);
  if (featured.length === 0) return null;
  return (
    <section className="mb-14">
      <div className="mb-8 flex items-baseline justify-between gap-4 flex-wrap">
        <div>
          <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-coral-700 dark:text-coral-400">
            <span className="text-coral-500">★</span> Top-tier showcases
          </div>
          <h2 className="mt-2 text-2xl sm:text-3xl font-semibold tracking-tight">
            Featured templates
          </h2>
          <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400 max-w-md">
            Hand-built showcases with real photography — examples of what
            your page can look like fully populated.
          </p>
        </div>
        <span className="text-xs text-zinc-500 dark:text-zinc-400 uppercase tracking-wider font-medium">
          {featured.length} curated
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6">
        {featured.map((t) => (
          <TemplateCard key={t.id} template={t} />
        ))}
      </div>
    </section>
  );
}

function FlatGrid({ templates }: { templates: TemplateCardData[] }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6">
      {templates.map((t) => (
        <TemplateCard key={t.id} template={t} />
      ))}
    </div>
  );
}

function FamilySections({ templates }: { templates: TemplateCardData[] }) {
  return (
    <div className="space-y-14">
      {FAMILIES_ORDER.map((family) => {
        const meta = TEMPLATE_FAMILY_META[family];
        const familyTemplates = templates.filter((t) => t.family === family);
        if (familyTemplates.length === 0) return null;
        return (
          <section key={family} id={family}>
            <div className="mb-8 flex items-baseline justify-between gap-4 flex-wrap">
              <div>
                <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">
                  {meta.label}
                </h2>
                <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400 max-w-md">
                  {meta.tagline}
                </p>
              </div>
              <span className="text-xs text-zinc-400 dark:text-zinc-400 uppercase tracking-wider font-medium">
                {familyTemplates.length}{" "}
                {familyTemplates.length === 1 ? "template" : "templates"}
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6">
              {familyTemplates.map((t) => (
                <TemplateCard key={t.id} template={t} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function EmptyState({ query, onClear }: { query: string; onClear: () => void }) {
  return (
    <div className="text-center py-16 sm:py-24">
      <div className="text-sm text-zinc-500 dark:text-zinc-400">
        No templates match{" "}
        <code className="text-zinc-700 dark:text-zinc-300">{query}</code>.
      </div>
      <button
        type="button"
        onClick={onClear}
        className="mt-4 inline-flex items-center gap-1.5 rounded-full ring-1 ring-zinc-300 dark:ring-zinc-700 hover:ring-zinc-900 dark:hover:ring-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 dark:text-zinc-100 transition"
      >
        Clear search
      </button>
    </div>
  );
}
