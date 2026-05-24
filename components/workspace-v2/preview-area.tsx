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
  SquareDashed,
  Tablet,
  X,
} from "./icons";
import { IconBtn, Segmented } from "./ui";
import { injectElementInspect } from "./use-element-inspect";
import { injectImageReplace } from "./use-image-replace";
import { injectInlineEdit } from "./use-inline-edit";
import { injectModelSelect } from "./use-model-select";
import { injectSectionReorder } from "./use-section-reorder";
import { injectSectionSelect } from "./use-section-select";
import { PageBuildingLoader } from "./page-building-loader";
import { compile } from "@/lib/doc/compile";
import type { Document as DocModel, NodeId } from "@/lib/doc/model";

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
  /** Canva-mode source: when set, the iframe srcDoc is compiled FROM this
   *  Document (with data-ol-id markers) instead of from `doc`. All toolbar
   *  features (device, zoom, fit, grid, refresh, open-in-tab) stay active.
   *  Click-to-select wiring posts back the clicked node's id via
   *  `onModelNodeSelect`. */
  modelDoc?: DocModel;
  /** Currently-selected model node ids — mirrored back into the iframe so
   *  the in-iframe outlines reflect external selection changes (e.g. from the
   *  inspector's breadcrumb or the Layers tree). One id = single selection;
   *  multiple = shift-click multi-select. Empty = nothing selected. */
  modelSelectedIds?: NodeId[];
  /** Fires when the user changes selection in the canvas (click / shift-click
   *  / Escape). Array semantics match modelSelectedIds. */
  onModelSelect?: (ids: NodeId[]) => void;
  /** Fires when the user double-clicks a Text-leaf in the canvas, edits in
   *  place, then commits (blur or Enter). The parent should dispatch
   *  editSetProps to overwrite the node's runs. */
  onModelTextEdit?: (id: NodeId, text: string) => void;
  /** Fires after a drag-to-reorder drop inside the canvas. `toIndex` is in
   *  editMove's after-detach semantics — pass straight to the op builder. */
  onModelReorder?: (id: NodeId, toParentId: NodeId, toIndex: number) => void;
  /** Fires after a resize-handle drag ends. width/height are CSS strings
   *  (e.g. "320px") — apply via editSetStyle on the base layer. */
  onModelResize?: (id: NodeId, width: string, height: string) => void;
  /** Fires when the user presses ⌘D / Ctrl+D inside the iframe with at
   *  least one selection. The parent owns selection state, so it pulls
   *  the current ids from its own state. */
  onModelDuplicate?: () => void;
  /** Fires on Del / Backspace inside the iframe (with selection). Same
   *  contract as onModelDuplicate — parent reads its own selection. */
  onModelDelete?: () => void;
  /** Fires when a context-menu item is clicked in the iframe. `action` is
   *  one of: duplicate, delete, group, ungroup, wrap, moveUp, moveDown. */
  onModelAction?: (action: string) => void;
  /** Fires on ⌘Z / ⌘⇧Z inside the iframe. `redo` true = redo, false = undo. */
  onModelUndo?: (redo: boolean) => void;
}

