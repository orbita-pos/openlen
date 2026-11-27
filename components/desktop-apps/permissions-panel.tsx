"use client";

// «PERMISOS» (spec local 2026-11-27-notificaciones-del-escritorio, §4.5, §7.2), like Claude's «Permissions…»: opened from the
// strip, next to «Acerca de», or by the app's `permissions.manage()`. It lists what the app DECLARED, each with its state;
// what can be granted (`notifications`) has a switch, what a PWA can't have reads «Not available in the browser». A browser
// that blocks OpenLen's notifications is explained, since only the person can lift that — in the browser's own settings.
// With the notifications off in OpenLen there is one line and nothing else; while the window can't tell which version its
// frame runs (still checking, or two versions after an update), one line that says so and to reload.
//
// Like Claude's Permissions dialog it is MODAL over the window, with «Cancel» and «Save»: the switches only change a draft,
// and nothing is stored until «Save» (Cancel and Escape discard it). «Save» ignores clicks for a moment after the panel
// shows (`manage()` opens it at a moment the app chose: a click it timed must not land on it). Storing is the host's
// (`use-app-api-host.ts`): on goes through the browser's own prompt in that same click; off is a «no».
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { GRANTABLE, type DesktopPermission } from "@/lib/desktop-apps/permissions/declared";
import type { PermissionState } from "@/lib/desktop-apps/permissions/grants";

import { INPUT_GUARD_MS } from "./permission-dialog";

export interface PermissionChange {
  permission: DesktopPermission;
  on: boolean;
}

export interface PermissionsPanelProps {
  appName: string;
  notificationsOn: boolean;
  /** What the app declared, each with its state now. */
  rows: { permission: DesktopPermission; state: PermissionState }[];
  /** The window doesn't know yet which version its frame runs, or holds two: like Claude's «You cannot change permissions
   *  here: the artifact is still loading…», it says so instead of the list (which would read as «asked for none»). */
  unknown?: boolean;
  /** The browser can make a Notification in this window. */
  supported: boolean;
  /** The browser blocks notifications for openlen.com. */
  browserBlocked: boolean;
  /** «Save», inside its click: only what the person switched to something other than it is now. Never called empty. */
  onSave(changes: PermissionChange[]): void;
  onClose(): void;
  /** OpenLen's approval dialog is on top: Escape is its answer, not this panel's. */
  covered?: boolean;
}

const BUTTON =
  "inline-flex h-8 items-center rounded-lg px-3 text-[12.5px] font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-ring)]";

export function PermissionsPanel(p: PermissionsPanelProps) {
  const t = useTranslations("wsChrome.desktop.permissions");
  const close = useRef(p.onClose);
  close.current = p.onClose;
  const covered = useRef(p.covered === true);
  covered.current = p.covered === true;
  // What the person switched, and to what: the draft. Rows not in it show their state now.
  const [draft, setDraft] = useState<Partial<Record<DesktopPermission, boolean>>>({});
  const shownAt = useRef(Date.now());
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !covered.current) close.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const canChange = (permission: DesktopPermission) => p.supported && GRANTABLE.includes(permission);
  const blockedLine = p.unknown !== true && p.browserBlocked && p.rows.some((r) => canChange(r.permission));
  const changeable = p.unknown !== true && p.notificationsOn && p.rows.some((r) => canChange(r.permission));
  const isOn = (permission: DesktopPermission, state: PermissionState) => draft[permission] ?? state === "granted";

  const save = () => {
    if (Date.now() - shownAt.current < INPUT_GUARD_MS) return;
    const changes = p.rows
      .filter((r) => canChange(r.permission) && draft[r.permission] !== undefined && draft[r.permission] !== (r.state === "granted"))
      .map((r) => ({ permission: r.permission, on: draft[r.permission]! }));
    if (changes.length > 0) p.onSave(changes);
    p.onClose();
  };

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4" data-desktop-permissions-backdrop>
      <div
        className="bg-elev bd shadow-elev w-full max-w-sm rounded-xl border p-4"
        data-desktop-permissions
        role="dialog"
        aria-modal="true"
        aria-label={t("title", { app: p.appName })}
      >
        <p className="fg text-[14px] font-semibold break-words">{t("title", { app: p.appName })}</p>
        {!p.notificationsOn ? (
          <p className="fg-muted mt-2 text-[12.5px] leading-relaxed">{t("off")}</p>
        ) : p.unknown === true ? (
          <p className="fg-muted mt-2 text-[12.5px] leading-relaxed">{t("unknown")}</p>
        ) : p.rows.length === 0 ? (
          <p className="fg-muted mt-2 text-[12.5px] leading-relaxed">{t("empty")}</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {p.rows.map(({ permission, state }) => (
              <li key={permission} className="flex items-start justify-between gap-3">
                <span className="min-w-0">
                  <span className="fg block text-[13px] font-medium">{t(`names.${permission}`)}</span>
                  <span className="fg-faint block text-[11.5px] leading-snug">
                    {canChange(permission) ? t("detail.notifications") : t("notInBrowser")}
                  </span>
                </span>
                {canChange(permission) ? (
                  <button
                    type="button"
                    role="switch"
                    aria-checked={isOn(permission, state)}
                    aria-label={t(`names.${permission}`)}
                    onClick={() => setDraft((d) => ({ ...d, [permission]: !isOn(permission, state) }))}
                    className={`relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent-ring)] ${
                      isOn(permission, state) ? "bg-[var(--accent-strong)]" : "bg-hover"
                    }`}
                  >
                    <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition ${isOn(permission, state) ? "translate-x-4" : "translate-x-0.5"}`} />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {p.notificationsOn && blockedLine ? <p className="mt-2 text-[12px] leading-relaxed text-[var(--nc-warn)]">{t("browserBlocked")}</p> : null}
        <div className="mt-4 flex justify-end gap-2">
          {changeable ? (
            <>
              <button ref={first} type="button" className={`${BUTTON} bd fg border hover:bg-hover`} onClick={p.onClose}>
                {t("cancel")}
              </button>
              <button type="button" className={`${BUTTON} bg-[var(--accent-strong)] text-white hover:opacity-90`} onClick={save}>
                {t("save")}
              </button>
            </>
          ) : (
            <button ref={first} type="button" className={`${BUTTON} fg-muted hover:bg-hover`} onClick={p.onClose}>
              {t("close")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
