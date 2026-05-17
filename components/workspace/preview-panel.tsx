"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Lock,
  Monitor,
  PanelRightOpen,
  Pencil,
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
import { GeneratingView } from "./generating-view";
import type { WorkspaceState } from "./types";

type Device = "desktop" | "tablet" | "mobile";
type Zoom = "50" | "75" | "100" | "fit";

const DEVICE_WIDTHS: Record<Device, number> = {
  desktop: 1280,
  tablet: 820,
  mobile: 390,
};

export interface PreviewPanelProps {
  state: WorkspaceState;
  panelOpen: boolean;
  onOpenPanel: () => void;
  onRegenSection?: (sectionId: string, sectionName: string) => void;
  onEditSection?: (sectionId: string, sectionName: string) => void;
  /** When provided, the preview header shows a "Edit content" button that
   *  toggles the sidebar slot editor. The page-level component owns the
   *  edit-mode state because it spans two panels. */
  editMode?: boolean;
  onToggleEdit?: () => void;
  /** Session 12 — editor-mode HTML (carries `data-slot-path` + contenteditable
   *  spans). Used for srcDoc when `editMode` is on; otherwise the iframe
   *  shows the clean `state.result.html`. */
  editorHtml?: string | null;
  /** Session 12 — callback when an inline edit is committed in the iframe.
   *  The page-level component handles state + reassemble. */
  onSlotEdit?: (message: { path: string; value: string }) => void;
}

