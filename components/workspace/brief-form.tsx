"use client";

import { Check, PanelLeftClose, RefreshCw, Sparkles } from "lucide-react";
import { Accordion } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox } from "@/components/ui/combobox";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import type { BriefFormState, StyleId, ToneId } from "./types";

const SAMPLE_PROMPT =
  "A landing page for my Stripe-based SaaS that helps freelancers track invoices and get paid faster — Calendly meets QuickBooks, but with fewer features and a personality.";

const SECTIONS = ["Hero", "Features", "Pricing", "Testimonials", "FAQ", "Footer"];

const INDUSTRIES = [
  "SaaS",
  "Fintech",
  "Developer tools",
  "E-commerce",
  "Health & wellness",
  "Education",
  "Marketing",
  "Real estate",
  "Hospitality",
  "AI / ML",
  "Crypto",
  "Nonprofit",
  "Consumer apps",
];

const TONE_OPTIONS: { value: ToneId; label: string }[] = [
  { value: "professional", label: "Professional" },
  { value: "playful", label: "Playful" },
  { value: "bold", label: "Bold" },
  { value: "minimal", label: "Minimal" },
];

interface StyleCard {
  id: StyleId;
  label: string;
  className: string;
  dot: string;
}

const STYLE_OPTIONS: StyleCard[] = [
  { id: "modern", label: "Modern minimal", className: "style-modern", dot: "bg-zinc-900" },
  { id: "bold", label: "Bold tech", className: "style-bold", dot: "bg-coral-500" },
  { id: "warm", label: "Warm friendly", className: "style-warm", dot: "bg-amber-500" },
];

export const SAMPLE_BRIEF = SAMPLE_PROMPT;

export interface BriefFormProps {
  state: BriefFormState;
  onGenerate: () => void;
  generating: boolean;
  onCollapse: () => void;
}