// Stable empty-array default so a missing prop doesn't re-trigger the iframe
// sync effect on every render.
const EMPTY_IDS: never[] = [];

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
  modelDoc,
  modelSelectedIds = EMPTY_IDS,
  onModelSelect,
  onModelTextEdit,
  onModelReorder,
  onModelResize,
  onModelDuplicate,
  onModelDelete,
  onModelAction,
  onModelUndo,
}: PreviewAreaProps) {
  const [device, setDevice] = useState<Device>("desktop");
  const [zoom, setZoom] = useState<Zoom>("fit");
  const [gridOverlay, setGridOverlay] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeLocalRef = useRef<HTMLIFrameElement | null>(null);
  const [fitScale, setFitScale] = useState(1);

  // srcDoc snapshot — re-derived only when an injection mode flips, or
  // when `doc` (or `modelDoc`) changes outside of an active in-place
  // mutation session.
  //
  // Priority order:
  //   modelDoc         → compile + inject model-select (Canva-mode path)
  //   section-select   → ONLY select script (Crosshair from chat takes over)
  //   editingActive    → reorder + replace (always); inline-edit if also flat
  //   else             → raw doc, no scripts (preview-like default)
  //
  // The user enters editing mode by clicking the Content (pencil) tab.
  // Other tabs (Chat, Pages, Versions, etc.) leave the iframe clean —
  // no hover outlines, no drag handles, just the page.
  const derive = (
    rawDoc: string,
    edit: boolean,
    select: boolean,
    editing: boolean,
    inspect: boolean,
    model: DocModel | undefined,
  ): string => {
    if (model) {
      // Compile the Document to HTML each call. The compiler attaches
      // data-ol-id markers ({ ids: true }) so the inject script can resolve
      // a click to a stable node id.
      return injectModelSelect(compile(model, { ids: true }));
    }
    if (select) return injectSectionSelect(rawDoc);
    if (inspect) return injectElementInspect(rawDoc);
    if (!editing) return rawDoc;
    // Replace BEFORE Reorder so Replace's mousemove listener registers
    // first → fires first on each event → sets the `over-image` body
    // attribute before Reorder's listener reads it. Avoids a one-frame
    // flicker where the drag handle briefly appears over an image.
    let html = injectImageReplace(rawDoc);
    html = injectSectionReorder(html);
    if (edit) html = injectInlineEdit(html);
    return html;
  };
  const [stableSrcDoc, setStableSrcDoc] = useState<string>(() =>
    derive(
      doc,
      editableInjection,
      sectionSelectMode,
      editingActive,
      inspectMode,
      modelDoc,
    ),
  );
  const prevInjectionRef = useRef({
    edit: editableInjection,
    select: sectionSelectMode,
    editing: editingActive,
    inspect: inspectMode,
    model: !!modelDoc,
  });
  useEffect(() => {
    const prev = prevInjectionRef.current;
    const modeChanged =
      prev.edit !== editableInjection ||
      prev.select !== sectionSelectMode ||
      prev.editing !== editingActive ||
      prev.inspect !== inspectMode ||
      prev.model !== !!modelDoc;
    prevInjectionRef.current = {
      edit: editableInjection,
      select: sectionSelectMode,
      editing: editingActive,
      inspect: inspectMode,
      model: !!modelDoc,
    };
    if (modeChanged) {
      setStableSrcDoc(
        derive(
          doc,
          editableInjection,
          sectionSelectMode,
          editingActive,
          inspectMode,
          modelDoc,
        ),
      );
      return;
    }
    // Inline-edit and inspect are the surfaces where a mid-session doc
    // update would wreck live state (a cursor inside a contentEditable, or
    // the inspect script's selection). Every other surface (default
    // preview, section-select, editingActive but not text-edit, AND
    // modelDoc edits) mirrors doc updates so chat completions, undo,
    // restore, palette swaps, etc. show up live.
    if (!editableInjection && !inspectMode) {
      setStableSrcDoc(
        derive(
          doc,
          editableInjection,
          sectionSelectMode,
          editingActive,
          inspectMode,
          modelDoc,
        ),
      );
    }
  }, [
    doc,
    modelDoc,
    editableInjection,
    sectionSelectMode,
    editingActive,
    inspectMode,
  ]);

  // Bridge: listen for model-select + model-text-edit postMessages from the
  // iframe and forward to the parent. Also push external selection changes
  // (e.g. inspector breadcrumb) back into the iframe so the outline stays
  // in sync.
  useEffect(() => {
    if (!modelDoc) return;
    const onMsg = (e: MessageEvent): void => {
      const d = e.data;
      if (!d || typeof d !== "object") return;
      if (d.type === "openlen:model-select") {
        if (Array.isArray(d.ids)) {
          const ids: string[] = [];
          for (const x of d.ids) if (typeof x === "string") ids.push(x);
          onModelSelect?.(ids);
          return;
        }
        // Legacy single-id shape — still accepted in case anything else posts it.
        if (typeof d.id === "string") {
          onModelSelect?.([d.id]);
          return;
        }
        if (d.id === null) {
          onModelSelect?.([]);
        }
        return;
      }
      if (d.type === "openlen:model-text-edit") {
        if (typeof d.id !== "string" || typeof d.text !== "string") return;
        onModelTextEdit?.(d.id, d.text);
        return;
      }
      if (d.type === "openlen:model-reorder") {
        if (
          typeof d.id !== "string" ||
          typeof d.toParentId !== "string" ||
          typeof d.toIndex !== "number"
        )
          return;
        onModelReorder?.(d.id, d.toParentId, d.toIndex);
        return;
      }
      if (d.type === "openlen:model-resize") {
        if (
          typeof d.id !== "string" ||
          typeof d.width !== "string" ||
          typeof d.height !== "string"
        )
          return;
        onModelResize?.(d.id, d.width, d.height);
        return;
      }
      if (d.type === "openlen:model-duplicate") {
        onModelDuplicate?.();
        return;
      }
      if (d.type === "openlen:model-delete") {
        onModelDelete?.();
        return;
      }
      if (d.type === "openlen:model-action") {
        if (typeof d.action !== "string") return;
        onModelAction?.(d.action);
        return;
      }
      if (d.type === "openlen:model-undo") {
        onModelUndo?.(!!d.redo);
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [
    modelDoc,
    onModelSelect,
    onModelTextEdit,
    onModelReorder,
    onModelResize,
    onModelDuplicate,
    onModelDelete,
    onModelAction,
    onModelUndo,
  ]);

  // Push external selection changes (Layers click, inspector breadcrumb) into
  // the iframe so its outlines mirror parent state without an iframe reload.
  useEffect(() => {
    if (!modelDoc) return;
    const w = iframeLocalRef.current?.contentWindow;
    if (!w) return;
    w.postMessage(
      { type: "openlen:model-set-selected", ids: modelSelectedIds },
      "*",
    );
  }, [modelDoc, modelSelectedIds]);

  const deviceWidth = { desktop: 1280, tablet: 820, mobile: 390 }[device];

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const compute = () => {
      const cw = el.clientWidth;
      const ch = el.clientHeight;
      const availW = cw - 24;
      const availH = ch - 24;
      const sW = availW / deviceWidth;
      const sH = availH / 800;
      setFitScale(Math.min(1, sW, sH));
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
              label={inspectMode ? "Exit inspector" : "Inspect elements"}
              size="sm"
              active={inspectMode}
              onClick={onToggleInspect}
            >
              <SquareDashed size={12} />
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
              key={`${modelDoc ? "model" : (previewUrl ?? doc.slice(0, 120))}:${refreshTick}`}
              ref={(el) => {
                iframeLocalRef.current = el;
                if (onIframeRef) onIframeRef(el);
              }}
              onLoad={(e) => {
                // After each srcDoc reload, re-push the selection so the
                // model-select outlines survive the model edit that caused
                // the reload.
                if (modelDoc && modelSelectedIds.length > 0) {
                  try {
                    const w = (e.currentTarget as HTMLIFrameElement)
                      .contentWindow;
                    w?.postMessage(
                      {
                        type: "openlen:model-set-selected",
                        ids: modelSelectedIds,
                      },
                      "*",
                    );
                  } catch {
                    /* ignore */
                  }
                }
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