export function PreviewPanel({
  state,
  panelOpen,
  onOpenPanel,
  onRegenSection,
  onEditSection,
  editMode,
  onToggleEdit,
  editorHtml,
  onSlotEdit,
}: PreviewPanelProps) {
  const [device, setDevice] = useState<Device>("desktop");
  const [zoom, setZoom] = useState<Zoom>("fit");
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [fitScale, setFitScale] = useState(1);
  const [iframeKey, setIframeKey] = useState(0);
  const [contentHeight, setContentHeight] = useState(1200);

  const deviceWidth = DEVICE_WIDTHS[device];

  // Include state.kind so the observer attaches the first time the container
  // div mounts (during "idle"/"generating" it isn't in the tree because the
  // component returns early). Without this, fitScale stays at 1 when the
  // page first finishes generating, leaving the iframe at desktop width and
  // making the user click a device tab to nudge the layout.
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
  }, [deviceWidth, state.kind]);

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
    return buildSrcDoc(state.result, {
      editMode: editMode === true,
      editorHtml: editorHtml ?? null,
    });
  }, [state, editMode, editorHtml]);

  // The iframe self-reports its document height + section-overlay clicks via
  // postMessage (script injected by buildSrcDoc). This avoids parent-side
  // contentDocument access, which is finicky around iframe load timing and
  // sandboxing — and it lets the wrapper match the real height so the
  // dotted-bg outer container owns the only scroll.
  useEffect(() => {
    if (!srcDoc) {
      setContentHeight(1200);
      return;
    }
    const iframe = iframeRef.current;
    const onMessage = (e: MessageEvent) => {
      if (iframe && e.source && e.source !== iframe.contentWindow) return;
      const data = e.data;
      if (!data || typeof data !== "object") return;
      if (data.type === "inari:height" && typeof data.height === "number" && data.height > 0) {
        setContentHeight(data.height);
        return;
      }
      if (data.type === "inari:regen" && typeof data.sectionId === "string") {
        onRegenSection?.(data.sectionId, data.sectionName ?? data.sectionId);
        return;
      }
      if (data.type === "inari:edit" && typeof data.sectionId === "string") {
        onEditSection?.(data.sectionId, data.sectionName ?? data.sectionId);
        return;
      }
      // Session 12 — inline text edit committed from inside the iframe.
      if (
        data.type === "openlen-edit" &&
        typeof data.path === "string" &&
        typeof data.value === "string"
      ) {
        onSlotEdit?.({ path: data.path, value: data.value });
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [srcDoc, iframeKey, onRegenSection, onEditSection, onSlotEdit]);

  // The generating view is full-bleed — it owns its own chrome (orchestra
  // strip, browser frame, step pipeline) so we bypass the device tabs and
  // mock browser when in that state.
  if (state.kind === "generating") {
    const completedSteps = state.progress
      .filter((p) => p.status === "completed")
      .map((p) => p.step);
    return (
      <section className="md:flex-1 md:min-h-0 min-h-[600px] flex flex-col">
        <GeneratingView
          partial={state.partial}
          currentStep={state.currentStep as PipelineStep}
          completedSteps={completedSteps}
        />
      </section>
    );
  }

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
          {state.kind === "generated" && onToggleEdit && (
            <button
              type="button"
              onClick={onToggleEdit}
              aria-pressed={editMode === true}
              className={cn(
                "inline-flex items-center gap-1.5 h-7 px-2.5 mr-1 text-[12px] font-medium rounded-md transition ring-1",
                editMode
                  ? "bg-coral-500 text-white ring-coral-500 hover:bg-coral-600"
                  : "bg-white dark:bg-[#0a0a0a] text-zinc-700 dark:text-zinc-300 ring-zinc-200 dark:ring-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900",
              )}
            >
              <Pencil size={11} />
              <span className="hidden sm:inline">Edit content</span>
              <span className="sm:hidden">Edit</span>
            </button>
          )}
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
              {state.kind === "generated" && state.regen && (
                <div className="absolute top-3 left-1/2 -translate-x-1/2 z-40 inline-flex items-center gap-2 h-8 px-3 rounded-full bg-zinc-900 text-white text-[12px] shadow-lg shadow-black/20">
                  <span className="inline-flex h-2 w-2 rounded-full bg-coral-400 animate-pulse" />
                  {state.regen.mode === "edit" ? "Applying edit to" : "Regenerating"}{" "}
                  <span className="font-semibold">{state.regen.sectionName}</span>
                  <span className="text-zinc-400">· ~10s</span>
                </div>
              )}
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
                    className={cn(
                      "w-full border-0 bg-white block transition-opacity",
                      state.kind === "generated" && state.regen && "opacity-60",
                    )}
                    style={{ height: contentHeight }}
                    sandbox="allow-scripts"
                    scrolling="no"
                    onLoad={() => {
                      // Backstop in case the iframe's first script-side
                      // sendHeight fired before the parent attached the
                      // window message listener. We ping the iframe and it
                      // replies with its current height.
                      iframeRef.current?.contentWindow?.postMessage(
                        { type: "inari:request-height" },
                        "*",
                      );
                    }}
                  />
                </div>
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

interface BuildSrcDocOptions {
  editMode: boolean;
  editorHtml: string | null;
}

function buildSrcDoc(page: LandingPage, options: BuildSrcDocOptions): string {
  // In edit mode we prefer the editor-mode HTML the server rendered (with
  // data-slot-path spans). If it hasn't arrived yet on the very first
  // toggle, fall back to the clean HTML — the iframe-editor.js will simply
  // find zero editable spans and stand by until the next reassemble lands.
  const bodyHtml =
    options.editMode && options.editorHtml ? options.editorHtml : page.html;
  const editorScriptTag = options.editMode
    ? '<script src="/iframe-editor.js" defer></script>'
    : "";
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
    /* Inari section-overlay UI — added at runtime, never affects layout */
    .__inari-overlay { position: absolute; inset: 0; pointer-events: none; z-index: 9999; opacity: 0; transition: opacity 120ms ease; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif; }
    section:hover > .__inari-overlay, footer:hover > .__inari-overlay { opacity: 1; }
    .__inari-frame { position: absolute; inset: 0; outline: 2px solid rgba(255, 90, 54, 0.7); outline-offset: -2px; }
    .__inari-name { position: absolute; top: 8px; left: 8px; background: rgba(24, 24, 27, 0.95); color: #fff; font-size: 11px; font-weight: 500; padding: 4px 8px; border-radius: 6px; display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; box-shadow: 0 2px 8px rgba(0,0,0,0.18); }
    .__inari-name > i { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #FF7E55; }
    .__inari-actions { position: absolute; top: 8px; right: 8px; display: inline-flex; align-items: center; background: rgba(24, 24, 27, 0.95); color: #fff; border-radius: 6px; padding: 4px; pointer-events: auto; box-shadow: 0 2px 8px rgba(0,0,0,0.18); gap: 2px; }
    .__inari-actions button { background: transparent; border: 0; color: inherit; font: inherit; font-size: 11px; font-weight: 500; padding: 4px 8px; border-radius: 4px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
    .__inari-actions button:hover { background: rgba(255, 255, 255, 0.15); }
    .__inari-sep { width: 1px; align-self: stretch; background: rgba(255, 255, 255, 0.15); margin: 2px 0; }
  </style>
</head>
<body>
${bodyHtml}
${editorScriptTag}
<script>
  (function () {
    var last = 0;
    function sendHeight() {
      var body = document.body;
      if (!body) return;
      var h = body.scrollHeight;
      if (h > 0 && h !== last) {
        last = h;
        try { parent.postMessage({ type: 'inari:height', height: h }, '*'); } catch (e) {}
      }
    }

    var NAME_MAP = { hero: 'Hero', features: 'Features', cta: 'CTA', pricing: 'Pricing', testimonials: 'Testimonials', faq: 'FAQ', social_proof: 'Social proof', footer: 'Footer' };
    function sectionName(el, idx) {
      if (el.tagName === 'FOOTER') return 'Footer';
      var cls = (el.className || '').split(/\\s+/)[0] || '';
      if (NAME_MAP[cls]) return NAME_MAP[cls];
      if (cls) return cls.charAt(0).toUpperCase() + cls.slice(1);
      return 'Section ' + (idx + 1);
    }
    function sectionId(el, idx) {
      // Prefer the explicit data-section-id from the html generator. Fall back
      // to the first class name + index so legacy outputs without the attr
      // still produce a deterministic id.
      var explicit = el.getAttribute && el.getAttribute('data-section-id');
      if (explicit) return explicit;
      var cls = (el.className || '').split(/\\s+/)[0] || 'section';
      return cls + '-' + idx;
    }

    var REGEN_SVG = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/></svg>';
    var EDIT_SVG = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/></svg>';

    function decorate() {
      var nodes = document.querySelectorAll('section, footer');
      for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        if (node.querySelector(':scope > .__inari-overlay')) continue;
        if (getComputedStyle(node).position === 'static') node.style.position = 'relative';
        var name = sectionName(node, i);
        var sid = sectionId(node, i);
        var overlay = document.createElement('div');
        overlay.className = '__inari-overlay';
        overlay.innerHTML =
          '<div class="__inari-frame"></div>' +
          '<div class="__inari-name"><i></i>' + name + '</div>' +
          '<div class="__inari-actions">' +
            '<button type="button" data-action="regen" data-section-id="' + sid + '" data-section-name="' + name + '">' + REGEN_SVG + ' Regenerate</button>' +
            '<span class="__inari-sep"></span>' +
            '<button type="button" data-action="edit" data-section-id="' + sid + '" data-section-name="' + name + '">' + EDIT_SVG + ' Edit prompt</button>' +
          '</div>';
        node.appendChild(overlay);
      }
    }

    document.addEventListener('click', function (e) {
      var t = e.target;
      // Overlay actions
      while (t && t.nodeType === 1) {
        if (t.hasAttribute && t.hasAttribute('data-action')) {
          e.preventDefault();
          e.stopPropagation();
          try {
            parent.postMessage({
              type: 'inari:' + t.getAttribute('data-action'),
              sectionId: t.getAttribute('data-section-id'),
              sectionName: t.getAttribute('data-section-name')
            }, '*');
          } catch (err) {}
          return;
        }
        if (t.tagName === 'A') { e.preventDefault(); return; }
        t = t.parentNode;
      }
    }, true);

    // Parent can ping us via postMessage; reply with current height. This is
    // the backstop for races where the parent's window-message listener
    // wasn't attached yet when our initial sendHeight() fired.
    window.addEventListener('message', function (e) {
      if (e.data && e.data.type === 'inari:request-height') {
        last = 0; // force send even if same as before
        sendHeight();
      }
    });

    sendHeight();
    decorate();
    window.addEventListener('load', function () { sendHeight(); decorate(); });
    if (typeof ResizeObserver !== 'undefined') {
      try { new ResizeObserver(sendHeight).observe(document.body); } catch (e) {}
    }
    setTimeout(function () { sendHeight(); decorate(); }, 100);
    setTimeout(function () { sendHeight(); decorate(); }, 500);
    setTimeout(function () { sendHeight(); decorate(); }, 1500);
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
