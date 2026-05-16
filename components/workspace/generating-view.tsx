"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Cpu,
  Image as ImageIcon,
  Layers,
  Lock,
} from "lucide-react";
import { cn } from "@/lib/cn";
import type { FilledBlock, PipelineStep } from "@/lib/orchestrator/types";
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

interface StepDef {
  id: PipelineStep;
  label: string;
}

const STEPS: StepDef[] = [
  { id: "classify",         label: "Reading your brief" },
  { id: "plan",             label: "Picking page blocks" },
  { id: "fill",             label: "Filling slot content" },
  { id: "image_hero",       label: "Generating hero image" },
  { id: "image_decorative", label: "Generating supporting art" },
  { id: "assemble",         label: "Composing final page" },
];

// Indigo accent for the mock skeleton — independent of the real generated
// page's palette (which only lands once html completes).
const ACCENT = "#4F46E5";

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

function IntentChips({
  partial,
}: {
  partial: GeneratingPartial;
}) {
  const intent = partial.intent;
  const plan = partial.plan;
  const accentLfm = "#3B82F6";
  const accentKimi = "#8B5CF6";
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
            <Layers size={10} /> {plan.blockSequence.length} blocks
          </Pill>
          <Pill accent={accentKimi}>{plan.aesthetic}</Pill>
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
  const heroFilled = partial.filledBlocks.find((b) =>
    b.blockId.startsWith("hero/"),
  );
  const featuresFilled = partial.filledBlocks.find((b) =>
    b.blockId.startsWith("features/"),
  );
  const heroCopy = extractHeroCopy(heroFilled);
  const featuresCopy = extractFeaturesCopy(featuresFilled);

  return (
    <div className="relative bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      {/* Nav */}
      <div className={cn("relative border-b border-zinc-100 dark:border-zinc-900", fullStyle ? "px-8 py-4" : "px-6 py-4")}>
        {showSectionLabels && (
          <SectionLabel accent={accent} active={isActive("assemble")}>
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
          <SectionLabel accent={accent} active={isActive("fill") || isActive("image_hero")}>
            Hero
          </SectionLabel>
        )}
        <div className={cn("px-6 md:px-8 grid md:grid-cols-5 gap-8 items-center", fullStyle ? "pt-16 pb-20" : "pt-10 pb-12")}>
          <div className="md:col-span-3">
            {showText && heroCopy.headline ? (
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
                {heroCopy.ctas.length > 0 && (
                  <div className="mt-7 flex flex-wrap items-center gap-3">
                    {heroCopy.ctas.slice(0, 2).map((cta, i) => (
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
          <SectionLabel accent={accent} active={isActive("fill") || isActive("image_decorative")}>
            Features
          </SectionLabel>
        )}
        <div className="px-6 md:px-8 py-14">
          <div className="max-w-md mb-10">
            {showText && featuresCopy.headline ? (
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
            {(featuresCopy.items.length > 0 ? featuresCopy.items : [null, null, null]).slice(0, 3).map((item, i) => {
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
                      {item.body && (
                        <div className="mt-1 text-[13px] text-zinc-600 dark:text-zinc-400 leading-relaxed">
                          <Tokens text={item.body} delay={i * 120 + 200} perToken={16} />
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
          <SectionLabel accent={accent} active={isActive("assemble")}>
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
    <div className="h-full min-h-0 overflow-y-auto nice-scroll dotted bg-zinc-100 dark:bg-zinc-950">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 pt-6 pb-12">
        {/* Subtle status line: detected chips on the left, current step + cost
            + elapsed on the right. Replaces all the heavier chrome (orchestra
            strip, step pipeline, floating cards) so the page-being-built is
            the visual focus. */}
        <div className="mb-4 flex items-center justify-between gap-3 flex-wrap min-h-[28px]">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-coral-50 dark:bg-coral-500/10 text-coral-700 dark:text-coral-300 ring-1 ring-coral-200 dark:ring-coral-500/30 px-2 py-0.5 text-[11px] font-medium">
              <Dot color="#FF5A36" pulse />
              {STEPS[currentStepIdx]?.label ?? "Working…"}
            </span>
            <IntentChips partial={partial} />
          </div>
          <div className="flex items-center gap-2 shrink-0 text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400">
            <span>
              <span className="text-zinc-400">$</span>
              <AnimatedCost target={partial.costSoFar} />
            </span>
            <span className="text-zinc-300 dark:text-zinc-700">·</span>
            <span>
              {elapsed.toFixed(1)}
              <span className="text-zinc-400">s</span>
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
      </div>
    </div>
  );
}

function AnimatedCost({ target }: { target: number }) {
  const v = useAnimatedNumber(target, 0.18);
  return <>{v.toFixed(3)}</>;
}

// Map streamed state → reveal level for the skeleton.
function computeLevel(
  partial: GeneratingPartial,
  completed: PipelineStep[],
): number {
  let level = 0;
  if (partial.intent) level = Math.max(level, 1);
  if (partial.plan) level = Math.max(level, 2);
  if (partial.filledBlocks.length > 0) level = Math.max(level, 3);
  if (partial.images.some((i) => i.purpose === "hero")) level = Math.max(level, 4);
  if (partial.images.some((i) => i.purpose !== "hero")) level = Math.max(level, 5);
  if (completed.includes("assemble")) level = Math.max(level, 7);
  return level;
}

// ─────────────────────────────────────────────────────────────────────────────
// Slot adapters — pull "copy-shaped" data out of arbitrary block slot JSON
// so the skeleton reveal logic stays simple. Each block has its own slot
// schema; we look for the conventional field names and fall back to empty.
// ─────────────────────────────────────────────────────────────────────────────

interface HeroCopyShape {
  headline: string;
  subheadline?: string;
  ctas: Array<{ label: string; href: string }>;
}

interface FeaturesCopyShape {
  headline: string;
  items: Array<{ title: string; body?: string }>;
}

function extractHeroCopy(filled: FilledBlock | undefined): HeroCopyShape {
  if (!filled || !filled.slots || typeof filled.slots !== "object") {
    return { headline: "", ctas: [] };
  }
  const s = filled.slots as Record<string, unknown>;
  const headline = typeof s.headline === "string" ? s.headline : "";
  const subheadline = typeof s.sub === "string" ? s.sub : undefined;
  const ctas: HeroCopyShape["ctas"] = [];
  if (isCta(s.primaryCTA)) ctas.push(s.primaryCTA);
  if (isCta(s.secondaryCTA)) ctas.push(s.secondaryCTA);
  return { headline, subheadline, ctas };
}

function extractFeaturesCopy(filled: FilledBlock | undefined): FeaturesCopyShape {
  if (!filled || !filled.slots || typeof filled.slots !== "object") {
    return { headline: "", items: [] };
  }
  const s = filled.slots as Record<string, unknown>;
  const headline =
    typeof s.title === "string"
      ? s.title
      : typeof s.headline === "string"
        ? s.headline
        : "";
  const itemsRaw = Array.isArray(s.items) ? (s.items as Record<string, unknown>[]) : [];
  const items: FeaturesCopyShape["items"] = itemsRaw
    .filter((it): it is Record<string, unknown> => typeof it === "object" && it !== null)
    .map((it) => ({
      title: typeof it.title === "string" ? it.title : "",
      body: typeof it.body === "string" ? it.body : undefined,
    }));
  return { headline, items };
}

function isCta(value: unknown): value is { label: string; href: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).label === "string" &&
    typeof (value as Record<string, unknown>).href === "string"
  );
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
