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

type Device = "desktop" | "tablet" | "mobile";
type Zoom = "50" | "75" | "100" | "fit";

interface PreviewAreaProps {
  doc: string;
  inlineEdit: boolean;
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
}

export function PreviewArea({
  doc,
  inlineEdit,
  previewUrl,
  templateName,
  onClearTemplate,
  onUseTemplate,
  useTemplateLoading = false,
}: PreviewAreaProps) {
  const [device, setDevice] = useState<Device>("desktop");
  const [zoom, setZoom] = useState<Zoom>("fit");
  const [gridOverlay, setGridOverlay] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [fitScale, setFitScale] = useState(1);

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
          <IconBtn
            label={gridOverlay ? "Hide grid overlay" : "Show grid overlay"}
            size="sm"
            active={gridOverlay}
            onClick={() => setGridOverlay((g) => !g)}
          >
            <Grid3 size={12} />
          </IconBtn>
          <IconBtn label="Refresh preview" size="sm">
            <RefreshCw size={12} />
          </IconBtn>
          <IconBtn label="Open in new tab" size="sm">
            <ExternalLink size={12} />
          </IconBtn>
        </div>
      </div>
      {inlineEdit && (
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
              key={previewUrl ?? doc.slice(0, 120)}
              {...(previewUrl
                ? { src: previewUrl }
                : { srcDoc: doc })}
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
    </section>
  );
}
