// Templates gallery — file-based curated landings.
//
// Each card is a live thumbnail of the HTML served from
// /public/templates/curated/<id>.html. Clicking a card calls
// /api/projects/from-template { templateId } which clones the HTML into a
// new project owned by the caller and redirects to /new-v2?project=<newId>
// where the Deploy dropdown is enabled. Templates themselves never have a
// subdomain — only the resulting user project does, at publish time.

"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronRight, Check, Sparkles } from "../icons";
import {
  TemplatePreviewFrame,
} from "../template-preview-frame";
import {
  TEMPLATE_FAMILIES,
  templatesByFamily,
  type TemplateFamily,
  type TemplateSpec,
} from "../templates-data";

interface TemplatesPanelProps {
  /** Set the template the workspace previews in the main area. Click in
   *  the gallery only previews — committing (creating a project) happens
   *  from the banner over the preview iframe. */
  onPreview: (t: TemplateSpec) => void;
  /** ID of the template currently being previewed in the main area, used
   *  to highlight which card is "selected". */
  previewingId: string | null;
}

interface TemplateCardProps {
  template: TemplateSpec;
  onPreview: (t: TemplateSpec) => void;
  previewing: boolean;
}

function TemplateCard({
  template,
  onPreview,
  previewing,
}: TemplateCardProps) {
  const applied = previewing;
  return (
    <button
      type="button"
      onClick={() => onPreview(template)}
      aria-label={`Preview template: ${template.name}`}
      aria-pressed={applied}
      className={`group relative w-full text-left rounded-lg overflow-hidden ring-1 transition-all duration-200 ${
        applied
          ? "ring-[var(--accent)] shadow-[0_4px_24px_-12px_color-mix(in_oklch,var(--accent)_60%,transparent)]"
          : "ring-[color:var(--border)] hover:ring-[color:var(--border-strong)] hover:-translate-y-px hover:shadow-card"
      }`}
      style={{ background: "var(--bg)" }}
    >
      <TemplatePreviewFrame
        url={template.previewUrl}
        name={template.name}
        applied={applied}
      />

      {!applied && (
        <div
          aria-hidden
          className="absolute top-[18px] left-0 right-0 bottom-[88px] pointer-events-none flex items-end justify-center pb-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
          style={{
            background:
              "linear-gradient(to top, color-mix(in oklch, var(--bg) 85%, transparent) 0%, transparent 60%)",
          }}
        >
          <span
            className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 h-7 rounded-full text-white"
            style={{ background: "var(--accent)" }}
          >
            Preview
            <ChevronRight size={11} stroke={2.5} />
          </span>
        </div>
      )}

      <div className="px-3 pt-2.5 pb-3 border-t bd">
        <div className="flex items-baseline justify-between gap-2 mb-1">
          <h3 className="text-[13px] font-semibold fg leading-tight tracking-tight truncate">
            {template.name}
          </h3>
          {applied && (
            <span className="inline-flex items-center gap-0.5 text-[9px] uppercase tracking-[0.14em] text-accent font-semibold shrink-0">
              <Check size={9} stroke={3} />
              Previewing
            </span>
          )}
        </div>
        <p className="text-[11px] fg-muted leading-snug italic line-clamp-1">
          {template.pitch}
        </p>
        <div className="flex flex-wrap gap-1 mt-2">
          {template.tags.map((tag) => (
            <span
              key={tag}
              className="text-[9px] px-1.5 py-0.5 rounded fg-faint bg-hover ui-small font-medium"
            >
              {tag}
            </span>
          ))}
        </div>
      </div>
    </button>
  );
}

function FamilyHeader({
  label,
  tagline,
  count,
}: {
  label: string;
  tagline: string;
  count: number;
}) {
  return (
    <div className="mb-3 mt-1 first:mt-0">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-[10.5px] uppercase tracking-[0.18em] fg font-semibold ui-small">
          {label}
        </h3>
        <span className="text-[10px] fg-faint tabular-nums">
          {count} template{count === 1 ? "" : "s"}
        </span>
      </div>
      <p className="text-[10.5px] fg-faint leading-snug mt-1">{tagline}</p>
    </div>
  );
}

export function TemplatesPanel({
  onPreview,
  previewingId,
}: TemplatesPanelProps) {
  const [familyFilter, setFamilyFilter] = useState<TemplateFamily | "all">(
    "all",
  );
  const searchParams = useSearchParams();
  const currentProjectId = searchParams.get("project");

  const visibleFamilies = TEMPLATE_FAMILIES.filter(
    (f) => familyFilter === "all" || familyFilter === f.id,
  );

  return (
    <div className="overflow-y-auto nice-scroll h-full px-3 py-3">
      <div className="flex items-center gap-2 mb-2">
        <Sparkles size={13} className="text-accent" />
        <h2 className="text-[11px] uppercase tracking-[0.16em] fg-faint font-semibold ui-small">
          Curated templates
        </h2>
      </div>
      <p className="text-[11px] fg-muted leading-snug mb-3">
        Click a card to preview it big. When you&apos;re ready, hit{" "}
        <b>Use this template</b> in the banner to clone it into a new project.
      </p>

      {currentProjectId && (
        <div className="mb-3 flex items-start gap-2 px-2.5 py-2 rounded-md ring-1 ring-amber-300/60 dark:ring-amber-500/30 bg-amber-50 dark:bg-amber-500/5">
          <span className="text-[11px] text-amber-800 dark:text-amber-200 leading-snug">
            Picking a template starts a <b>new</b> project. Your current
            project stays saved in <a href="/projects" className="underline underline-offset-2">/projects</a>.
          </span>
        </div>
      )}

      <div className="flex flex-wrap gap-1 mb-4">
        <button
          type="button"
          onClick={() => setFamilyFilter("all")}
          className={`text-[10.5px] px-2.5 py-1 rounded-md transition font-medium ${
            familyFilter === "all"
              ? "bg-[var(--accent)] text-white"
              : "fg-muted bg-hover hover:fg"
          }`}
        >
          All 15
        </button>
        {TEMPLATE_FAMILIES.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFamilyFilter(f.id)}
            className={`text-[10.5px] px-2.5 py-1 rounded-md transition font-medium ${
              familyFilter === f.id
                ? "bg-[var(--accent)] text-white"
                : "fg-muted bg-hover hover:fg"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {visibleFamilies.map((family) => {
        const templates = templatesByFamily(family.id);
        return (
          <section key={family.id} className="mb-5 last:mb-2">
            <FamilyHeader
              label={family.label}
              tagline={family.tagline}
              count={templates.length}
            />
            <div className="flex flex-col gap-3">
              {templates.map((t) => (
                <TemplateCard
                  key={t.id}
                  template={t}
                  onPreview={onPreview}
                  previewing={previewingId === t.id}
                />
              ))}
            </div>
          </section>
        );
      })}

      <div className="mt-4 px-1 text-[10px] fg-faint leading-relaxed">
        Templates are static HTML — pure markup, Tailwind CDN, Google Fonts.
        Cloning makes them yours; only your project claims a subdomain when
        you hit Deploy.
      </div>
    </div>
  );
}
