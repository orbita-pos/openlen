"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowRight,
  Brush,
  ChevronLeft,
  ChevronRight,
  Code,
  Cpu,
  DollarSign,
  Image as ImageIcon,
  Layers,
  Lock,
  Sparkles,
  Terminal,
  Wand2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import type { PipelineStep } from "@/lib/orchestrator/types";
import type { GeneratingPartial } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Generating view — replaces the centered spinner card with the immersive
// "AI building your page" experience. Driven by useGeneration's `partial`
// state, which fills in as the orchestrator streams step_result events.
//
// Layout (full width of the workspace right pane):
//   • OrchestraStrip       — routing chips, model-by-model, top
//   • Floating brief card  — top-left
//   • Floating cost ticker — top-right
//   • Centered preview     — BrowserChrome wrapping the ProgressivePage
//   • Floating thinking peek — bottom center, terminal-style line
//   • StepPipeline         — bottom rail
//
// The ProgressivePage is a hand-built skeleton that reveals progressively
// based on which steps have produced output. We never render the real
// generated HTML here — that swap happens when state transitions to
// "generated" (see preview-panel.tsx).
// ─────────────────────────────────────────────────────────────────────────────

interface ModelMeta {
  name: string;
  tag: string;
  accent: string;
  glyph: string;
  icon: LucideIcon;
}

const MODELS: Record<string, ModelMeta> = {
  lfm2:     { name: "LFM2",            tag: "classifier",       accent: "#3B82F6", glyph: "L", icon: Cpu },
  kimi:     { name: "Kimi K2.6",       tag: "planner & writer", accent: "#8B5CF6", glyph: "K", icon: Wand2 },
  flux:     { name: "FLUX.2",          tag: "image generation", accent: "#EC4899", glyph: "F", icon: ImageIcon },
  qwen:     { name: "Qwen3-Coder",     tag: "code synthesis",   accent: "#10B981", glyph: "Q", icon: Code },
  deepseek: { name: "DeepSeek V4",     tag: "polish & fallback",accent: "#F59E0B", glyph: "D", icon: Brush },
};

const MODEL_ORDER = ["lfm2", "kimi", "flux", "qwen", "deepseek"] as const;

interface StepDef {
  id: PipelineStep;
  label: string;
  model: keyof typeof MODELS;
}

const STEPS: StepDef[] = [
  { id: "classify",         label: "Reading your brief",        model: "lfm2" },
  { id: "plan",             label: "Drafting page plan",        model: "kimi" },
  { id: "copy",             label: "Writing the copy",          model: "kimi" },
  { id: "image_hero",       label: "Generating hero image",     model: "flux" },
  { id: "image_decorative", label: "Generating supporting art", model: "flux" },
  { id: "html",             label: "Composing layout",          model: "qwen" },
  { id: "refine",           label: "Polishing details",         model: "deepseek" },
];

// Plausible "what the model is thinking" lines per step. These are decorative —
// the actual model reasoning isn't streamed, but rotating these makes the
// preview feel alive and gives the user something to read while they wait.
const THINKING: Record<PipelineStep, string[]> = {
  classify: [
    "Tokenizing brief…",
    "Detecting industry…",
    "Extracting audience signal…",
    "Classifying tone register…",
    "Estimating complexity…",
  ],
  plan: [
    "Drafting section sequence…",
    "Choosing visual direction…",
    "Picking palette + typography…",
    "Composing image prompts…",
    "Validating plan shape…",
  ],
  copy: [
    "Drafting hero headline candidates…",
    "Picking the punchier option…",
    "Writing benefit-driven feature copy…",
    "Tuning CTA verbs…",
    "Cross-checking for generic phrases…",
  ],
  image_hero: [
    "Composing prompt for FLUX.2…",
    "Sampling latent…",
    "Refining edges…",
    "Color grading…",
    "Compositing hero…",
  ],
  image_decorative: [
    "Queueing supporting images…",
    "Sampling decoratives…",
    "Matching hero aesthetic…",
    "Compositing…",
    "Finalizing image set…",
  ],
  html: [
    "Composing semantic sections…",
    "Wiring data-section-id attributes…",
    "Generating mobile-first CSS…",
    "Auditing alt text + balance…",
    "Bundling output JSON…",
  ],
  refine: [
    "Auditing color contrast…",
    "Tightening type rhythm…",
    "Final lint pass…",
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Small reusable primitives
// ─────────────────────────────────────────────────────────────────────────────

function Pill({
  children,
  accent,
  className,
}: {
  children: React.ReactNode;
  accent?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
        className,
      )}
      style={
        accent
          ? {
              color: accent,
              backgroundColor: `${accent}14`,
              borderColor: `${accent}40`,
            }
          : undefined
      }
    >
      {children}
    </span>
  );
}

