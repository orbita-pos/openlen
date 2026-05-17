// Entry chooser shown when /new-v2 loads with no `?project=` query param
// and no entry mode picked yet. Three cards mirror the three create flows
// the workspace exposes: AI brief → orchestrator, curated template, or paste
// HTML straight from claude.ai (or anywhere). Picking one transitions the
// workspace into a "guided" state where only the relevant left-sidebar tab
// is unlocked — see `EntryMode` in /new-v2/page.tsx for the state machine.

"use client";

import { ChevronRight, FileText, PaletteIcon, Sparkles, Wand } from "./icons";

interface EmptyStateProps {
  onPickAI: () => void;
  onPickTemplate: () => void;
  onPickPaste: () => void;
}

interface CardSpec {
  id: "ai" | "template" | "paste";
  Icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  description: string;
  detail: string;
  accent: string;
  onClick: () => void;
}

export function EmptyState({
  onPickAI,
  onPickTemplate,
  onPickPaste,
}: EmptyStateProps) {
  const cards: CardSpec[] = [
    {
      id: "ai",
      Icon: Wand,
      title: "Generate with AI",
      description: "Describe your page in plain English. We compose it.",
      detail: "Brief → page in ~30s",
      accent: "var(--accent)",
      onClick: onPickAI,
    },
    {
      id: "template",
      Icon: PaletteIcon,
      title: "Start from a template",
      description: "Pick a curated landing across six aesthetic families.",
      detail: "30 designs · ready to publish",
      accent: "var(--accent)",
      onClick: onPickTemplate,
    },
    {
      id: "paste",
      Icon: FileText,
      title: "Paste your HTML",
      description: "Bring HTML from claude.ai or anywhere. We host it.",
      detail: "Self-contained · published in one click",
      accent: "var(--accent)",
      onClick: onPickPaste,
    },
  ];

  return (
    <div className="flex-1 min-h-0 flex items-center justify-center bg-app overflow-y-auto">
      <div className="w-full max-w-5xl px-6 py-12">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-accent-soft text-accent text-[11px] font-medium mb-5">
            <Sparkles size={11} />
            OpenLen Workspace
          </div>
          <h1 className="text-[34px] md:text-[42px] font-semibold fg tracking-tight leading-[1.05]">
            What do you want to start with?
          </h1>
          <p className="mt-3 text-[14px] md:text-[15px] fg-muted max-w-xl mx-auto leading-relaxed">
            Three paths to a published landing page. Pick one and we&apos;ll get
            you a real subdomain on <span className="fg">openlen.com</span>.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {cards.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={c.onClick}
              className="group relative text-left rounded-xl ring-1 ring-[color:var(--border)] hover:ring-[color:var(--border-strong)] bg-[color:var(--bg)] hover:-translate-y-0.5 hover:shadow-card transition-all duration-200 p-5 flex flex-col"
            >
              <span
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg ring-1 ring-[color:var(--border)] bg-elev mb-4 transition group-hover:ring-[color:var(--accent)]"
                style={{ color: c.accent }}
              >
                <c.Icon size={17} />
              </span>
              <h3 className="text-[15px] font-semibold fg tracking-tight">
                {c.title}
              </h3>
              <p className="mt-1.5 text-[12.5px] fg-muted leading-relaxed flex-1">
                {c.description}
              </p>
              <div className="mt-4 flex items-center justify-between text-[11px] fg-faint">
                <span className="font-mono">{c.detail}</span>
                <span className="inline-flex items-center gap-0.5 fg-muted group-hover:text-accent transition-colors">
                  Pick this
                  <ChevronRight size={12} />
                </span>
              </div>
            </button>
          ))}
        </div>

        <div className="mt-8 text-center text-[12px] fg-faint">
          or{" "}
          <a
            href="/projects"
            className="fg-muted hover:fg underline underline-offset-2 transition"
          >
            browse your projects →
          </a>
        </div>
      </div>
    </div>
  );
}
