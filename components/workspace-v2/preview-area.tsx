// Preview area — viewport switcher + zoom toolbar + iframe srcdoc + grid
// overlay + inline-edit banner.

"use client";

import { useEffect, useRef, useState } from "react";
import {
  ExternalLink,
  Grid3,
  Monitor,
  Pencil,
  RefreshCw,
  Smartphone,
  Tablet,
  X,
} from "./icons";
import { IconBtn, Segmented } from "./ui";
import { injectElementInspect } from "./use-element-inspect";
import { injectImageReplace } from "./use-image-replace";
import { injectInlineEdit } from "./use-inline-edit";
import { injectSectionInsert } from "./use-section-insert";
import { injectSectionReorder } from "./use-section-reorder";
import { injectSectionSelect } from "./use-section-select";
import { PageBuildingLoader } from "./page-building-loader";

type Device = "desktop" | "tablet" | "mobile";
type Zoom = "50" | "75" | "100" | "fit";

interface PreviewAreaProps {
  doc: string;
  /** When set, the iframe loads this URL directly (a curated template from
   *  /public/templates/curated/) instead of using the composed-from-primitives
   *  HTML in `doc`. Cleared via `onClearTemplate`. */
  previewUrl?: string | null;
  templateName?: string | null;
  onClearTemplate?: () => void;
  /** When a template is being previewed, this commits the choice — the
   *  parent runs the from-template API call and redirects to the new
   *  project. Shown as the primary action button in the template banner. */
  onUseTemplate?: () => void;
  useTemplateLoading?: boolean;
  /** When true, srcDoc is run through the inline-edit injector (see
   *  use-inline-edit.ts) and the "Click any text…" hint banner is shown.
   *  Active when the parent has the Content sidebar tab open on a flat
   *  project — rich projects use the slot-based editor and don't go
   *  through this path. We snapshot the derived srcDoc on toggle change
   *  so live keystrokes (which the parent mirrors back into `doc` via
   *  postMessage) don't churn the iframe. */
  editableInjection?: boolean;
  /** URL to open in a new tab when the user clicks the "Open in new tab"
   *  toolbar button. Parent computes: published subdomain → /api/projects/<id>/raw
   *  → templates URL → null. When null, the toolbar button is hidden. */
  openInNewTabUrl?: string | null;
  /** When true, srcDoc is run through the section-select injector (see
   *  use-section-select.ts). Takes priority over editableInjection — the
   *  iframe enters click-to-select mode + shows a banner. The parent
   *  listens for `openlen:section-selected` / `openlen:section-select-
   *  cancelled` postMessages to capture the result and flip this off. */
  sectionSelectMode?: boolean;
  /** True when the user is on the Content tab — gates ALL editing
   *  affordances (drag handles, replace hover buttons, image click-to-
   *  swap, plus inline-edit if the project is flat). When false, the
   *  iframe shows the page exactly as a visitor would. */
  editingActive?: boolean;
  /** Callback fired with the iframe element after mount. Parent stashes
   *  this to send `openlen:swap-asset` messages back to the iframe when
   *  the user picks a new asset in the Replace modal. */
  onIframeRef?: (iframe: HTMLIFrameElement | null) => void;
  /** True while a Chat redesign is streaming — overlays the page-building
   *  loader on the whole preview so the user doesn't watch the raw drip. */
  redesigning?: boolean;
  /** When true, the iframe runs the element-inspect script (Phase 1
   *  properties panel) — exclusive, like sectionSelectMode. srcDoc is
   *  frozen so live property edits don't trigger a reload. */
  inspectMode?: boolean;
  /** Toggles inspect mode from the preview toolbar. Omitted (e.g. in
   *  template-preview) hides the toolbar button. */
  onToggleInspect?: () => void;
  /** A pending section-insert request. When `nonce` changes, the iframe is
   *  posted `openlen:section-insert` with the fragment `html`; the iframe
   *  drops it into the page and posts back the changed HTML through the
   *  normal save path. */
  insertRequest?: { html: string; nonce: number } | null;
}

