"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, ImageOff, PanelLeftClose, RefreshCw, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import type { BriefFormState } from "./types";

interface UsageInfo {
  plan: "free" | "pro";
  generate: Array<{ label: string; max: number; used: number; remaining: number }>;
}

const SAMPLE_PROMPT =
  "A landing page for my Stripe-based SaaS that helps freelancers track invoices and get paid faster — Calendly meets QuickBooks, but with fewer features and a personality.";

const EXAMPLES: { label: string; prompt: string }[] = [
  {
    label: "SaaS launch",
    prompt:
      "Landing page for FlowDeck, a Kanban tool for designers that uses AI to prioritize tasks. Features: AI prioritization, real-time sync, Slack integration. Pricing tiers: Free, Pro $29/mo, Team $99/mo.",
  },
  {
    label: "Portfolio",
    prompt:
      "Personal portfolio for a freelance UI/UX designer based in Mexico City named Sofia. She specializes in fintech and SaaS. Wants to showcase 6 projects and have a contact section.",
  },
  {
    label: "Coffee subscription",
    prompt:
      "Landing page for 'Volcánica', a single-origin coffee subscription from Mexican volcanoes. Hero: bag of coffee on volcanic stone. Subscription tiers: $19 monthly, $49 quarterly. Mission: support Mexican farmers.",
  },
  {
    label: "Event",
    prompt:
      "Landing page for 'Solo Founder Summit 2026', a 1-day virtual conference for indie hackers. October 15. Speakers: Pieter Levels, Justin Welsh, Marc Lou. Tickets $99 early bird.",
  },
];

export const SAMPLE_BRIEF = SAMPLE_PROMPT;

export interface BriefFormProps {
  state: BriefFormState;
  onGenerate: () => void;
  generating: boolean;
  onCollapse: () => void;
  /** When true, ask the orchestrator to skip FLUX.2 + Wan image generation.
   *  Owned by the page so it survives a panel collapse. */
  includeImages: boolean;
  onToggleIncludeImages: (value: boolean) => void;
}

