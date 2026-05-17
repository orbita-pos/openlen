// Content mode panel — section accordions with per-variant slot forms.
// Mirrors the artifact's ContentPanel; renders against mock SECTIONS so
// the wow moment (knob → preview repaints) doesn't require a real project.

"use client";

import type { ComponentType } from "react";
import {
  ChevronDown,
  CircleDollar,
  GripDots,
  HelpCircle,
  ImageIcon,
  Layers,
  Plus,
  Sparkles,
  X,
  Zap,
} from "../icons";
import type { Section } from "../mock-data";
import { Button } from "../ui";

interface SectionIconProps {
  id: string;
}

function SectionIcon({ id }: SectionIconProps) {
  const map: Record<string, ComponentType<{ size?: number }>> = {
    Sparkles,
    Image: ImageIcon,
    Layers,
    CircleDollar,
    HelpCircle,
    Zap,
  };
  const I = map[id] ?? Layers;
  return <I size={12} />;
}

interface TextFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  mono?: boolean;
}

function TextField({
  label,
  value,
  onChange,
  rows = 1,
  mono = false,
}: TextFieldProps) {
  const base =
    "block w-full px-2 py-1.5 text-[12px] rounded-md bg-elev border bd focus:outline-none focus:border-[color:var(--accent)] focus:ring-1 focus:ring-[color:var(--accent-ring)]/30 transition resize-none fg";
  return (
    <label className="block">
      <div className="text-[10px] uppercase tracking-wider fg-faint font-semibold mb-1 ui-small">
        {label}
      </div>
      {rows > 1 ? (
        <textarea
          rows={rows}
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          className={`${base} ${mono ? "font-mono" : ""}`}
        />
      ) : (
        <input
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          className={`${base} ${mono ? "font-mono" : ""}`}
        />
      )}
    </label>
  );
}

interface SectionFormProps {
  section: Section;
  onUpdate: (id: string, fields: Section["fields"]) => void;
}

