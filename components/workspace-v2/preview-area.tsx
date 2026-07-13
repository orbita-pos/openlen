// Preview area — viewport switcher + zoom toolbar + iframe srcdoc + grid
// overlay + inline-edit banner.

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  ExternalLink,
  Monitor,
  Pencil,
  RefreshCw,
  Smartphone,
  Tablet,
  X,
} from "./icons";
import { IconBtn, Segmented } from "./ui";
import { injectBehaviorsPreview, stashBehaviorsPristineState } from "./use-behaviors-preview";
import { injectDropPlace } from "./use-drop-place";
import { injectElementInspect } from "./use-element-inspect";
import { injectImageReplace } from "./use-image-replace";
import { injectInlineEdit } from "./use-inline-edit";
import { injectMotionPreview } from "./use-motion-preview";
import { motionCss, isMotionPreset } from "@/lib/publish/motion-presets";
import { injectMusicPreview } from "./use-music-preview";
import { isMusicSettings, musicCss, musicMarkup } from "@/lib/publish/music-player";
import type { MusicSettings } from "@/lib/projects/types";
import { injectSectionInsert } from "./use-section-insert";
import { injectSectionReorder } from "./use-section-reorder";
import { injectSectionSelect } from "./use-section-select";
import { PageBuildingLoader } from "./page-building-loader";
import { ScanOverlay } from "./scan-overlay";
import { coerceSceneSpec } from "@/lib/three3d/scene-spec";
import { backgroundCss } from "@/lib/three3d/background";
import { findBackdropTarget } from "@/lib/three3d/backdrop-placement";

// ---------------------------------------------------------------------------

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
  /** Apply-to-current-page mode (vs clone-into-new) — swaps the commit button
   *  label from "Use this template" to "Apply to my page". */
  templateApplyMode?: boolean;
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
   *  posted `openlen:section-insert` with the fragment `html` + `sectionType`
   *  (drives placement: navbar→top, footer→bottom, else→end); the iframe drops
   *  it into the page and posts back the changed HTML through the normal save
   *  path. */
  insertRequest?: {
    html: string;
    nonce: number;
    sectionType?: string;
    /** Body-relative :nth-of-type path to insert BEFORE (drop engine);
     *  omitted → the type-aware default placement. */
    anchorPath?: string;
  } | null;
  /** A pending Undo-of-insert. When `nonce` changes, the iframe is posted
   *  `openlen:section-remove`; it pulls the last-inserted nodes back out and
   *  re-serializes through the same save path — no reload (the live DOM is
   *  already correct, so we suppress the srcDoc re-derive like insert does). */
  removeRequest?: { nonce: number } | null;
  /** Motion Looks preset to preview live ("calm" | "editorial" | "dramatic").
   *  The iframe applies it via the motion-preview injector; re-posted on every
   *  iframe (re)load since the preview overlay isn't part of the saved doc.
   *  Undefined / invalid = no motion. */
  motionPreset?: string;
  /** Page-music track to preview live (settings.music). The iframe drops the
   *  real player via the music-preview injector; re-posted on every iframe
   *  (re)load. Null / undefined = no player. */
  musicTrack?: MusicSettings | null;
  /** Stable identity for the iframe `key` (the project id). The iframe should
   *  remount only on a genuine document switch — NOT on every content edit.
   *  Without this we key on `doc.slice(0,120)`, which a top-of-page insert (a
   *  prepended navbar) changes, forcing a remount that renders the stale
   *  pre-insert srcDoc and makes the just-added section vanish. */
  docKey?: string;
  /** True whenever a project is open in editing mode — arms the drop engine
   *  (drag an image from the OS / paste-then-place). Deliberately NOT tied to
   *  the edit toggle: dragging a file over the page is unambiguous intent, and
   *  the script is visually silent when idle. */
  dropEnabled?: boolean;
  /** Bump to suppress the NEXT doc-change reload (same mechanism the insert
   *  flow uses internally). The drop engine bumps it before a swap-asset /
   *  style-bg commit so the live-DOM apply doesn't get followed by a white
   *  srcDoc reload when the Edit toggle is off. */
  suppressReloadNonce?: number;
  /** 3D scene settings — consumed by Task 3 preview injection. Accepted here
   *  so the parent can pass it without a TS error before Task 3 lands. */
  scene3d?: { enabled?: boolean; spec?: unknown };
}