export function BriefForm({
  state,
  onGenerate,
  generating,
  onCollapse,
  includeImages,
  onToggleIncludeImages,
}: BriefFormProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Fetch usage on mount and again after each generation completes so the
  // counter stays accurate without a full page reload.
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/usage")
      .then((r) => (r.ok ? (r.json() as Promise<UsageInfo>) : null))
      .then((data) => {
        if (!cancelled) setUsage(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [generating]);

  const monthly = usage?.generate.find((w) => w.label === "monthly");
  const outOfQuota = monthly?.remaining === 0;
  const canGenerate = state.prompt.trim().length >= 10 && !generating && !outOfQuota;

  return (
    <aside className="relative md:h-full md:overflow-y-auto overflow-x-hidden nice-scroll bg-white dark:bg-[#0a0a0a] border-b md:border-b-0 md:border-r border-zinc-200 dark:border-zinc-800 flex flex-col">
      <div className="px-6 pt-6 pb-3 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <Badge tone="coral">
            <Sparkles size={11} /> New page
          </Badge>
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
      </div>

      <div className="flex-1 min-h-0 flex flex-col px-6 pb-6">
        <div className="flex-1 min-h-[260px] flex flex-col justify-center">
          <h1 className="text-xl font-semibold tracking-tight">
            What do you want to build?
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-500 mt-1.5">
            Describe your landing page in plain English. OpenLen handles copy,
            layout, imagery, and code.
          </p>

          <div className="relative mt-5 rounded-2xl ring-1 ring-zinc-200 dark:ring-zinc-800 bg-white dark:bg-[#0a0a0a] focus-within:ring-2 focus-within:ring-coral-500 transition-shadow">
            <textarea
              ref={textareaRef}
              value={state.prompt}
              onChange={(e) => state.setPrompt(e.target.value)}
              rows={6}
              placeholder="A landing page for my Stripe-based SaaS that helps freelancers track invoices and get paid faster…"
              maxLength={2000}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  if (canGenerate) onGenerate();
                }
              }}
              className="block w-full p-4 pb-12 text-[14px] leading-relaxed bg-transparent placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none resize-none rounded-2xl"
            />
            <div className="absolute inset-x-3 bottom-2.5 flex items-center justify-between gap-2">
              <span className="text-[11px] tabular-nums text-zinc-400">
                {state.prompt.length}/2000
              </span>
              <button
                type="button"
                onClick={onGenerate}
                disabled={!canGenerate}
                aria-label={generating ? "Generating…" : "Generate landing page"}
                title={generating ? "Generating…" : "Generate (⌘↵)"}
                className={cn(
                  "inline-flex items-center justify-center h-8 w-8 rounded-lg transition btn-coral-shadow",
                  canGenerate
                    ? "bg-coral-500 text-white hover:bg-coral-600 active:bg-coral-700"
                    : "bg-zinc-200 dark:bg-zinc-800 text-zinc-400 cursor-not-allowed",
                )}
              >
                {generating ? (
                  <RefreshCw size={14} className="animate-spin" />
                ) : (
                  <ArrowUp size={15} strokeWidth={2.5} />
                )}
              </button>
            </div>
          </div>

          <div className="mt-3 flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] text-zinc-400 mr-0.5">Try:</span>
            {EXAMPLES.map((ex) => (
              <button
                key={ex.label}
                type="button"
                onClick={() => state.setPrompt(ex.prompt)}
                className="inline-flex items-center gap-1 h-6 px-2 rounded-md text-[11px] text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-900 ring-1 ring-zinc-200 dark:ring-zinc-800 transition"
              >
                {ex.label}
              </button>
            ))}
          </div>

          <label className="mt-5 flex items-center justify-between gap-3 cursor-pointer select-none rounded-lg ring-1 ring-zinc-200 dark:ring-zinc-800 px-3 py-2.5 hover:ring-zinc-300 dark:hover:ring-zinc-700 transition">
            <span className="flex items-start gap-2.5 min-w-0">
              <ImageOff
                size={14}
                className={cn(
                  "shrink-0 mt-0.5",
                  includeImages
                    ? "text-zinc-400 dark:text-zinc-600"
                    : "text-coral-600 dark:text-coral-400",
                )}
              />
              <span className="min-w-0">
                <span className="block text-[12px] font-medium text-zinc-700 dark:text-zinc-300">
                  Include AI-generated images
                </span>
                <span className="block text-[11px] text-zinc-500 dark:text-zinc-500 mt-0.5">
                  {includeImages
                    ? "FLUX hero + Wan decoratives. Adds ~$0.06–0.09."
                    : "Text-only layout. Upload your own images in the editor."}
                </span>
              </span>
            </span>
            <input
              type="checkbox"
              checked={includeImages}
              onChange={(e) => onToggleIncludeImages(e.target.checked)}
              className="sr-only peer"
            />
            <span
              aria-hidden="true"
              className={cn(
                "shrink-0 relative inline-flex h-5 w-9 rounded-full transition-colors",
                includeImages
                  ? "bg-coral-500"
                  : "bg-zinc-300 dark:bg-zinc-700",
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform",
                  includeImages ? "translate-x-4" : "translate-x-0.5",
                )}
              />
            </span>
          </label>
        </div>

        <div className="shrink-0 mt-6 pt-4 border-t border-zinc-100 dark:border-zinc-900">
          <div className="flex items-center justify-between gap-3 text-[11px] text-zinc-500 dark:text-zinc-500">
            <span>
              {monthly ? (
                <>
                  <span
                    className={cn(
                      "font-medium tabular-nums",
                      outOfQuota
                        ? "text-red-600 dark:text-red-400"
                        : "text-zinc-700 dark:text-zinc-300",
                    )}
                  >
                    {monthly.remaining} of {monthly.max}
                  </span>{" "}
                  {usage?.plan === "free" ? "free " : ""}generations left this month
                </>
              ) : (
                <>
                  ~
                  <span className="font-medium text-zinc-700 dark:text-zinc-300">
                    $0.13
                  </span>{" "}
                  per generation · 60s avg
                </>
              )}
            </span>
            {usage?.plan === "free" && (
              <a
                href="#upgrade"
                className="font-medium text-coral-700 dark:text-coral-400 hover:underline"
              >
                Upgrade
              </a>
            )}
          </div>
          {monthly && (
            <div className="mt-2 h-1 rounded-full bg-zinc-100 dark:bg-zinc-900 overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  outOfQuota ? "bg-red-500" : "bg-coral-500",
                )}
                style={{
                  width: `${Math.min(100, Math.round(((monthly.max - monthly.remaining) / monthly.max) * 100))}%`,
                }}
              />
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
