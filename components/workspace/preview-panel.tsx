"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Lock,
  Monitor,
  PanelRightOpen,
  RefreshCw,
  Smartphone,
  Sparkles,
  Tablet,
} from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { Tabs } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";
import type { LandingPage, PipelineStep } from "@/lib/orchestrator/types";
import { cn } from "@/lib/cn";
import type { WorkspaceState } from "./types";

type Device = "desktop" | "tablet" | "mobile";
type Zoom = "50" | "75" | "100" | "fit";

const DEVICE_WIDTHS: Record<Device, number> = {
  desktop: 1280,
  tablet: 820,
  mobile: 390,
};

const STEP_LABELS: Record<PipelineStep, string> = {
  classify: "Reading your brief…",
  plan: "Drafting page plan…",
  copy: "Writing the copy…",
  html: "Composing layout…",
  image_hero: "Generating hero image…",
  image_decorative: "Generating supporting imagery…",
  refine: "Polishing details…",
};

const ALL_STEPS: PipelineStep[] = [
  "classify",
  "plan",
  "copy",
  "image_hero",
  "image_decorative",
  "html",
  "refine",
];

export interface PreviewPanelProps {
  state: WorkspaceState;
  panelOpen: boolean;
  onOpenPanel: () => void;
}

export function PreviewPanel({ state, panelOpen, onOpenPanel }: PreviewPanelProps) {
  const [device, setDevice] = useState<Device>("desktop");
  const [zoom, setZoom] = useState<Zoom>("fit");
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [fitScale, setFitScale] = useState(1);
  const [iframeKey, setIframeKey] = useState(0);
  const [contentHeight, setContentHeight] = useState(1200);

  const deviceWidth = DEVICE_WIDTHS[device];

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const compute = () => {
      const available = el.clientWidth - 64;
      setFitScale(Math.min(1, available / deviceWidth));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [deviceWidth]);

  const scale =
    zoom === "fit"
      ? fitScale
      : zoom === "100"
        ? 1
        : zoom === "75"
          ? 0.75
          : 0.5;

  const srcDoc = useMemo(() => {
    if (state.kind !== "generated") return null;
    return buildSrcDoc(state.result);
  }, [state]);

  // The iframe self-reports its document height via postMessage (script
  // injected by buildSrcDoc). This avoids parent-side contentDocument access,
  // which is finicky around iframe load timing and sandboxing — and it lets
  // the wrapper match the real height so the dotted-bg outer container owns
  // the only scroll.
  useEffect(() => {
    if (!srcDoc) {
      setContentHeight(1200);
      return;
    }
    const iframe = iframeRef.current;
    const onMessage = (e: MessageEvent) => {
      if (iframe && e.source && e.source !== iframe.contentWindow) return;
      const data = e.data;
      if (
        data &&
        typeof data === "object" &&
        data.type === "inari:height" &&
        typeof data.height === "number" &&
        data.height > 0
      ) {
        setContentHeight(data.height);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [srcDoc, iframeKey]);

  return (
    <section className="md:flex-1 md:min-h-0 min-h-[600px] flex flex-col bg-zinc-100 dark:bg-zinc-950">
      <div className="relative z-30 shrink-0 h-12 px-3 sm:px-4 flex items-center justify-between gap-2 border-b border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-[#0a0a0a]/70 backdrop-blur">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          {!panelOpen && (
            <Tooltip label="Show panel" side="bottom">
              <button
                type="button"
                onClick={onOpenPanel}
                className="hidden md:inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition mr-1"
              >
                <PanelRightOpen size={15} />
              </button>
            </Tooltip>
          )}
          <Tabs
            value={device}
            onChange={setDevice}
            options={[
              { value: "desktop", label: "Desktop", icon: Monitor },
              { value: "tablet", label: "Tablet", icon: Tablet },
              { value: "mobile", label: "Mobile", icon: Smartphone },
            ]}
          />
          <div className="hidden xl:flex items-center gap-1.5 text-[11px] text-zinc-500 tabular-nums">
            <span>{deviceWidth}px</span>
            <span className="text-zinc-300 dark:text-zinc-700">·</span>
            <span>{Math.round(scale * 100)}% zoom</span>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <div className="hidden lg:inline-flex items-center gap-0.5 rounded-md ring-1 ring-zinc-200 dark:ring-zinc-800 bg-white dark:bg-[#0a0a0a] p-0.5 mr-1">
            {(["50", "75", "100", "fit"] as Zoom[]).map((z) => (
              <button
                key={z}
                type="button"
                onClick={() => setZoom(z)}
                className={cn(
                  "h-6 px-2 text-[11px] font-medium tabular-nums rounded transition",
                  zoom === z
                    ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
                    : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100",
                )}
              >
                {z === "fit" ? "Fit" : `${z}%`}
              </button>
            ))}
          </div>
          <IconButton
            label="Refresh preview"
            onClick={() => setIframeKey((k) => k + 1)}
          >
            <RefreshCw size={14} />
          </IconButton>
          <IconButton
            label="Open in new tab"
            onClick={() => {
              if (!srcDoc) return;
              const w = window.open();
              if (w) {
                w.document.open();
                w.document.write(srcDoc);
                w.document.close();
              }
            }}
          >
            <ExternalLink size={14} />
          </IconButton>
        </div>
      </div>

      <div ref={containerRef} className="flex-1 overflow-auto nice-scroll p-8 dotted">
        <div className="mx-auto" style={{ width: deviceWidth * scale, maxWidth: "100%" }}>
          <div className="rounded-t-xl ring-1 ring-zinc-200 dark:ring-zinc-800 bg-white dark:bg-[#0a0a0a] overflow-hidden">
            <div className="h-9 px-3 flex items-center gap-3 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900">
              <div className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-red-400/80" />
                <span className="h-2.5 w-2.5 rounded-full bg-amber-400/80" />
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/80" />
              </div>
              <div className="flex items-center gap-1 ml-1">
                <button
                  type="button"
                  className="inline-flex h-5 w-5 items-center justify-center text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
                >
                  <ChevronLeft size={12} />
                </button>
                <button
                  type="button"
                  className="inline-flex h-5 w-5 items-center justify-center text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
                >
                  <ChevronRight size={12} />
                </button>
              </div>
              <div className="flex-1 max-w-md mx-auto h-6 rounded-md bg-white dark:bg-[#0a0a0a] ring-1 ring-zinc-200 dark:ring-zinc-800 flex items-center gap-1.5 px-2.5 text-[11px] text-zinc-500">
                <Lock size={10} className="text-emerald-500" />
                <span className="text-zinc-400">https://</span>
                <span className="text-zinc-700 dark:text-zinc-300 truncate">
                  {state.kind === "generated"
                    ? slugFromTitle(state.result.meta.title)
                    : "yoursite.com"}
                </span>
              </div>
              <div className="w-14" />
            </div>

            <div
              className="relative bg-white dark:bg-zinc-950"
              style={{ height: state.kind === "generated" ? "auto" : 560 }}
            >
              {state.kind === "generated" && srcDoc && (
                <div
                  style={{
                    width: deviceWidth,
                    transform: `scale(${scale})`,
                    transformOrigin: "top left",
                    height: contentHeight,
                    marginBottom: -(1 - scale) * contentHeight,
                  }}
                >
                  <iframe
                    ref={iframeRef}
                    key={iframeKey}
                    title="Generated page preview"
                    srcDoc={srcDoc}
                    className="w-full border-0 bg-white block"
                    style={{ height: contentHeight }}
                    sandbox="allow-scripts"
                    scrolling="no"
                  />
                </div>
              )}
              {state.kind === "generating" && (
                <GeneratingState
                  currentStep={state.currentStep}
                  completedSteps={state.progress
                    .filter((p) => p.status === "completed")
                    .map((p) => p.step)}
                />
              )}
              {state.kind === "idle" && <EmptyState />}
              {state.kind === "error" && <ErrorState message={state.message} />}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function EmptyState() {
  return (
    <div className="h-full min-h-[560px] flex flex-col items-center justify-center p-10 text-center">
      <div className="w-full max-w-md space-y-3 mb-10">
        <div className="flex items-center justify-between">
          <div className="h-3 w-20 rounded-md skeleton" />
          <div className="flex gap-2">
            <div className="h-3 w-10 rounded-md skeleton" />
            <div className="h-3 w-10 rounded-md skeleton" />
            <div className="h-3 w-14 rounded-md skeleton" />
          </div>
        </div>
        <div className="pt-6 space-y-2.5">
          <div className="h-5 w-3/4 rounded-md skeleton" />
          <div className="h-5 w-2/3 rounded-md skeleton" />
          <div className="h-3 w-5/6 rounded-md skeleton mt-3" />
          <div className="h-3 w-3/5 rounded-md skeleton" />
        </div>
        <div className="flex gap-2 pt-4">
          <div className="h-8 w-24 rounded-lg skeleton" />
          <div className="h-8 w-20 rounded-lg skeleton" />
        </div>
      </div>

      <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-coral-50 dark:bg-coral-500/10 ring-1 ring-coral-200/60 dark:ring-coral-500/30 text-coral-600 dark:text-coral-400 mb-4">
        <Sparkles size={18} />
      </div>
      <div className="text-[15px] font-semibold tracking-tight">
        Your landing page will preview here
      </div>
      <p className="mt-1.5 max-w-sm text-sm text-zinc-500 dark:text-zinc-500">
        Describe what you want in the panel on the left. We&apos;ll generate a full
        page in under a minute.
      </p>
      <div className="mt-5 flex items-center gap-2 text-[11px] text-zinc-400">
        <kbd className="px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-900 ring-1 ring-zinc-200 dark:ring-zinc-800 font-mono">
          ⌘
        </kbd>
        <kbd className="px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-900 ring-1 ring-zinc-200 dark:ring-zinc-800 font-mono">
          ↵
        </kbd>
        to generate
      </div>
    </div>
  );
}

function GeneratingState({
  currentStep,
  completedSteps,
}: {
  currentStep: string;
  completedSteps: PipelineStep[];
}) {
  const currentLabel =
    STEP_LABELS[currentStep as PipelineStep] ?? "Working on it…";
  const completedCount = completedSteps.length;
  const totalSteps = ALL_STEPS.length;
  const progress = Math.min(
    100,
    Math.round(((completedCount + 0.5) / totalSteps) * 100),
  );

  return (
    <div className="h-full min-h-[560px] flex flex-col items-center justify-center p-10 text-center">
      <div className="relative h-12 w-12 mb-5">
        <span className="absolute inset-0 rounded-2xl bg-coral-500 opacity-20 animate-ping" />
        <span className="absolute inset-1 rounded-xl bg-coral-500 inline-flex items-center justify-center text-white">
          <Sparkles size={18} />
        </span>
      </div>
      <div className="text-[15px] font-semibold tracking-tight">{currentLabel}</div>
      <p className="mt-1.5 max-w-sm text-sm text-zinc-500 dark:text-zinc-500">
        Average build time is 47 seconds. Don&apos;t refresh — we&apos;ll stream when
        ready.
      </p>
      <div className="mt-6 w-64 h-1 rounded-full bg-zinc-100 dark:bg-zinc-900 overflow-hidden">
        <div
          className="h-full bg-coral-500 rounded-full transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>
      <ul className="mt-6 w-72 text-left space-y-1.5 text-[12px]">
        {ALL_STEPS.map((step) => {
          const done = completedSteps.includes(step);
          const active = step === currentStep && !done;
          return (
            <li
              key={step}
              className={cn(
                "flex items-center gap-2 px-2.5 py-1.5 rounded-md transition",
                active && "bg-coral-50 dark:bg-coral-500/10",
                done && "text-zinc-400 dark:text-zinc-600",
                !active && !done && "text-zinc-400 dark:text-zinc-600",
              )}
            >
              <span
                className={cn(
                  "inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border",
                  done
                    ? "bg-emerald-500 border-emerald-500 text-white"
                    : active
                      ? "border-coral-500"
                      : "border-zinc-300 dark:border-zinc-700",
                )}
              >
                {done && (
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none">
                    <polyline
                      points="20 6 9 17 4 12"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
                {active && (
                  <span className="h-1.5 w-1.5 rounded-full bg-coral-500 animate-pulse" />
                )}
              </span>
              <span
                className={cn(
                  active && "text-coral-700 dark:text-coral-300 font-medium",
                )}
              >
                {STEP_LABELS[step]}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="h-full min-h-[560px] flex flex-col items-center justify-center p-10 text-center">
      <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-red-50 dark:bg-red-500/10 ring-1 ring-red-200/60 dark:ring-red-500/30 text-red-600 dark:text-red-400 mb-4">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
          <path
            d="M12 8v4"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <path
            d="M12 16h.01"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </div>
      <div className="text-[15px] font-semibold tracking-tight">
        Generation failed
      </div>
      <p className="mt-1.5 max-w-md text-sm text-zinc-500 dark:text-zinc-500 break-words">
        {message}
      </p>
    </div>
  );
}

function buildSrcDoc(page: LandingPage): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(page.meta.title)}</title>
  <style>
    html, body { margin: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif; background: #fff; color: #111; }
    ${page.css}
  </style>
</head>
<body>
${page.html}
<script>
  (function () {
    var last = 0;
    function send() {
      var h = Math.max(
        document.documentElement.scrollHeight || 0,
        document.body.scrollHeight || 0,
        document.documentElement.offsetHeight || 0,
        document.body.offsetHeight || 0
      );
      if (h > 0 && h !== last) {
        last = h;
        try { parent.postMessage({ type: 'inari:height', height: h }, '*'); } catch (e) {}
      }
    }
    send();
    window.addEventListener('load', send);
    if (typeof ResizeObserver !== 'undefined') {
      try { new ResizeObserver(send).observe(document.body); } catch (e) {}
    }
    // Catch late image loads
    setTimeout(send, 100);
    setTimeout(send, 500);
    setTimeout(send, 1500);
    // Swallow same-page anchor navigation so clicks in preview don't reload
    document.addEventListener('click', function (e) {
      var t = e.target;
      while (t && t !== document.body) {
        if (t.tagName === 'A') { e.preventDefault(); return; }
        t = t.parentNode;
      }
    }, true);
  })();
</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function slugFromTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);
  return `${slug || "yoursite"}.com`;
}