function Dot({
  color,
  pulse,
  className,
}: {
  color: string;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn("relative inline-block h-1.5 w-1.5 rounded-full", className)}
      style={{ background: color }}
    >
      {pulse && (
        <span
          className="absolute inset-0 rounded-full animate-ping opacity-70"
          style={{ background: color }}
        />
      )}
    </span>
  );
}

function useAnimatedNumber(target: number, speed = 0.12): number {
  const [v, setV] = useState(0);
  const targetRef = useRef(target);
  targetRef.current = target;
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      setV((cur) => {
        const t = targetRef.current;
        const next = cur + (t - cur) * speed;
        if (Math.abs(t - next) < 0.0005) return t;
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [speed]);
  return v;
}

// ─────────────────────────────────────────────────────────────────────────────
// OrchestraStrip — top row of model routing chips
// ─────────────────────────────────────────────────────────────────────────────

function OrchestraStrip({
  currentStepIdx,
  completedCount,
}: {
  currentStepIdx: number;
  completedCount: number;
}) {
  const stepsByModel = useMemo(() => {
    const out: Record<string, { idx: number }[]> = {};
    STEPS.forEach((s, idx) => {
      if (!out[s.model]) out[s.model] = [];
      out[s.model].push({ idx });
    });
    return out;
  }, []);

  return (
    <div className="px-3.5 py-2 flex items-center gap-1.5 sm:gap-2 overflow-x-auto nice-scroll bg-zinc-50/80 dark:bg-zinc-950/60 border-b border-zinc-200 dark:border-zinc-800">
      <div className="shrink-0 flex items-center gap-1.5 mr-1 text-[10px] uppercase tracking-[0.18em] text-zinc-400 font-semibold">
        <Activity size={11} className="text-coral-500" />
        Routing
      </div>
      {MODEL_ORDER.map((mId, i) => {
        const m = MODELS[mId];
        const mSteps = stepsByModel[mId] ?? [];
        const isActive = mSteps.some((s) => s.idx === currentStepIdx);
        const isDone = mSteps.every((s) => s.idx < completedCount);
        const isPending = !isActive && !isDone;

        return (
          <span key={mId} className="contents">
            <div
              className={cn(
                "relative shrink-0 flex items-center gap-1.5 rounded-md px-2 py-1 transition",
                isActive &&
                  "bg-white dark:bg-zinc-900 ring-1 ring-zinc-200 dark:ring-zinc-800 shadow-sm",
                isPending && "opacity-50",
              )}
            >
              <span className="relative inline-flex h-5 w-5 items-center justify-center rounded">
                <span
                  className="absolute inset-0 rounded transition"
                  style={{
                    background: isDone || isActive ? m.accent : "transparent",
                    border:
                      isDone || isActive ? "none" : `1px dashed ${m.accent}80`,
                  }}
                />
                <span
                  className="relative text-[10px] font-bold leading-none"
                  style={{ color: isDone || isActive ? "#fff" : m.accent }}
                >
                  {m.glyph}
                </span>
                {isActive && (
                  <span
                    className="absolute inset-0 rounded ring-pulse"
                    style={{ color: `${m.accent}80` }}
                  />
                )}
              </span>
              <div className="leading-tight">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-semibold tracking-tight">
                    {m.name}
                  </span>
                </div>
                <div className="text-[9.5px] uppercase tracking-wider text-zinc-400 font-medium">
                  {m.tag}
                </div>
              </div>
            </div>
            {i < MODEL_ORDER.length - 1 && (
              <div className="shrink-0 flex items-center">
                <span className="block w-2.5 h-px bg-zinc-300 dark:bg-zinc-700" />
                <ChevronRight
                  size={11}
                  className="text-zinc-300 dark:text-zinc-700 -ml-1"
                />
              </div>
            )}
          </span>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Floating overlays
// ─────────────────────────────────────────────────────────────────────────────

function BriefCard({ brief }: { brief: string }) {
  return (
    <div className="absolute top-3.5 left-3.5 z-20 max-w-md hidden md:block">
      <div className="rounded-xl bg-white/90 dark:bg-zinc-900/90 backdrop-blur ring-1 ring-zinc-200 dark:ring-zinc-800 shadow-sm px-3.5 py-2.5">
        <div className="flex items-center gap-1.5 mb-1">
          <Sparkles size={11} className="text-coral-500" />
          <span className="text-[10px] uppercase tracking-[0.18em] text-zinc-400 font-semibold">
            Your brief
          </span>
        </div>
        <p className="text-[12px] leading-relaxed text-zinc-600 dark:text-zinc-400 line-clamp-2">
          {brief}
        </p>
      </div>
    </div>
  );
}

function CostTicker({
  targetCost,
  elapsed,
}: {
  targetCost: number;
  elapsed: number;
}) {
  const animated = useAnimatedNumber(targetCost, 0.12);
  return (
    <div className="absolute top-3.5 right-3.5 z-20">
      <div className="rounded-xl bg-white/90 dark:bg-zinc-900/90 backdrop-blur ring-1 ring-zinc-200 dark:ring-zinc-800 shadow-sm px-3 py-2 flex items-center gap-2.5">
        <DollarSign size={13} className="text-coral-500" />
        <div className="leading-tight">
          <div className="text-[9.5px] uppercase tracking-[0.18em] text-zinc-400 font-semibold">
            Spend
          </div>
          <div className="text-[13px] font-semibold tabular-nums tracking-tight">
            ${animated.toFixed(3)}
          </div>
        </div>
        <div className="h-7 w-px bg-zinc-200 dark:bg-zinc-800" />
        <div className="leading-tight">
          <div className="text-[9.5px] uppercase tracking-[0.18em] text-zinc-400 font-semibold">
            Elapsed
          </div>
          <div className="text-[13px] font-semibold tabular-nums tracking-tight">
            {elapsed.toFixed(1)}
            <span className="text-zinc-400 font-normal">s</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ThinkingPeek({ stepId }: { stepId: PipelineStep }) {
  const lines = THINKING[stepId] ?? [];
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    setIdx(0);
    if (lines.length === 0) return;
    const t = window.setInterval(() => {
      setIdx((i) => (i + 1) % lines.length);
    }, 1200);
    return () => window.clearInterval(t);
  }, [stepId, lines.length]);
  if (lines.length === 0) return null;
  const line = lines[idx] ?? "";
  const step = STEPS.find((s) => s.id === stepId);
  const model = MODELS[step?.model ?? "kimi"];
  return (
    <div className="absolute left-3.5 right-3.5 bottom-3.5 z-20 pointer-events-none">
      <div className="mx-auto max-w-3xl rounded-xl bg-zinc-950/95 dark:bg-zinc-900 text-zinc-200 ring-1 ring-zinc-800 px-3.5 py-2.5 shadow-xl backdrop-blur flex items-center gap-3">
        <Terminal size={13} className="shrink-0" style={{ color: model.accent }} />
        <span
          className="font-mono text-[10px] uppercase tracking-wider shrink-0"
          style={{ color: model.accent }}
        >
          {model.name}
        </span>
        <span className="hidden sm:inline-block h-4 w-px bg-zinc-700" />
        <span
          key={`${stepId}-${idx}`}
          className="font-mono text-[12px] truncate peek-in"
        >
          <span className="text-zinc-500">›</span> {line}
          <span className="inline-block w-1.5 h-3 ml-1 -mb-0.5 bg-zinc-200 animate-blink align-middle" />
        </span>
      </div>
    </div>
  );
}

function IntentChips({
  partial,
}: {
  partial: GeneratingPartial;
}) {
  const intent = partial.intent;
  const plan = partial.plan;
  const accentLfm = MODELS.lfm2.accent;
  const accentKimi = MODELS.kimi.accent;
  if (!intent && !plan) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {intent && (
        <>
          <Pill accent={accentLfm}>
            <Cpu size={10} /> {intent.industry}
          </Pill>
          <Pill accent={accentLfm}>
            <span className="opacity-70">audience</span> {intent.audience}
          </Pill>
          <Pill accent={accentLfm}>
            <span className="opacity-70">tone</span> {intent.tone}
          </Pill>
        </>
      )}
      {plan && (
        <>
          <span className="text-zinc-300 dark:text-zinc-700">·</span>
          <Pill accent={accentKimi}>
            <Layers size={10} /> {plan.sections.length} sections
          </Pill>
          <Pill accent={accentKimi}>{plan.style.mood}</Pill>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Browser chrome + progressive page skeleton
// ─────────────────────────────────────────────────────────────────────────────

function BrowserChrome({
  children,
  url,
  polished,
}: {
  children: React.ReactNode;
  url: string;
  polished?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-800 bg-white dark:bg-[#0a0a0a] overflow-hidden transition-shadow",
        polished &&
          "shadow-[0_30px_80px_-40px_rgba(0,0,0,0.25)] dark:shadow-[0_30px_80px_-30px_rgba(0,0,0,0.6)]",
      )}
    >
      <div className="h-9 px-3 flex items-center gap-3 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900">
        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-red-400/80" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber-400/80" />
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/80" />
        </div>
        <div className="flex items-center gap-1 ml-1 text-zinc-400">
          <ChevronLeft size={12} />
          <ChevronRight size={12} />
        </div>
        <div className="flex-1 max-w-md mx-auto h-6 rounded-md bg-white dark:bg-[#0a0a0a] ring-1 ring-zinc-200 dark:ring-zinc-800 flex items-center gap-1.5 px-2.5 text-[11px] text-zinc-500">
          <Lock size={10} className="text-emerald-500" />
          <span className="text-zinc-400">https://</span>
          <span className="text-zinc-700 dark:text-zinc-300 truncate">{url}</span>
        </div>
        <div className="w-12" />
      </div>
      {children}
    </div>
  );
}

function SectionLabel({
  children,
  accent = "#4F46E5",
  active = false,
}: {
  children: React.ReactNode;
  accent?: string;
  active?: boolean;
}) {
  return (
    <span
      className={cn(
        "absolute -top-2.5 left-3 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium tracking-tight ring-1 ring-inset z-10",
        active ? "shadow-sm" : "opacity-80",
      )}
      style={{
        background: `${accent}14`,
        color: accent,
        borderColor: `${accent}40`,
      }}
    >
      {active && <Dot color={accent} pulse />}
      {children}
    </span>
  );
}

function Tokens({
  text,
  delay = 0,
  perToken = 30,
}: {
  text: string;
  delay?: number;
  perToken?: number;
}) {
  const parts = text.split(/(\s+)/);
  return (
    <>
      {parts.map((p, i) =>
        /\s+/.test(p) ? (
          <span key={i}>{p}</span>
        ) : (
          <span
            key={i}
            className="tok"
            style={{ animationDelay: `${delay + i * perToken}ms` }}
          >
            {p}
          </span>
        ),
      )}
    </>
  );
}

function HeroSkeleton({ url, hasHero }: { url?: string; hasHero: boolean }) {
  return (
    <div className="relative aspect-[5/4] w-full overflow-hidden rounded-2xl ring-1 ring-zinc-200 dark:ring-zinc-800 bg-gradient-to-br from-indigo-50 to-white dark:from-zinc-800 dark:to-zinc-900">
      {!url && (
        <>
          <div className="absolute inset-0 skeleton" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="inline-flex items-center gap-2 rounded-md bg-zinc-950/85 text-white px-2.5 py-1 text-[11px] font-mono">
              <ImageIcon size={11} className="text-pink-300" />
              FLUX.2 · {hasHero ? "compositing…" : "sampling…"}
            </div>
          </div>
        </>
      )}
      {url && (
        <div className="absolute inset-0 img-reveal">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt="Generated hero"
            className="w-full h-full object-cover"
          />
        </div>
      )}
    </div>
  );
}

interface ProgressivePageProps {
  partial: GeneratingPartial;
  currentStepIdx: number;
  level: number;
}

function ProgressivePage({ partial, currentStepIdx, level }: ProgressivePageProps) {
  const showSectionLabels = level >= 2;
  const showText = level >= 3;
  const fullStyle = level >= 6;
  const accent = "#4F46E5";

  const currentStepId = STEPS[currentStepIdx]?.id;
  const isActive = (stepId: PipelineStep) => currentStepId === stepId;

  const hero = partial.images.find((i) => i.purpose === "hero");
  const heroCopy = partial.copy?.sectionTexts.find((s) =>
    s.sectionId.includes("hero") || partial.plan?.sections.find((p) => p.id === s.sectionId)?.kind === "hero"
  );
  const featuresCopy = partial.copy?.sectionTexts.find((s) =>
    partial.plan?.sections.find((p) => p.id === s.sectionId)?.kind === "features"
  );

  return (
    <div className="relative bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      {/* Nav */}
      <div className={cn("relative border-b border-zinc-100 dark:border-zinc-900", fullStyle ? "px-8 py-4" : "px-6 py-4")}>
        {showSectionLabels && (
          <SectionLabel accent={accent} active={isActive("html")}>
            Nav
          </SectionLabel>
        )}
        <div className="flex items-center justify-between">
          {showText ? (
            <div className="flex items-center gap-2">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-indigo-600 text-white font-bold text-[12px]">
                {(partial.intent?.productName ?? "A").charAt(0)}
              </span>
              <span className="font-semibold tracking-tight text-[15px]">
                <Tokens text={partial.intent?.productName ?? "Brand"} />
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="h-6 w-6 rounded-md skeleton" />
              <div className="h-3 w-16 rounded skeleton" />
            </div>
          )}
          {showText ? (
            <nav className="hidden md:flex items-center gap-5 text-[13px] text-zinc-600 dark:text-zinc-400">
              <span><Tokens text="Features" delay={120} /></span>
              <span><Tokens text="Pricing" delay={240} /></span>
              <span><Tokens text="Customers" delay={360} /></span>
              <span className="inline-flex h-8 px-3 items-center rounded-md bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 text-[12px] font-medium">
                <Tokens text="Start free →" delay={460} />
              </span>
            </nav>
          ) : (
            <div className="hidden md:flex items-center gap-4">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-3 w-12 rounded skeleton" />
              ))}
              <div className="h-7 w-20 rounded-md skeleton" />
            </div>
          )}
        </div>
      </div>

      {/* Hero */}
      <div className="relative">
        {showSectionLabels && (
          <SectionLabel accent={accent} active={isActive("copy") || isActive("image_hero")}>
            Hero
          </SectionLabel>
        )}
        <div className={cn("px-6 md:px-8 grid md:grid-cols-5 gap-8 items-center", fullStyle ? "pt-16 pb-20" : "pt-10 pb-12")}>
          <div className="md:col-span-3">
            {showText && heroCopy?.headline ? (
              <>
                {partial.intent && (
                  <div className="inline-flex items-center gap-2 rounded-full ring-1 ring-zinc-200 dark:ring-zinc-800 px-2.5 py-1 text-[11px] font-medium text-zinc-600 dark:text-zinc-400 mb-5">
                    <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                      {partial.intent.tone}
                    </span>
                    <Tokens text={partial.intent.industry} />
                  </div>
                )}
                <h1 className="text-4xl md:text-5xl font-semibold tracking-tight leading-[1.05]">
                  <Tokens text={heroCopy.headline} delay={50} />
                </h1>
                {heroCopy.subheadline && (
                  <p className="mt-5 text-zinc-600 dark:text-zinc-400 text-[16px] leading-relaxed max-w-md">
                    <Tokens text={heroCopy.subheadline} delay={400} perToken={18} />
                  </p>
                )}
                {(heroCopy.ctas?.length ?? 0) > 0 && (
                  <div className="mt-7 flex flex-wrap items-center gap-3">
                    {(heroCopy.ctas ?? []).slice(0, 2).map((cta, i) => (
                      <span
                        key={i}
                        className={cn(
                          "inline-flex h-10 px-4 items-center rounded-lg text-[13px] font-medium",
                          i === 0
                            ? "bg-indigo-600 text-white shadow-sm"
                            : "ring-1 ring-zinc-200 dark:ring-zinc-800",
                        )}
                      >
                        <Tokens text={cta.label} delay={900 + i * 200} />
                      </span>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="space-y-3">
                <div className="h-4 w-20 rounded-full skeleton" />
                <div className="h-9 w-3/4 rounded-md skeleton mt-4" />
                <div className="h-9 w-2/3 rounded-md skeleton" />
                <div className="h-3 w-5/6 rounded-md skeleton-soft mt-5" />
                <div className="h-3 w-4/6 rounded-md skeleton-soft" />
                <div className="flex gap-2 pt-4">
                  <div className="h-9 w-32 rounded-md skeleton" />
                  <div className="h-9 w-28 rounded-md skeleton-soft" />
                </div>
              </div>
            )}
          </div>
          <div className="md:col-span-2">
            <HeroSkeleton url={hero?.url} hasHero={!!hero} />
          </div>
        </div>
      </div>

      {/* Features */}
      <div className="relative bg-zinc-50 dark:bg-zinc-900/40">
        {showSectionLabels && (
          <SectionLabel accent={accent} active={isActive("copy") || isActive("image_decorative")}>
            Features
          </SectionLabel>
        )}
        <div className="px-6 md:px-8 py-14">
          <div className="max-w-md mb-10">
            {showText && featuresCopy?.headline ? (
              <>
                <div className="text-[11px] uppercase tracking-[0.18em] text-indigo-600 dark:text-indigo-400 font-semibold">
                  <Tokens text="What's inside" />
                </div>
                <h2 className="text-2xl md:text-3xl font-semibold tracking-tight mt-2">
                  <Tokens text={featuresCopy.headline} delay={200} />
                </h2>
              </>
            ) : (
              <>
                <div className="h-3 w-24 rounded skeleton" />
                <div className="h-7 w-5/6 rounded-md skeleton mt-3" />
                <div className="h-7 w-3/4 rounded-md skeleton mt-1.5" />
              </>
            )}
          </div>
          <div className="grid md:grid-cols-3 gap-5">
            {(featuresCopy?.items ?? [null, null, null]).slice(0, 3).map((item, i) => {
              const decorative = partial.images.filter((img) => img.purpose !== "hero")[i];
              return (
                <div
                  key={i}
                  className="rounded-xl bg-white dark:bg-zinc-950 ring-1 ring-zinc-200 dark:ring-zinc-800 p-5"
                >
                  {decorative ? (
                    <div className="h-10 w-10 rounded-md overflow-hidden img-reveal">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={decorative.url}
                        alt={decorative.purpose}
                        className="h-full w-full object-cover"
                      />
                    </div>
                  ) : (
                    <div className="h-10 w-10 rounded-md skeleton" />
                  )}
                  {showText && item?.title ? (
                    <>
                      <div className="mt-4 font-semibold tracking-tight">
                        <Tokens text={item.title} delay={i * 120} />
                      </div>
                      {item.description && (
                        <div className="mt-1 text-[13px] text-zinc-600 dark:text-zinc-400 leading-relaxed">
                          <Tokens text={item.description} delay={i * 120 + 200} perToken={16} />
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="mt-4 h-3.5 w-2/3 rounded-md skeleton" />
                      <div className="mt-2 h-2.5 w-full rounded skeleton-soft" />
                      <div className="mt-1 h-2.5 w-5/6 rounded skeleton-soft" />
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div
        className={cn(
          "relative",
          fullStyle ? "bg-zinc-900 text-zinc-300 dark:bg-zinc-950" : "bg-zinc-100 dark:bg-zinc-900",
        )}
      >
        {showSectionLabels && (
          <SectionLabel accent={accent} active={isActive("html")}>
            Footer
          </SectionLabel>
        )}
        <div className="px-6 md:px-8 py-10 flex flex-wrap items-center justify-between gap-4 text-[12px]">
          {showText ? (
            <>
              <div className="flex items-center gap-2">
                <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-indigo-600 text-white font-bold text-[10px]">
                  {(partial.intent?.productName ?? "A").charAt(0)}
                </span>
                <span className="font-semibold">
                  {partial.intent?.productName ?? "Brand"}
                </span>
                <span className="text-zinc-500">· © 2026</span>
              </div>
              <div className="flex items-center gap-5 text-zinc-400">
                <span>Twitter</span>
                <span>Status</span>
                <span>Privacy</span>
                <span>Terms</span>
              </div>
            </>
          ) : (
            <>
              <div className="flex gap-2">
                <div className="h-4 w-4 rounded skeleton" />
                <div className="h-3 w-16 rounded skeleton" />
              </div>
              <div className="flex gap-3">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="h-3 w-10 rounded skeleton-soft" />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// StepPipeline (bottom rail)
// ─────────────────────────────────────────────────────────────────────────────

function StepPipeline({ currentStepIdx }: { currentStepIdx: number }) {
  return (
    <div className="relative z-20 px-3.5 py-3 border-t border-zinc-200 dark:border-zinc-800 bg-white/85 dark:bg-[#0a0a0a]/85 backdrop-blur flex items-center gap-1 overflow-x-auto nice-scroll">
      <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-400 font-semibold shrink-0 mr-1.5">
        Steps
      </div>
      {STEPS.map((s, i) => {
        const m = MODELS[s.model];
        const done = i < currentStepIdx;
        const active = i === currentStepIdx;
        const pending = i > currentStepIdx;
        return (
          <span key={s.id} className="contents">
            <div
              className={cn(
                "relative shrink-0 flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] transition",
                active &&
                  "ring-1 ring-coral-500/40 bg-coral-50 dark:bg-coral-500/10 text-coral-700 dark:text-coral-300",
                done && !active && "text-zinc-700 dark:text-zinc-300",
                pending && "text-zinc-400 dark:text-zinc-600",
              )}
            >
              <span className="relative inline-flex h-3.5 w-3.5 items-center justify-center">
                {done && !active && (
                  <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none">
                      <polyline
                        points="20 6 9 17 4 12"
                        stroke="currentColor"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                )}
                {active && <Dot color="#FF5A36" pulse />}
                {pending && (
                  <span className="h-1 w-1 rounded-full bg-zinc-300 dark:bg-zinc-700" />
                )}
              </span>
              <span className="font-medium">{s.label}</span>
              {active && (
                <span className="text-[10px] font-mono opacity-70">
                  · {m.name}
                </span>
              )}
            </div>
            {i < STEPS.length - 1 && (
              <span className="shrink-0 text-zinc-300 dark:text-zinc-700">·</span>
            )}
          </span>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main exported view
// ─────────────────────────────────────────────────────────────────────────────

export interface GeneratingViewProps {
  partial: GeneratingPartial;
  currentStep: PipelineStep;
  completedSteps: PipelineStep[];
}

export function GeneratingView({
  partial,
  currentStep,
  completedSteps,
}: GeneratingViewProps) {
  // Elapsed timer driven by `startedAt`. Tick every 100ms.
  const [elapsed, setElapsed] = useState(
    Math.max(0, (Date.now() - partial.startedAt) / 1000),
  );
  useEffect(() => {
    const id = window.setInterval(() => {
      setElapsed(Math.max(0, (Date.now() - partial.startedAt) / 1000));
    }, 100);
    return () => window.clearInterval(id);
  }, [partial.startedAt]);

  const currentStepIdx = Math.max(
    0,
    STEPS.findIndex((s) => s.id === currentStep),
  );
  const completedCount = completedSteps.length;

  // level: how much of the page skeleton to reveal.
  // 0 = nothing yet, 1 = classify done (intent), 2 = plan done (sections),
  // 3 = copy done (text), 4 = hero image, 5 = supporting images,
  // 6 = html done (full style), 7 = refine done (polished)
  const level = computeLevel(partial, completedSteps);

  const url = useMemo(() => {
    if (partial.intent?.productName) {
      return slugify(partial.intent.productName) + ".com";
    }
    return "yoursite.com";
  }, [partial.intent?.productName]);

  return (
    <div className="flex flex-col h-full min-h-0 bg-zinc-100 dark:bg-zinc-950">
      <OrchestraStrip
        currentStepIdx={currentStepIdx}
        completedCount={completedCount}
      />

      <main className="relative flex-1 overflow-hidden dotted">
        <BriefCard brief={partial.brief} />
        <CostTicker targetCost={partial.costSoFar} elapsed={elapsed} />
        <ThinkingPeek stepId={currentStep} />

        <div className="h-full overflow-y-auto nice-scroll">
          <div className="mx-auto max-w-5xl px-4 sm:px-8 pt-24 pb-32">
            <div className="mb-3 flex items-center justify-between gap-3 min-h-[28px]">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] uppercase tracking-[0.18em] text-zinc-400 font-semibold">
                  Detected
                </span>
                <IntentChips partial={partial} />
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-coral-50 dark:bg-coral-500/10 text-coral-700 dark:text-coral-300 ring-1 ring-coral-200 dark:ring-coral-500/30 px-2 py-0.5 text-[11px] font-medium">
                  <Dot color="#FF5A36" pulse />
                  {STEPS[currentStepIdx]?.label ?? "Working…"}
                </span>
              </div>
            </div>

            <BrowserChrome url={url} polished={level >= 7}>
              <div className={cn("relative", level < 6 && "scan")}>
                <ProgressivePage
                  partial={partial}
                  currentStepIdx={currentStepIdx}
                  level={level}
                />
              </div>
            </BrowserChrome>

            <div className="mt-4 text-center text-[11px] text-zinc-400 dark:text-zinc-600">
              Average build time is ~60 seconds. Refresh-proof — we stream as we
              build.
            </div>
          </div>
        </div>
      </main>

      <StepPipeline currentStepIdx={currentStepIdx} />
    </div>
  );
}

// Map streamed state → reveal level for the skeleton.
function computeLevel(
  partial: GeneratingPartial,
  completed: PipelineStep[],
): number {
  let level = 0;
  if (partial.intent) level = Math.max(level, 1);
  if (partial.plan) level = Math.max(level, 2);
  if (partial.copy) level = Math.max(level, 3);
  if (partial.images.some((i) => i.purpose === "hero")) level = Math.max(level, 4);
  if (partial.images.some((i) => i.purpose !== "hero")) level = Math.max(level, 5);
  if (completed.includes("html")) level = Math.max(level, 6);
  if (completed.includes("refine")) level = Math.max(level, 7);
  return level;
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 24) || "yoursite"
  );
}