export function BriefForm({ state, onGenerate, generating, onCollapse }: BriefFormProps) {
  return (
    <aside className="relative md:h-full md:overflow-y-auto overflow-x-hidden nice-scroll bg-white dark:bg-[#0a0a0a] border-b md:border-b-0 md:border-r border-zinc-200 dark:border-zinc-800">
      <div className="px-7 pt-7 pb-3">
        <div className="flex items-center justify-between gap-2 mb-1">
          <div className="flex items-center gap-2">
            <Badge tone="coral">
              <Sparkles size={11} /> New page
            </Badge>
            <Badge tone="zinc">Draft</Badge>
          </div>
          <Tooltip label="Collapse panel" side="bottom">
            <button
              type="button"
              onClick={onCollapse}
              className="hidden md:inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition"
            >
              <PanelLeftClose size={15} />
            </button>
          </Tooltip>
        </div>
        <h1 className="text-xl font-semibold tracking-tight mt-2">
          Describe your landing page
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-500 mt-1.5">
          A paragraph is plenty. Inari handles the rest — copy, layout, imagery, code.
        </p>
      </div>

      <div className="px-7 pb-8 space-y-5">
        <div>
          <div className="relative">
            <textarea
              value={state.prompt}
              onChange={(e) => state.setPrompt(e.target.value)}
              rows={10}
              placeholder="A landing page for my Stripe-based SaaS that helps freelancers track invoices and get paid faster..."
              className="block w-full p-3.5 text-sm leading-relaxed rounded-xl bg-white dark:bg-[#0a0a0a] ring-1 ring-zinc-200 dark:ring-zinc-800 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-coral-500 transition-shadow resize-none"
            />
            <div className="absolute bottom-2 right-2 flex items-center gap-2">
              <button
                type="button"
                onClick={() => state.setPrompt(SAMPLE_PROMPT)}
                className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11px] font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition"
              >
                <Sparkles size={11} /> Try an example
              </button>
              <span className="text-[11px] tabular-nums text-zinc-400">
                {state.prompt.length} / 2000
              </span>
            </div>
          </div>
        </div>

        <Accordion title="Advanced" defaultOpen={false}>
          <Field label="Target audience" hint="Who you're selling to">
            <Input
              value={state.audience}
              onChange={(e) => state.setAudience(e.target.value)}
              placeholder="Independent freelance designers earning $40k–$120k/yr"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Tone">
              <Select
                value={state.tone}
                onChange={(v) => state.setTone(v as ToneId)}
                options={TONE_OPTIONS}
              />
            </Field>
            <Field label="Industry">
              <Combobox
                value={state.industry}
                onChange={state.setIndustry}
                options={INDUSTRIES}
              />
            </Field>
          </div>

          <div>
            <div className="text-[13px] font-medium mb-2.5">Sections to include</div>
            <div className="grid grid-cols-2 gap-y-2.5 gap-x-4">
              {SECTIONS.map((s) => (
                <Checkbox
                  key={s}
                  label={s}
                  checked={state.sections.includes(s)}
                  onChange={(v) =>
                    state.setSections(
                      v ? [...state.sections, s] : state.sections.filter((x) => x !== s),
                    )
                  }
                />
              ))}
            </div>
          </div>
        </Accordion>

        <div>
          <div className="flex items-end justify-between mb-2.5">
            <span className="text-[13px] font-medium">Visual style</span>
            <span className="text-[11px] text-zinc-400">
              Mix &amp; match — Inari&apos;ll riff on it
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2.5">
            {STYLE_OPTIONS.map((s) => {
              const active = state.style === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => state.setStyle(s.id)}
                  className={cn(
                    "text-left rounded-xl ring-1 transition group focus:outline-none focus-visible:ring-2 focus-visible:ring-coral-500",
                    active
                      ? "ring-coral-500 dark:ring-coral-500 shadow-[0_0_0_3px_rgba(255,90,54,0.12)]"
                      : "ring-zinc-200 dark:ring-zinc-800 hover:ring-zinc-300 dark:hover:ring-zinc-700",
                  )}
                >
                  <div
                    className={cn(
                      "h-20 rounded-t-xl relative overflow-hidden",
                      s.className,
                    )}
                  >
                    <div
                      className={cn(
                        "absolute inset-2 flex flex-col gap-1.5",
                        s.id === "bold" ? "text-white" : "text-zinc-900",
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <div
                          className={cn(
                            "h-1 w-4 rounded",
                            s.id === "bold"
                              ? "bg-coral-400"
                              : s.id === "warm"
                                ? "bg-amber-700"
                                : "bg-zinc-700",
                          )}
                        />
                        <div className="flex gap-0.5 opacity-60">
                          <div className="h-0.5 w-1.5 bg-current rounded" />
                          <div className="h-0.5 w-1.5 bg-current rounded" />
                          <div className="h-0.5 w-1.5 bg-current rounded" />
                        </div>
                      </div>
                      <div className="mt-auto">
                        <div className="h-1.5 w-12 bg-current rounded mb-1 opacity-90" />
                        <div className="h-1 w-8 bg-current rounded opacity-50" />
                      </div>
                    </div>
                  </div>
                  <div className="px-2.5 py-2 flex items-center gap-1.5">
                    <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} />
                    <span className="text-[12px] font-medium truncate">{s.label}</span>
                    {active && (
                      <Check size={11} className="ml-auto text-coral-500" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="pt-1">
          <Button
            size="xl"
            className="shimmer w-full !h-12 text-[15px]"
            onClick={onGenerate}
            disabled={generating}
          >
            {generating ? (
              <>
                <RefreshCw size={16} className="animate-spin" /> Generating your page…
              </>
            ) : (
              <>
                <Sparkles size={16} /> Generate landing page{" "}
                <span className="text-[11px] font-medium opacity-70 ml-1">⌘↵</span>
              </>
            )}
          </Button>
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-[11px] text-zinc-500 dark:text-zinc-500">
              Costs{" "}
              <span className="font-medium text-zinc-700 dark:text-zinc-300">
                ~$0.40
              </span>{" "}
              in AI tokens. Free tier:{" "}
              <span className="font-medium text-zinc-700 dark:text-zinc-300">
                2 of 3 used
              </span>{" "}
              this month.
            </p>
            <a
              href="#upgrade"
              className="text-[11px] font-medium text-coral-700 dark:text-coral-400 hover:underline shrink-0"
            >
              Upgrade
            </a>
          </div>
          <div className="mt-1.5 h-1 rounded-full bg-zinc-100 dark:bg-zinc-900 overflow-hidden">
            <div
              className="h-full bg-coral-500 rounded-full"
              style={{ width: "66%" }}
            />
          </div>
        </div>
      </div>
    </aside>
  );
}
