"use client";

// «PERMISOS» (spec local 2026-11-27-notificaciones-del-escritorio, §4.5, §7.2), like Claude's «Permissions…»: opened from the
// strip, next to «Acerca de», or by the app's `permissions.manage()`. It lists what the app DECLARED, each with its state;
// what can be granted (`notifications`) has a switch, what a PWA can't have reads «Not available in the browser». A browser
// that blocks OpenLen's notifications is explained, since only the person can lift that — in the browser's own settings.
// With the notifications off in OpenLen there is one line and nothing else. Switching is the host's (`use-app-api-host.ts`):
// on goes through the browser's own prompt in the same click; off is a «no».
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";

import { GRANTABLE, type DesktopPermission } from "@/lib/desktop-apps/permissions/declared";
import type { PermissionState } from "@/lib/desktop-apps/permissions/grants";

export interface PermissionsPanelProps {
  appName: string;
  notificationsOn: boolean;
  /** What the app declared, each with its state now. */
  rows: { permission: DesktopPermission; state: PermissionState }[];
  /** The browser can make a Notification in this window. */
  supported: boolean;
  /** The browser blocks notifications for openlen.com. */
  browserBlocked: boolean;
  onToggle(permission: DesktopPermission, on: boolean): void;
  onClose(): void;
}

export function PermissionsPanel(p: PermissionsPanelProps) {
  const t = useTranslations("wsChrome.desktop.permissions");
  const close = useRef(p.onClose);
  close.current = p.onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const canChange = (permission: DesktopPermission) => p.supported && GRANTABLE.includes(permission);
  const blockedLine = p.browserBlocked && p.rows.some((r) => canChange(r.permission));

  return (
    <div
      className="bg-elev bd shadow-elev fixed right-2 top-8 z-30 w-80 max-w-[calc(100vw-1rem)] rounded-xl border p-3"
      data-desktop-permissions
      role="dialog"
      aria-label={t("title", { app: p.appName })}
    >
      <p className="fg text-[14px] font-semibold break-words">{t("title", { app: p.appName })}</p>
      {!p.notificationsOn ? (
        <p className="fg-muted mt-2 text-[12.5px] leading-relaxed">{t("off")}</p>
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
                  aria-checked={state === "granted"}
                  aria-label={t(`names.${permission}`)}
                  onClick={() => p.onToggle(permission, state !== "granted")}
                  className={`relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent-ring)] ${
                    state === "granted" ? "bg-[var(--accent-strong)]" : "bg-hover"
                  }`}
                >
                  <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition ${state === "granted" ? "translate-x-4" : "translate-x-0.5"}`} />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {p.notificationsOn && blockedLine ? <p className="mt-2 text-[12px] leading-relaxed text-[var(--nc-warn)]">{t("browserBlocked")}</p> : null}
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          className="fg-muted inline-flex h-8 items-center rounded-lg px-3 text-[12.5px] font-medium hover:bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent-ring)]"
          onClick={p.onClose}
        >
          {t("close")}
        </button>
      </div>
    </div>
  );
}