export function PreviewArea({
  doc,
  previewUrl,
  templateName,
  onClearTemplate,
  onUseTemplate,
  useTemplateLoading = false,
  editableInjection = false,
  openInNewTabUrl = null,
  sectionSelectMode = false,
  editingActive = false,
  onIframeRef,
  redesigning = false,
  inspectMode = false,
  onToggleInspect,
  insertRequest = null,
}: PreviewAreaProps) {
  const [device, setDevice] = useState<Device>("desktop");
  const [zoom, setZoom] = useState<Zoom>("fit");
  const [gridOverlay, setGridOverlay] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeLocalRef = useRef<HTMLIFrameElement | null>(null);
  const [fitScale, setFitScale] = useState(1);

  // Editor V3 — persistent iframe pattern. All 5 editor scripts are ALWAYS
  // injected into the srcDoc regardless of mode flags; each script gates its
  // interaction handlers + UI visibility on body[data-openlen-edit-mode] (or
  // data-openlen-select-mode for section-select). The iframe document never
  // reloads on a mode toggle — that's just a body attribute flip the parent
  // sends via postMessage. Eliminates the flicker, font-reload, and text
  // re-balance pass the old conditional-injection approach caused.
  const derive = (rawDoc: string): string => {
    // Replace BEFORE Reorder so Replace's mousemove listener registers
    // first → fires first on each event → sets the `over-image` body
    // attribute before Reorder's listener reads it. Avoids a one-frame
    // flicker where the drag handle briefly appears over an image.
    let html = injectImageReplace(rawDoc);
    html = injectSectionReorder(html);
    html = injectElementInspect(html);
    html = injectInlineEdit(html);
    html = injectSectionSelect(html);
    html = injectSectionInsert(html);
    return html;
  };
  const [stableSrcDoc, setStableSrcDoc] = useState<string>(() => derive(doc));
  const wasEditingRef = useRef(false);
  useEffect(() => {
    // While editing is active a mid-session `doc` update would wreck live
    // state (an open overlay editor, the inspect script's selected node).
    // Skip the reload in that window. The post-edit save round-trips the
    // updated doc back; once editing closes we pick it up.
    if (editingActive) {
      wasEditingRef.current = true;
      return;
    }
    // Just LEFT an editing session: the iframe DOM holds the user's latest
    // edits (inline-edit commits + flushes a final html-changed on exit) and
    // that save is in flight. Skip this one re-derive so a now-stale `doc`
    // doesn't clobber the live DOM before the flush lands; the incoming
    // html-changed updates `doc` and re-derives with the fresh HTML next pass.
    if (wasEditingRef.current) {
      wasEditingRef.current = false;
      return;
    }
    setStableSrcDoc(derive(doc));
  }, [doc, editingActive]);

  // Mode sync — every flag change becomes a postMessage to the iframe. The
  // iframe's bootstrap (in use-inline-edit.ts) translates this into body
  // attrs that every other script gates on. No srcDoc change, no remount.
  const modesRef = useRef({
    editMode: editingActive,
    selectMode: sectionSelectMode,
  });
  useEffect(() => {
    modesRef.current = {
      editMode: editingActive,
      selectMode: sectionSelectMode,
    };
    const iframe = iframeLocalRef.current;
    if (!iframe?.contentWindow) return;
    iframe.contentWindow.postMessage(
      { type: "openlen:set-mode", ...modesRef.current },
      "*",
    );
  }, [editingActive, sectionSelectMode]);

  // On iframe ready (fresh load, or post-srcDoc-change reload), push the
  // current mode state so the iframe matches the parent immediately.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!e.data || typeof e.data !== "object") return;
      if (e.data.type !== "openlen:iframe-ready") return;
      iframeLocalRef.current?.contentWindow?.postMessage(
        { type: "openlen:set-mode", ...modesRef.current },
        "*",
      );
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Section-insert — when the parent bumps the request nonce (user clicked
  // Insert in the Library tab), post the fragment into the live iframe. The
  // injected script (use-section-insert.ts) drops it in and posts the changed
  // HTML back through the normal openlen:html-changed save path.
  const lastInsertNonce = useRef<number>(0);
  useEffect(() => {
    if (!insertRequest || insertRequest.nonce === lastInsertNonce.current) return;
    const iframe = iframeLocalRef.current;
    if (!iframe?.contentWindow) return;
    lastInsertNonce.current = insertRequest.nonce;
    iframe.contentWindow.postMessage(
      { type: "openlen:section-insert", html: insertRequest.html },
      "*",
    );
  }, [insertRequest]);

  const deviceWidth = { desktop: 1280, tablet: 820, mobile: 390 }[device];

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    // ResizeObserver loop guard: opening the right Properties panel resizes
    // this container, and the scaled wrapper inside it can land right at the
    // boundary where overflow:auto toggles a scrollbar. That 15px swing
    // changes clientWidth → new scale → new wrapper width → scrollbar flips
    // back → loop, until the page locks up.
    // Two-part fix: (1) rAF throttle so a burst of resize fires within one
    // frame collapses to a single compute; (2) deadband so scale changes
    // below ~1% (invisible to the eye) don't re-trigger the layout.
    let rafId: number | null = null;
    const compute = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        const cw = el.clientWidth;
        const ch = el.clientHeight;
        const availW = cw - 24;
        const availH = ch - 24;
        const sW = availW / deviceWidth;
        const sH = availH / 800;
        const next = Math.min(1, sW, sH);
        setFitScale((prev) => (Math.abs(next - prev) < 0.005 ? prev : next));
      });
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [deviceWidth]);

  const scale =
    zoom === "fit"
      ? fitScale
      : zoom === "100"
        ? 1
        : zoom === "75"
          ? 0.75
          : zoom === "50"
            ? 0.5
            : 1;

  return (
    <section className="relative flex flex-col flex-1 min-w-0 bg-preview-a">
      <div className="relative z-20 h-10 shrink-0 px-2.5 flex items-center gap-2 border-b bd bg-app/85 backdrop-blur">
        <Segmented<Device>
          size="sm"
          value={device}
          onChange={setDevice}
          options={[
            { value: "desktop", label: "", icon: Monitor },
            { value: "tablet", label: "", icon: Tablet },
            { value: "mobile", label: "", icon: Smartphone },
          ]}
        />
        <span className="h-5 w-px bg-[color:var(--border)]" />
        <div className="inline-flex items-center gap-0.5 rounded-md border bd bg-elev p-0.5">
          {(["50", "75", "100", "fit"] as const).map((z) => (
            <button
              key={z}
              type="button"
              onClick={() => setZoom(z)}
              className={`h-6 px-2 text-[11px] font-medium tabular rounded transition ui-small ${
                zoom === z ? "bg-app fg shadow-card" : "fg-faint hover:fg"
              }`}
            >
              {z === "fit" ? "Fit" : `${z}%`}
            </button>
          ))}
        </div>
        <div className="hidden lg:inline-flex items-center gap-1.5 text-[10.5px] fg-faint tabular ui-small px-1">
          <span className="fg-muted font-medium">{deviceWidth}</span>
          <span>×</span>
          <span>800</span>
          <span className="fg-faint">·</span>
          <span>{Math.round(scale * 100)}%</span>
        </div>
        <div className="ml-auto flex items-center gap-0.5">
          {onToggleInspect && (
            <IconBtn
              label={inspectMode ? "Exit edit mode (⌘E)" : "Edit page (⌘E)"}
              size="sm"
              active={inspectMode}
              onClick={onToggleInspect}
            >
              <Pencil size={12} />
            </IconBtn>
          )}
          <IconBtn
            label={gridOverlay ? "Hide grid overlay" : "Show grid overlay"}
            size="sm"
            active={gridOverlay}
            onClick={() => setGridOverlay((g) => !g)}
          >
            <Grid3 size={12} />
          </IconBtn>
          <IconBtn
            label="Refresh preview"
            size="sm"
            onClick={() => setRefreshTick((t) => t + 1)}
          >
            <RefreshCw size={12} />
          </IconBtn>
          {openInNewTabUrl && (
            <IconBtn
              label="Open in new tab"
              size="sm"
              onClick={() => {
                window.open(
                  openInNewTabUrl,
                  "_blank",
                  "noopener,noreferrer",
                );
              }}
            >
              <ExternalLink size={12} />
            </IconBtn>
          )}
        </div>
      </div>
      {sectionSelectMode && (
        <div className="relative z-10 shrink-0 h-7 flex items-center justify-center gap-2 text-[11.5px] bg-accent-soft text-accent border-b bd ui-small fade-in">
          <span className="inline-flex h-3 w-3 items-center justify-center rounded-full ring-1 ring-[color:var(--accent)]">
            <span className="block h-1 w-1 rounded-full bg-[var(--accent)]" />
          </span>
          Click any section to scope your next chat ·{" "}
          <kbd className="px-1 rounded bg-elev border bd font-mono text-[10px]">
            ESC
          </kbd>{" "}
          to cancel
        </div>
      )}
      {editableInjection && !sectionSelectMode && (
        <div className="relative z-10 shrink-0 h-7 flex items-center justify-center gap-2 text-[11.5px] bg-accent-soft text-accent border-b bd ui-small fade-in">
          <Pencil size={11} /> Click any text in the page to edit it inline ·{" "}
          <kbd className="px-1 rounded bg-elev border bd font-mono text-[10px]">
            ESC
          </kbd>{" "}
          to cancel
        </div>
      )}
      {previewUrl && (
        <div className="relative z-10 shrink-0 h-9 flex items-center px-3 gap-3 text-[11.5px] bg-accent-soft text-accent border-b bd ui-small fade-in">
          <span className="font-medium">
            Previewing{templateName ? `: ${templateName}` : " template"}
          </span>
          <span className="fg-faint hidden sm:inline">·</span>
          <span className="fg-muted hidden sm:inline">
            Read-only — nothing saved until you commit
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            {onUseTemplate && (
              <button
                type="button"
                onClick={onUseTemplate}
                disabled={useTemplateLoading}
                className="inline-flex items-center gap-1 h-6 px-2 rounded bg-[var(--accent)] text-white text-[11px] font-medium hover:brightness-105 shadow-coral transition disabled:opacity-60 disabled:cursor-wait"
              >
                {useTemplateLoading ? (
                  <>
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-white/80 animate-pulse" />
                    Cloning…
                  </>
                ) : (
                  <>Use this template →</>
                )}
              </button>
            )}
            {onClearTemplate && (
              <button
                type="button"
                onClick={onClearTemplate}
                disabled={useTemplateLoading}
                className="inline-flex items-center gap-1 h-6 px-2 rounded bg-app/40 hover:bg-app/70 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <X size={10} /> Clear
              </button>
            )}
          </div>
        </div>
      )}
      <div
        ref={containerRef}
        className="relative flex-1 overflow-auto nice-scroll p-3 sm:p-4"
      >
        <div
          className="mx-auto relative"
          style={{ width: deviceWidth * scale }}
        >
          <div
            className="rounded-xl ring-1 ring-[color:var(--border)] overflow-hidden bg-white shadow-card relative"
            style={{ height: 800 * scale }}
          >
            <iframe
              key={`${previewUrl ?? doc.slice(0, 120)}:${refreshTick}`}
              ref={(el) => {
                iframeLocalRef.current = el;
                if (onIframeRef) onIframeRef(el);
              }}
              {...(previewUrl
                ? { src: previewUrl }
                : { srcDoc: stableSrcDoc })}
              title="OpenLen workspace preview"
              sandbox="allow-scripts allow-same-origin"
              style={{
                width: deviceWidth,
                height: 800,
                transform: `scale(${scale})`,
                transformOrigin: "top left",
                border: 0,
              }}
              className="bg-white"
            />
            {gridOverlay && (
              <div
                className="absolute inset-0 pointer-events-none"
                style={{
                  backgroundImage: `linear-gradient(to right, rgba(255,90,54,0.18) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,90,54,0.18) 1px, transparent 1px)`,
                  backgroundSize: `${64 * scale}px ${64 * scale}px`,
                }}
              />
            )}
          </div>
        </div>
      </div>
      {redesigning && (
        <div className="absolute inset-0 z-40">
          <PageBuildingLoader caption="Redesigning your page…" />
        </div>
      )}
    </section>
  );
}
