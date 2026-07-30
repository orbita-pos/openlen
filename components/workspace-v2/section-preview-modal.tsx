// Section preview dialog. Clicking a library card opens this — it shows ONLY
// the section (its own original design, at desktop/mobile width), NOT in the
// user's page. The single commit action, "Use on my page", calls the parent to
// MATCH-then-insert: the section is recoloured to the host palette server-side
// and dropped in already themed (a section never lands raw — the user rejected
// that). So this modal is purely "do I like this section's layout?"; the colour
// fit is handled on commit.

"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Monitor, Smartphone, Sparkles, X } from "./icons";
import { useFocusTrap } from "./use-focus-trap";
import type { SectionSpec } from "./sections-data";

type Device = "desktop" | "mobile";

interface Props {
  section: SectionSpec;
  /** True while the prepare (match) + insert round-trip is in flight. */
  using: boolean;
  /** Localized error to surface under the action (e.g. out of credits). */
  error?: string | null;
  onUse: (section: SectionSpec) => void;
  onClose: () => void;
}

const DEVICE_WIDTH: Record<Device, number> = { desktop: 1280, mobile: 390 };

export function SectionPreviewModal({
  section,
  using,
  error = null,
  onUse,
  onClose,
}: Props) {
  const t = useTranslations("panelsA");
  const [device, setDevice] = useState<Device>("desktop");
  const stageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const trapRef = useFocusTrap(true);

  // Esc closes (but not mid-commit).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !using) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, using]);

  // Fit the native-width preview into the stage.
  const deviceWidth = DEVICE_WIDTH[device];
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const compute = () => {
      const avail = el.clientWidth - 24;
      setScale(Math.min(1, avail / deviceWidth));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [deviceWidth]);

  const stageHeight = 760;

  return (
    <div
      className="workspace-v2 fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm fade-in p-0 sm:p-6"
      onClick={() => {
        if (!using) onClose();
      }}
    >
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label={section.variantLabel}
        onClick={(e) => e.stopPropagation()}
        className="relative flex flex-col w-full max-w-5xl max-h-[92vh] rounded-t-2xl sm:rounded-2xl bg-elev border bd shadow-elev overflow-hidden slide-down"
      >
        {/* Header */}
        <div className="shrink-0 h-12 px-4 flex items-center gap-3 border-b bd">
          <h2 className="text-[13px] font-semibold fg leading-tight truncate">
            {section.variantLabel}
          </h2>
          {section.needsJs && (
            <span className="text-[8.5px] uppercase tracking-[0.12em] px-1 py-0.5 rounded fg-faint bg-hover font-semibold">
              JS
            </span>
          )}
          <div className="ml-auto inline-flex items-center gap-0.5 rounded-md border bd bg-app p-0.5">
            {(["desktop", "mobile"] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDevice(d)}
                aria-label={t(d === "desktop" ? "sections.viewDesktop" : "sections.viewMobile")}
                className={`inline-flex items-center justify-center h-6 w-7 rounded transition ${
                  device === d ? "bg-elev fg shadow-card" : "fg-faint hover:fg"
                }`}
              >
                {d === "desktop" ? <Monitor size={13} /> : <Smartphone size={13} />}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={using}
            aria-label={t("sections.close")}
            className="inline-flex items-center justify-center h-7 w-7 rounded-full fg-faint hover:fg hover:bg-hover transition disabled:opacity-50"
          >
            <X size={14} />
          </button>
        </div>

        {/* Stage — the section, isolated */}
        <div
          ref={stageRef}
          className="relative flex-1 min-h-0 overflow-auto nice-scroll bg-preview-a p-3 flex justify-center"
        >
          <div
            className="relative rounded-lg ring-1 ring-[color:var(--border)] overflow-hidden bg-white shadow-card"
            style={{ width: deviceWidth * scale, height: stageHeight * scale }}
          >
            <iframe
              key={`${section.id}:${device}`}
              src={section.previewUrl}
              title={section.variantLabel}
              // Solo pinta /api/sections/<id>/preview, que ya se sirve con
              // CSP sandbox; sin allow-same-origin aquí tampoco, para no
              // depender de un único control.
              sandbox="allow-scripts"
              style={{
                width: deviceWidth,
                height: stageHeight,
                transform: `scale(${scale})`,
                transformOrigin: "top left",
                border: 0,
              }}
            />
          </div>
        </div>

        {/* Footer — single commit action */}
        <div className="shrink-0 px-4 py-3 border-t bd flex items-center gap-3">
          <p className="text-[11.5px] fg-muted leading-snug min-w-0 flex-1">
            {error ? (
              <span className="text-rose-600 dark:text-rose-400">{error}</span>
            ) : (
              t("sections.useHint")
            )}
          </p>
          <button
            type="button"
            onClick={() => onUse(section)}
            disabled={using}
            className="shrink-0 inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[var(--accent-strong)] text-white text-[12.5px] font-semibold shadow-coral hover:brightness-105 transition disabled:opacity-60 disabled:cursor-wait"
          >
            {using ? (
              <>
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-white/80 animate-pulse" />
                {t("sections.preparing")}
              </>
            ) : (
              <>
                <Sparkles size={14} />
                {t("sections.useOnPage")}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