export function PreviewArea({
  doc,
  previewUrl,
  templateName,
  onClearTemplate,
  onUseTemplate,
  useTemplateLoading = false,
  templateApplyMode = false,
  editableInjection = false,
  openInNewTabUrl = null,
  sectionSelectMode = false,
  editingActive = false,
  onIframeRef,
  redesigning = false,
  inspectMode = false,
  onToggleInspect,
  insertRequest = null,
  removeRequest = null,
  motionPreset,
  musicTrack = null,
  docKey,
  dropEnabled = false,
  suppressReloadNonce = 0,
  scene3d,
}: PreviewAreaProps) {
  const t = useTranslations("wsChrome");
  const [device, setDevice] = useState<Device>("desktop");
  const [zoom, setZoom] = useState<Zoom>("fit");
  // On phone-sized screens the canvas pane is itself phone-sized — fitting
  // the 1280px desktop layout there renders an unreadable miniature. Default
  // to the mobile device once mounted; the segmented control still wins.
  const deviceTouchedRef = useRef(false);
  useEffect(() => {
    if (deviceTouchedRef.current) return;
    if (window.matchMedia("(max-width: 767px)").matches) setDevice("mobile");
  }, []);
  const [refreshTick, setRefreshTick] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeLocalRef = useRef<HTMLIFrameElement | null>(null);
  const [fitScale, setFitScale] = useState(1);
  const [scanBusy, setScanBusy] = useState(false);

  // Backdrop behind/around the iframe. The wrapper is a fixed-height "screen"
  // with rounded corners; a hardcoded white backdrop flashed a white band on
  // dark pages (during a heavy re-parse, on sub-pixel scale rounding, before
  // the srcDoc paints). Match it to the page's own background instead.
  const pageBg = useMemo(
    () => /--ol-bg\s*:\s*([^;"}]+)/i.exec(doc)?.[1]?.trim() || "#ffffff",
    [doc],
  );

  // Editor V3 — persistent iframe pattern. All 5 editor scripts are ALWAYS
  // injected into the srcDoc regardless of mode flags; each script gates its
  // interaction handlers + UI visibility on body[data-openlen-edit-mode] (or
  // data-openlen-select-mode for section-select). The iframe document never
  // reloads on a mode toggle — that's just a body attribute flip the parent
  // sends via postMessage. Eliminates the flicker, font-reload, and text
  // re-balance pass the old conditional-injection approach caused.
  const dropLabels = {
    replace: t("preview.drop.replace"),
    newSection: t("preview.drop.newSection"),
    background: t("preview.drop.background"),
    splitLeft: t("preview.drop.splitLeft"),
    splitRight: t("preview.drop.splitRight"),
    swap: t("preview.drop.swap"),
  };
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
    html = injectMotionPreview(html);
    html = injectMusicPreview(html);
    html = injectBehaviorsPreview(html);
    html = stashBehaviorsPristineState(html);
    html = injectDropPlace(html, dropLabels);
    return html;
  };
  const [stableSrcDoc, setStableSrcDoc] = useState<string>(() => derive(doc));
  const wasEditingRef = useRef(false);
  // Set when we post a section-insert to the iframe: the section is dropped into
  // the LIVE iframe DOM (appendChild) and the resulting html-changed updates
  // `doc`. We must NOT re-derive/reload for that update — reloading blanks the
  // iframe to white (the wrapper's bg-white) while a heavy page re-parses, which
  // reads as "a white block got added on insert". The live DOM already shows the
  // section; the saved html carries it for the next genuine re-derive.
  const skipInsertReloadRef = useRef(false);
  const lastSuppressNonce = useRef(suppressReloadNonce);
  useEffect(() => {
    if (suppressReloadNonce !== lastSuppressNonce.current) {
      lastSuppressNonce.current = suppressReloadNonce;
      skipInsertReloadRef.current = true;
    }
  }, [suppressReloadNonce]);
  // docKey is the DOCUMENT IDENTITY (project:page:undo-epoch). When it
  // changes, the editing-session skip below must not apply — the iframe is
  // remounting anyway (its key), and serving it the stale stableSrcDoc would
  // time-travel the canvas (an Undo or a page switch while the Edit toggle is
  // on). Re-derive unconditionally.
  const lastDocKeyRef = useRef(docKey);
  useEffect(() => {
    if (docKey === lastDocKeyRef.current) return;
    lastDocKeyRef.current = docKey;
    skipInsertReloadRef.current = false;
    wasEditingRef.current = false;
    setStableSrcDoc(derive(doc));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey]);
  useEffect(() => {
    if (skipInsertReloadRef.current) {
      skipInsertReloadRef.current = false;
      return;
    }
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
    dropEnabled,
  });
  useEffect(() => {
    modesRef.current = {
      editMode: editingActive,
      selectMode: sectionSelectMode,
      dropEnabled,
    };
    const iframe = iframeLocalRef.current;
    if (!iframe?.contentWindow) return;
    iframe.contentWindow.postMessage(
      { type: "openlen:set-mode", ...modesRef.current },
      "*",
    );
  }, [editingActive, sectionSelectMode, dropEnabled]);

  // Motion preview — the chosen preset's CSS, recomputed only when it changes.
  // Held in a ref so the iframe-ready handler (which re-posts on every reload,
  // since the preview overlay isn't part of the saved doc) reads the latest.
  const motionMsg = useMemo(() => {
    const preset = isMotionPreset(motionPreset) ? motionPreset : "";
    return {
      type: "openlen:apply-motion" as const,
      preset,
      css: preset ? motionCss(preset) : "",
    };
  }, [motionPreset]);
  const motionRef = useRef(motionMsg);
  motionRef.current = motionMsg;

  // Music preview — the saved track rendered to the same markup/CSS publish
  // bakes. Held in a ref for the iframe-ready re-post, like motion.
  const musicMsg = useMemo(() => {
    const track = isMusicSettings(musicTrack) ? musicTrack : null;
    return {
      type: "openlen:apply-music" as const,
      html: track ? musicMarkup(track) : "",
      css: track ? musicCss() : "",
    };
  }, [musicTrack]);
  const musicRef = useRef(musicMsg);
  musicRef.current = musicMsg;

  // 3D live preview — mirrors the bake's hero-scoped placement exactly.
  // For preset:"background": backdrop injected INSIDE the hero target as
  // position:absolute;inset:0;z-index:0. The target's position:relative and
  // content-above rule are applied via a tagged <style data-openlen-3d-preview>
  // (auto-stripped by all capture paths) — the hero element's attributes are
  // never mutated in the string so nothing persists into saved HTML.
  // For other presets: append before </body> as an inline block.
  // NOT gesture-gated in the editor (auto-mounts immediately).
  const finalSrcDoc = useMemo(() => {
    if (!scene3d?.enabled || !scene3d.spec) return stableSrcDoc;
    const spec = coerceSceneSpec(scene3d.spec);
    const bg = backgroundCss(spec);
    const isBackground = spec.preset === "background";
    const specJson = JSON.stringify(spec).replace(/</g, "\\u003c");

    const scriptSpec = `<script type="application/json" id="ol-3d-preview-spec" data-openlen-3d-preview>${specJson}</script>`;
    const scriptMount =
      `<script data-openlen-3d-preview>(function(){` +
      `var spec=JSON.parse(document.getElementById('ol-3d-preview-spec').textContent);` +
      `if(!('WebGLRenderingContext' in window))return;` +
      `var canvas=document.getElementById('ol-3d-preview-canvas');` +
      `window.addEventListener('pagehide',function(){if(window.__ol3dHandle)window.__ol3dHandle.dispose();});` +
      `var s=document.createElement('script');s.src='/api/three3d/runtime';` +
      `s.onload=function(){window.__ol3dHandle=window.OpenLen3D.mount(canvas,spec);};` +
      `document.head.appendChild(s);` +
      `})();</script>`;

    if (!isBackground) {
      // Accent/divider preset: append as inline block before </body>.
      const wrapperStyle = `position:relative;width:100%${bg ? `;background:${bg}` : ""}`;
      const layer =
        `<div id="ol-3d-preview-wrap" data-openlen-3d-preview style="${wrapperStyle}">` +
        `<canvas id="ol-3d-preview-canvas" style="display:block;width:100%;height:400px"></canvas>` +
        `</div>` +
        scriptSpec +
        scriptMount;
      const idx = stableSrcDoc.lastIndexOf("</body>");
      return idx === -1 ? stableSrcDoc + layer : stableSrcDoc.slice(0, idx) + layer + stableSrcDoc.slice(idx);
    }

    // Background preset: mirror bake's hero-scoped placement (procedural-3d.ts).
    // Uses z-index:-1 on the backdrop (same as bake). With isolation:isolate on
    // the target, z-index:-1 paints above the target's own background but below
    // ALL content — including Tailwind .absolute overlays at z-auto. No
    // content-above rule is emitted: it had specificity (1,1,0) which beat
    // Tailwind .absolute (0,1,0), collapsing overlay divs into normal flow.
    const target = findBackdropTarget(stableSrcDoc);
    const backdropStyle = `position:absolute;inset:0;z-index:-1;pointer-events:none;overflow:hidden${bg ? `;background:${bg}` : ""}`;
    const backdrop =
      `<div data-openlen-3d-preview style="${backdropStyle}">` +
      `<canvas id="ol-3d-preview-canvas" data-openlen-3d-preview style="position:absolute;inset:0;width:100%;height:100%"></canvas>` +
      `</div>`;

    if (!target) {
      // Fallback: no hero target found, append before </body>.
      const idx = stableSrcDoc.lastIndexOf("</body>");
      const layer = backdrop + scriptSpec + scriptMount;
      return idx === -1 ? stableSrcDoc + layer : stableSrcDoc.slice(0, idx) + layer + stableSrcDoc.slice(idx);
    }

    // Build a CSS selector from the shared finder result. Positioning rules live
    // in a tagged <style data-openlen-3d-preview> so they are stripped by all
    // capture paths (use-inline-edit, use-element-inspect, strip-editor-
    // instrumentation) and never reach the saved HTML. No child rule emitted.
    const heroSelector = target.cssSelector;
    const styleTag =
      `<style data-openlen-3d-preview>` +
      `${heroSelector}{position:relative;isolation:isolate}` +
      `</style>`;

    // Insert backdrop immediately inside the hero's opening tag, then append
    // the style + scripts before </body>.
    const result = stableSrcDoc.slice(0, target.tagEnd) + backdrop + stableSrcDoc.slice(target.tagEnd);
    const bodyClose = result.lastIndexOf("</body>");
    const tail = styleTag + scriptSpec + scriptMount;
    return bodyClose === -1 ? result + tail : result.slice(0, bodyClose) + tail + result.slice(bodyClose);
  }, [stableSrcDoc, scene3d]);

  // Section-insert plumbing. The fragment must land only AFTER the iframe
  // runtime is listening — on a fresh PreviewArea mount (e.g. returning from the
  // Modules view, which unmounts this component) the iframe is still loading, so
  // a message posted the instant contentWindow exists is silently dropped. We
  // gate the post on readiness and (re)flush it from the iframe-ready handler.
  const lastInsertNonce = useRef<number>(0);
  const iframeReadyRef = useRef(false);
  const insertReqRef = useRef(insertRequest);
  insertReqRef.current = insertRequest;
  const flushInsert = useRef<() => void>(() => {});
  flushInsert.current = () => {
    const req = insertReqRef.current;
    if (!req || req.nonce === lastInsertNonce.current) return;
    const win = iframeLocalRef.current?.contentWindow;
    if (!win) return;
    lastInsertNonce.current = req.nonce;
    // Don't let the resulting html-changed reload the iframe (it would blank to
    // white); the section is injected into the live DOM directly.
    skipInsertReloadRef.current = true;
    win.postMessage(
      {
        type: "openlen:section-insert",
        html: req.html,
        sectionType: req.sectionType,
        anchorPath: req.anchorPath,
      },
      "*",
    );
  };

  // On iframe ready (fresh load, or post-srcDoc-change reload), push the
  // current mode + motion + music state so the iframe matches the parent — and
  // flush any pending section-insert that arrived before the runtime listened.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!e.data || typeof e.data !== "object") return;
      if (e.data.type !== "openlen:iframe-ready") return;
      const win = iframeLocalRef.current?.contentWindow;
      if (!win) return;
      iframeReadyRef.current = true;
      win.postMessage({ type: "openlen:set-mode", ...modesRef.current }, "*");
      win.postMessage(motionRef.current, "*");
      win.postMessage(musicRef.current, "*");
      flushInsert.current();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Live re-apply when the user picks a different motion bead (no reload).
  useEffect(() => {
    iframeLocalRef.current?.contentWindow?.postMessage(motionMsg, "*");
  }, [motionMsg]);

  // Live re-apply when the track changes (upload / retitle / remove).
  useEffect(() => {
    iframeLocalRef.current?.contentWindow?.postMessage(musicMsg, "*");
  }, [musicMsg]);

  // When the parent bumps the insert nonce: post now if the iframe is already
  // ready (Library-tab insert while on the canvas); otherwise defer — the
  // iframe-ready handler flushes it once the runtime is listening.
  useEffect(() => {
    if (iframeReadyRef.current) flushInsert.current();
  }, [insertRequest]);

  // Undo-of-insert — mirror of the insert effect. The iframe removes the
  // last-inserted nodes from the LIVE DOM and re-serializes; suppress the
  // resulting re-derive so the preview doesn't reload (and flash white) for a
  // change the DOM already reflects.
  const lastRemoveNonce = useRef<number>(0);
  useEffect(() => {
    if (!removeRequest || removeRequest.nonce === lastRemoveNonce.current) return;
    const iframe = iframeLocalRef.current;
    if (!iframe?.contentWindow) return;
    lastRemoveNonce.current = removeRequest.nonce;
    skipInsertReloadRef.current = true;
    iframe.contentWindow.postMessage({ type: "openlen:section-remove" }, "*");
  }, [removeRequest]);

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
          onChange={(d) => {
            deviceTouchedRef.current = true;
            setDevice(d);
          }}
          options={[
            { value: "desktop", label: "", ariaLabel: t("preview.viewport.desktop"), icon: Monitor },
            { value: "tablet", label: "", ariaLabel: t("preview.viewport.tablet"), icon: Tablet },
            { value: "mobile", label: "", ariaLabel: t("preview.viewport.mobile"), icon: Smartphone },
          ]}
        />
        <span className="hidden sm:block h-5 w-px bg-[color:var(--border)]" />
        <div className="hidden sm:inline-flex items-center gap-0.5 rounded-md border bd bg-elev p-0.5">
          {(["50", "75", "100", "fit"] as const).map((z) => (
            <button
              key={z}
              type="button"
              onClick={() => setZoom(z)}
              className={`h-6 px-2 text-[11px] font-medium tabular rounded transition ui-small ${
                zoom === z ? "bg-app fg shadow-card" : "fg-faint hover:fg"
              }`}
            >
              {z === "fit" ? t("preview.zoomFit") : `${z}%`}
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
              label={
                inspectMode
                  ? t("preview.toolbar.exitEdit")
                  : t("preview.toolbar.editPage")
              }
              size="sm"
              active={inspectMode}
              onClick={onToggleInspect}
            >
              <Pencil size={12} />
            </IconBtn>
          )}
          <IconBtn
            label={t("preview.toolbar.refresh")}
            size="sm"
            onClick={() => setRefreshTick((tick) => tick + 1)}
          >
            <RefreshCw size={12} />
          </IconBtn>
          {openInNewTabUrl && (
            <IconBtn
              label={t("preview.toolbar.openNewTab")}
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
          {t.rich("preview.banner.sectionSelect", {
            kbd: () => (
              <kbd className="px-1 rounded bg-elev border bd font-mono text-[10px]">
                ESC
              </kbd>
            ),
          })}
        </div>
      )}
      {editableInjection && !sectionSelectMode && (
        <div className="relative z-10 shrink-0 h-7 flex items-center justify-center gap-2 text-[11.5px] bg-accent-soft text-accent border-b bd ui-small fade-in">
          <Pencil size={11} />{" "}
          {t.rich("preview.banner.inlineEdit", {
            kbd: () => (
              <kbd className="px-1 rounded bg-elev border bd font-mono text-[10px]">
                ESC
              </kbd>
            ),
          })}
        </div>
      )}
      {previewUrl && (
        <div className="relative z-10 shrink-0 h-9 flex items-center px-3 gap-3 text-[11.5px] bg-accent-soft text-accent border-b bd ui-small fade-in">
          <span className="font-medium">
            {templateName
              ? t("preview.templateBanner.previewingNamed", {
                  name: templateName,
                })
              : t("preview.templateBanner.previewing")}
          </span>
          <span className="fg-faint hidden sm:inline">·</span>
          <span className="fg-muted hidden sm:inline">
            {t("preview.templateBanner.readOnly")}
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            {onUseTemplate && (
              <button
                type="button"
                onClick={onUseTemplate}
                disabled={useTemplateLoading}
                className="inline-flex items-center gap-1 h-6 px-2 rounded bg-[var(--accent-strong)] text-white text-[11px] font-medium hover:brightness-105 shadow-coral transition disabled:opacity-60 disabled:cursor-wait"
              >
                {useTemplateLoading ? (
                  <>
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-white/80 animate-pulse" />
                    {t(templateApplyMode ? "preview.templateBanner.applying" : "preview.templateBanner.cloning")}
                  </>
                ) : (
                  <>{t(templateApplyMode ? "preview.templateBanner.apply" : "preview.templateBanner.use")}</>
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
                <X size={10} /> {t("preview.templateBanner.clear")}
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
            className="rounded-xl ring-1 ring-[color:var(--border)] overflow-hidden shadow-card relative"
            style={{ height: 800 * scale, background: pageBg }}
          >
            <iframe
              key={`${previewUrl ?? docKey ?? doc.slice(0, 120)}:${refreshTick}`}
              ref={(el) => {
                iframeLocalRef.current = el;
                if (onIframeRef) onIframeRef(el);
              }}
              {...(previewUrl
                ? { src: previewUrl }
                : { srcDoc: finalSrcDoc })}
              title={t("preview.iframeTitle")}
              sandbox="allow-scripts allow-same-origin"
              style={{
                width: deviceWidth,
                height: 800,
                transform: `scale(${scale})`,
                transformOrigin: "top left",
                border: 0,
                background: pageBg,
                filter: scanBusy ? "saturate(.82)" : undefined,
                transition: "filter .35s",
              }}
            />
            <ScanOverlay onBusyChange={setScanBusy} />
          </div>
        </div>
      </div>
      {redesigning && (
        <div className="absolute inset-0 z-40">
          <PageBuildingLoader caption={t("preview.redesigning")} />
        </div>
      )}
    </section>
  );
}
