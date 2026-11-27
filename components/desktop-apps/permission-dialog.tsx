"use client";

// OPENLEN'S APPROVAL DIALOG (spec local 2026-11-27-notificaciones-del-escritorio, §4.3): drawn by the WINDOW (openlen.com),
// never by the app, with Claude's copy and Claude's buttons — «Don't allow» is the default (focused), «Allow» the other. Escape
// closes it WITHOUT an answer, as closing Claude's does: only the «Don't allow» button saves a «no» (spec §4.3). Asking again after the app changed says why. Only `notifications` can be granted, so the copy is its.
// What an answer DOES (saving, asking the browser) is the host's (`use-app-api-host.ts`); this only draws and reports.
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef } from "react";

export interface PermissionDialogProps {
  appName: string;
  /** A «yes» of another version or installation: «Keep allowing…» and the line that says why. */
  reask: boolean;
  /** Called inside the click, so the browser's own prompt can follow in the same gesture. */
  onAllow(): void;
  onDeny(): void;
  /** Escape: closed without an answer — nothing is saved. */
  onDismiss(): void;
}

/** How long after OpenLen's dialog or «Permisos» appears a click that grants is ignored (a click the app timed). */
export const INPUT_GUARD_MS = 500;

const BUTTON =
  "inline-flex h-8 items-center rounded-lg px-3 text-[12.5px] font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-ring)]";

export function PermissionDialog({ appName, reask, onAllow, onDeny, onDismiss }: PermissionDialogProps) {
  const t = useTranslations("wsChrome.desktop.permissions.dialog");
  const titleId = useId();
  const bodyId = useId();
  const deny = useRef<HTMLButtonElement>(null);
  const dismissNow = useRef(onDismiss);
  dismissNow.current = onDismiss;
  // The app chooses the instant this appears and knows where «Allow» will be: a click it timed (a double click it asked
  // for, a «click fast here») must not land on it. «Allow» ignores clicks for a moment after it shows; «Don't allow» never does.
  const shownAt = useRef(Date.now());
  const allow = () => {
    if (Date.now() - shownAt.current < INPUT_GUARD_MS) return;
    onAllow();
  };

  useEffect(() => {
    deny.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      dismissNow.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4" data-desktop-permission-dialog>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        className="bg-elev bd shadow-elev w-full max-w-sm rounded-xl border p-4"
      >
        <h2 id={titleId} className="fg text-[14px] font-semibold">
          {reask ? t("reaskTitle", { app: appName }) : t("title", { app: appName })}
        </h2>
        <div id={bodyId} className="fg-muted mt-1 space-y-1 text-[12.5px] leading-relaxed">
          {reask ? <p>{t("reaskBody")}</p> : null}
          <p>{t("body")}</p>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button ref={deny} type="button" className={`${BUTTON} bd fg border hover:bg-hover`} onClick={onDeny}>
            {t("deny")}
          </button>
          <button type="button" className={`${BUTTON} bg-[var(--accent-strong)] text-white hover:opacity-90`} onClick={allow}>
            {t("allow")}
          </button>
        </div>
      </div>
    </div>
  );
}