function SectionForm({ section, onUpdate }: SectionFormProps) {
  const f = section.fields;
  const update =
    (key: string) =>
    (val: string): void => {
      onUpdate(section.id, { ...f, [key]: val });
    };

  switch (section.id) {
    case "hero":
      return (
        <>
          <TextField
            label="Eyebrow"
            value={(f.eyebrow as string) ?? ""}
            onChange={update("eyebrow")}
          />
          <TextField
            label="Heading"
            value={(f.heading as string) ?? ""}
            onChange={update("heading")}
            rows={2}
          />
          <TextField
            label="Subheading"
            value={(f.subheading as string) ?? ""}
            onChange={update("subheading")}
            rows={3}
          />
          <div className="grid grid-cols-2 gap-2">
            <TextField
              label="CTA label"
              value={(f.ctaPrimaryLabel as string) ?? ""}
              onChange={update("ctaPrimaryLabel")}
            />
            <TextField
              label="CTA URL"
              value={(f.ctaPrimaryUrl as string) ?? ""}
              onChange={update("ctaPrimaryUrl")}
              mono
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <TextField
              label="Secondary"
              value={(f.ctaSecondaryLabel as string) ?? ""}
              onChange={update("ctaSecondaryLabel")}
            />
            <TextField
              label="URL"
              value={(f.ctaSecondaryUrl as string) ?? ""}
              onChange={update("ctaSecondaryUrl")}
              mono
            />
          </div>
        </>
      );
    case "logobar": {
      const logos = (f.logos as string[]) ?? [];
      return (
        <>
          <TextField
            label="Caption"
            value={(f.caption as string) ?? ""}
            onChange={update("caption")}
          />
          <div>
            <div className="text-[10px] uppercase tracking-wider fg-faint font-semibold mb-1.5 ui-small">
              Logos
            </div>
            <div className="space-y-1.5">
              {logos.map((logo, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="fg-faint cursor-grab">
                    <GripDots size={12} />
                  </span>
                  <input
                    value={logo}
                    onChange={(e) => {
                      const next = [...logos];
                      next[i] = e.target.value;
                      onUpdate(section.id, { ...f, logos: next });
                    }}
                    className="flex-1 px-2 h-7 text-[12px] rounded-md bg-elev border bd focus:outline-none focus:border-[color:var(--accent)] focus:ring-1 focus:ring-[color:var(--accent-ring)]/30"
                  />
                  <button
                    type="button"
                    className="fg-faint hover:fg-muted"
                    onClick={() =>
                      onUpdate(section.id, {
                        ...f,
                        logos: logos.filter((_, idx) => idx !== i),
                      })
                    }
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="mt-2 inline-flex items-center gap-1 fg-muted hover:fg text-[11.5px]"
            >
              <Plus size={11} /> Add logo
            </button>
          </div>
        </>
      );
    }
    case "features": {
      const items =
        (f.items as { title: string; body: string }[]) ?? [];
      return (
        <>
          <TextField
            label="Eyebrow"
            value={(f.eyebrow as string) ?? ""}
            onChange={update("eyebrow")}
          />
          <TextField
            label="Heading"
            value={(f.heading as string) ?? ""}
            onChange={update("heading")}
            rows={2}
          />
          <div>
            <div className="text-[10px] uppercase tracking-wider fg-faint font-semibold mb-1.5 ui-small">
              Items
            </div>
            <div className="space-y-1.5">
              {items.map((item, i) => (
                <div
                  key={i}
                  className="rounded-md border bd p-2 bg-elev/40"
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="fg-faint cursor-grab">
                      <GripDots size={12} />
                    </span>
                    <span className="text-[10px] uppercase tracking-wider fg-faint font-semibold ui-small">
                      Item {i + 1}
                    </span>
                  </div>
                  <input
                    value={item.title}
                    onChange={(e) => {
                      const next = [...items];
                      next[i] = { ...item, title: e.target.value };
                      onUpdate(section.id, { ...f, items: next });
                    }}
                    placeholder="Title"
                    className="block w-full px-2 h-7 text-[12px] font-medium rounded-md bg-elev border bd focus:outline-none focus:border-[color:var(--accent)] focus:ring-1 focus:ring-[color:var(--accent-ring)]/30 mb-1.5"
                  />
                  <textarea
                    value={item.body}
                    onChange={(e) => {
                      const next = [...items];
                      next[i] = { ...item, body: e.target.value };
                      onUpdate(section.id, { ...f, items: next });
                    }}
                    rows={2}
                    placeholder="Body"
                    className="block w-full px-2 py-1.5 text-[12px] rounded-md bg-elev border bd focus:outline-none focus:border-[color:var(--accent)] focus:ring-1 focus:ring-[color:var(--accent-ring)]/30 resize-none"
                  />
                </div>
              ))}
            </div>
            <button
              type="button"
              className="mt-2 inline-flex items-center gap-1 fg-muted hover:fg text-[11.5px]"
            >
              <Plus size={11} /> Add item
            </button>
          </div>
        </>
      );
    }
    case "pricing": {
      const tiers =
        (f.tiers as {
          name: string;
          price: string;
          blurb: string;
          featured?: boolean;
        }[]) ?? [];
      return (
        <>
          <TextField
            label="Heading"
            value={(f.heading as string) ?? ""}
            onChange={update("heading")}
          />
          <div>
            <div className="text-[10px] uppercase tracking-wider fg-faint font-semibold mb-1.5 ui-small">
              Tiers
            </div>
            {tiers.map((t, i) => (
              <div
                key={i}
                className={`rounded-md border ${
                  t.featured
                    ? "border-[color:var(--accent)]/40 bg-accent-soft/40"
                    : "bd bg-elev/40"
                } p-2 mb-1.5`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] uppercase tracking-wider fg-faint font-semibold ui-small">
                    Tier {i + 1}
                    {t.featured && " · featured"}
                  </span>
                  <span className="text-[10.5px] fg-muted tabular">
                    {t.price}
                  </span>
                </div>
                <input
                  value={t.name}
                  className="block w-full px-2 h-7 text-[12px] font-medium rounded-md bg-elev border bd focus:outline-none focus:border-[color:var(--accent)] focus:ring-1 focus:ring-[color:var(--accent-ring)]/30 mb-1"
                  onChange={(e) => {
                    const next = [...tiers];
                    next[i] = { ...t, name: e.target.value };
                    onUpdate(section.id, { ...f, tiers: next });
                  }}
                />
                <input
                  value={t.blurb}
                  className="block w-full px-2 h-7 text-[11.5px] rounded-md bg-elev border bd focus:outline-none focus:border-[color:var(--accent)] focus:ring-1 focus:ring-[color:var(--accent-ring)]/30"
                  onChange={(e) => {
                    const next = [...tiers];
                    next[i] = { ...t, blurb: e.target.value };
                    onUpdate(section.id, { ...f, tiers: next });
                  }}
                />
              </div>
            ))}
          </div>
        </>
      );
    }
    case "faq": {
      const items = (f.items as { q: string; a: string }[]) ?? [];
      return (
        <>
          <TextField
            label="Heading"
            value={(f.heading as string) ?? ""}
            onChange={update("heading")}
          />
          <div>
            <div className="text-[10px] uppercase tracking-wider fg-faint font-semibold mb-1.5 ui-small">
              Questions
            </div>
            {items.map((it, i) => (
              <div
                key={i}
                className="rounded-md border bd p-2 bg-elev/40 mb-1.5"
              >
                <input
                  value={it.q}
                  className="block w-full px-2 h-7 text-[12px] font-medium rounded-md bg-elev border bd focus:outline-none focus:border-[color:var(--accent)] focus:ring-1 focus:ring-[color:var(--accent-ring)]/30 mb-1.5"
                  onChange={(e) => {
                    const next = [...items];
                    next[i] = { ...it, q: e.target.value };
                    onUpdate(section.id, { ...f, items: next });
                  }}
                />
                <textarea
                  value={it.a}
                  rows={2}
                  className="block w-full px-2 py-1.5 text-[11.5px] rounded-md bg-elev border bd focus:outline-none focus:border-[color:var(--accent)] focus:ring-1 focus:ring-[color:var(--accent-ring)]/30 resize-none"
                  onChange={(e) => {
                    const next = [...items];
                    next[i] = { ...it, a: e.target.value };
                    onUpdate(section.id, { ...f, items: next });
                  }}
                />
              </div>
            ))}
          </div>
        </>
      );
    }
    default:
      return null;
  }
}

interface SectionAccordionProps {
  section: Section;
  expanded: boolean;
  onToggle: () => void;
  onUpdate: SectionFormProps["onUpdate"];
}

function SectionAccordion({
  section,
  expanded,
  onToggle,
  onUpdate,
}: SectionAccordionProps) {
  return (
    <div
      className={`rounded-lg border bd transition ${
        expanded ? "bg-elev shadow-card" : ""
      }`}
    >
      <div
        className="flex items-center gap-2 px-2.5 h-9 cursor-pointer select-none"
        onClick={onToggle}
      >
        <span className="fg-faint hover:fg-muted cursor-grab">
          <GripDots size={14} />
        </span>
        <span className="fg-muted">
          <SectionIcon id={section.icon} />
        </span>
        <span className="text-[13px] font-medium fg flex-1 truncate">
          {section.name}
        </span>
        <span className="inline-flex items-center px-1.5 h-[18px] rounded-full bg-hover fg-muted text-[9.5px] font-medium uppercase tracking-wider">
          {section.variant}
        </span>
        <ChevronDown
          size={13}
          className={`fg-faint transition-transform ${
            expanded ? "rotate-180" : ""
          }`}
        />
      </div>
      {expanded && (
        <div className="px-2.5 pb-3 pt-1 border-t bd space-y-2.5 fade-in">
          <SectionForm section={section} onUpdate={onUpdate} />
        </div>
      )}
    </div>
  );
}

interface ContentPanelProps {
  sections: Section[];
  expanded: string | null;
  setExpanded: (id: string | null) => void;
  onUpdate: (id: string, fields: Section["fields"]) => void;
}

export function ContentPanel({
  sections,
  expanded,
  setExpanded,
  onUpdate,
}: ContentPanelProps) {
  return (
    <div className="flex flex-col h-full">
      <div className="px-3 pt-3 pb-2 flex items-center justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-[0.16em] fg-faint font-semibold ui-small">
            Sections
          </div>
          <div className="text-[12.5px] fg-muted">
            {sections.length} on this page
          </div>
        </div>
        <button
          type="button"
          className="inline-flex items-center justify-center h-7 w-7 rounded-md fg-muted hover:fg hover:bg-hover transition"
          title="Search sections (⌘P)"
        >
          <span className="text-[10px] font-mono">⌘P</span>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto nice-scroll px-3 pb-2 space-y-1.5">
        {sections.map((s) => (
          <SectionAccordion
            key={s.id}
            section={s}
            expanded={expanded === s.id}
            onToggle={() => setExpanded(expanded === s.id ? null : s.id)}
            onUpdate={onUpdate}
          />
        ))}
      </div>
      <div className="px-3 py-2 border-t bd shrink-0">
        <Button variant="ghost" size="sm" className="w-full justify-center">
          <Plus size={12} /> Add section
        </Button>
      </div>
    </div>
  );
}
