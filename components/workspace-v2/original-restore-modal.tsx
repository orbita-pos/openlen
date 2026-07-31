// «Volver al original» — confirm modal before resetting the WHOLE document
// (not just the theme) to its baseline version. Mirrors the overlay shell +
// sandboxed preview idiom of VersionPreviewModal (panels/versions-panel.tsx)
// so this reads as the same product, not a bolted-on dialog.
//
// The restore itself is non-destructive: POST …/versions/[vid]/restore
// snapshots the CURRENT state first, so this is always undoable from
// Versions — the note under the header says so.

"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { RotateCcw } from "lucide-react";
import { useFocusTrap } from "./use-focus-trap";
import { Loader } from "./icons";

interface OriginalRestoreModalProps {
  open: boolean;
  projectId: string;
  versionId: string;
  /** True while the restore POST is in flight — disables both buttons and
   *  the backdrop/Escape dismiss so a click can't abandon it mid-write. */
  restoring?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function OriginalRestoreModal({
  open,
  projectId,
  versionId,
  restoring = false,
  onCancel,
  onConfirm,
}: OriginalRestoreModalProps) {
  const t = useTranslations("panelsProps");
  const [mounted, setMounted] = useState(false);
  const [frameLoaded, setFrameLoaded] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Reset the loading shimmer whenever a new version's preview is requested.
  useEffect(() => {
    setFrameLoaded(false);
  }, [versionId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !restoring) {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, restoring, onCancel]);

  const trapRef = useFocusTrap(open && mounted);

  if (!mounted || !open) return null;

  const overlay = (
    <div
      className="workspace-v2 fixed inset-0 z-[100] flex bg-black/55 backdrop-blur-sm fade-in"
      onClick={() => {
        if (!restoring) onCancel();
      }}
    >
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="original-restore-title"
        className="m-3 md:m-6 flex-1 min-w-0 flex flex-col rounded-xl bg-elev border bd shadow-elev overflow-hidden slide-down"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 px-3.5 py-2.5 border-b bd flex items-center gap-2">
          <RotateCcw size={14} className="fg-muted" aria-hidden />
          <h3
            id="original-restore-title"
            className="text-[13px] font-semibold fg leading-tight flex-1 min-w-[140px] font-display"
          >
            {t("original.title")}
          </h3>
        </div>
        <div className="relative flex-1 min-h-0 bg-white">
          {!frameLoaded && (
            <div className="absolute inset-0 flex items-center justify-center fg-faint">
              <Loader size={18} className="animate-spin" />
            </div>
          )}
          <iframe
            src={`/api/projects/${projectId}/versions/${versionId}/raw`}
            title={t("original.title")}
            // Preview del baseline: sin allow-same-origin (nadie lee su
            // contentDocument) para que un script no herede nuestro origen.
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
            onLoad={() => setFrameLoaded(true)}
            className="w-full h-full"
            style={{
              border: 0,
              opacity: frameLoaded ? 1 : 0,
              transition: "opacity 300ms ease",
            }}
          />
        </div>
        <div className="shrink-0 px-3.5 py-2.5 border-t bd flex items-center justify-between gap-3 bg-app">
          <p className="text-[10.5px] fg-faint leading-relaxed flex-1 min-w-0">
            {t("original.note")}
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onCancel}
              disabled={restoring}
              className="h-7.5 px-3 rounded-md text-[12px] font-medium fg-muted hover:fg hover:bg-hover transition disabled:opacity-40"
            >
              {t("original.cancel")}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={restoring}
              className="inline-flex items-center gap-1.5 h-7.5 px-3 rounded-md bg-[color:var(--accent)] text-white text-[12px] font-medium hover:brightness-105 active:brightness-95 shadow-coral transition disabled:opacity-60"
            >
              {restoring && <Loader size={12} className="animate-spin" />}
              {t("original.confirm")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}
