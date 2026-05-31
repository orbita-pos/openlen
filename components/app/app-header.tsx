"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { signOut, useSession } from "next-auth/react";
import { ChevronDown, Moon, Sun, X } from "lucide-react";
import { useDarkMode } from "@/lib/use-dark-mode";
import { cn } from "@/lib/cn";
import { CreditPill } from "@/components/app/credit-pill";
import { OpenLenMark } from "@/components/openlen-logo";
import { LocaleSwitcher } from "@/components/locale-switcher";
import type { ReactNode } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Shared workspace chrome. Same logo + sticky h-14 + dark toggle + profile
// menu pattern that /new uses. Pages compose their own middle/right
// content via the `nav` and `actions` slots.
//
// Why this exists separately from the existing workspace Header: the /new
// header carries a lot of project-specific state (project name input, save
// indicator, cost pill, deploy dropdown). Forcing /projects through the
// same prop surface would mean a dozen optional props. Sharing the *visual
// shell* via this component keeps the chrome consistent without coupling.
// ─────────────────────────────────────────────────────────────────────────────

export interface AppHeaderProps {
  /** Content rendered next to the brand. Usually breadcrumbs or page title. */
  nav?: ReactNode;
  /** Content rendered before the dark toggle + profile menu. Page CTAs. */
  actions?: ReactNode;
}

export function AppHeader({ nav, actions }: AppHeaderProps) {
  const t = useTranslations("projects");
  const [dark, toggleDark] = useDarkMode();
  return (
    <header className="sticky top-0 z-40 h-14 shrink-0 border-b border-zinc-200 dark:border-zinc-800 bg-white/85 dark:bg-[#0a0a0a]/85 backdrop-blur-md">
      <div className="h-full px-4 sm:px-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/" className="flex items-center gap-2 shrink-0">
            <OpenLenMark className="h-6 w-6 shrink-0" />
            <span className="hidden sm:inline font-semibold tracking-tight text-[14px]">
              Open<span className="text-coral-500 dark:text-coral-400">Len</span>
            </span>
          </Link>
          {nav && (
            <>
              <div className="hidden md:block h-5 w-px bg-zinc-200 dark:bg-zinc-800 shrink-0" />
              <div className="flex items-center gap-1.5 min-w-0 text-sm">{nav}</div>
            </>
          )}
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2">
          {actions}
          {actions && (
            <div className="hidden sm:block h-5 w-px bg-zinc-200 dark:bg-zinc-800 mx-1" />
          )}
          <CreditPill />
          <LocaleSwitcher />
          <button
            type="button"
            onClick={toggleDark}
            aria-label={t("appHeader.toggleDarkMode")}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition"
          >
            {dark ? <Sun size={15} /> : <Moon size={15} />}
          </button>
          <UserMenu />
        </div>
      </div>
    </header>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// User menu — same shape used in the workspace Header. Re-implemented here
// to keep this file self-contained and avoid a circular dependency.
// ─────────────────────────────────────────────────────────────────────────────

function UserMenu() {
  const t = useTranslations("projects");
  const locale = useLocale();
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<"free" | "pro" | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const user = session?.user;

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/usage")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { plan?: "free" | "pro" } | null) => {
        if (!cancelled && d?.plan) setPlan(d.plan);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const initials = useMemo(() => {
    const source = user?.name || user?.email || "";
    if (!source) return "U";
    const parts = source.split(/[\s@.]+/).filter(Boolean);
    return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "U";
  }, [user?.name, user?.email]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-full h-8 pl-0.5 pr-2 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition"
      >
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-coral-400 to-coral-700 text-white text-[11px] font-semibold ring-2 ring-white dark:ring-[#0a0a0a]">
          {initials}
        </span>
        <ChevronDown size={13} className="text-zinc-400" />
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-60 rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-800 bg-white dark:bg-[#0a0a0a] shadow-lg p-1.5">
          <div className="px-3 py-2.5">
            <div className="text-sm font-medium truncate">
              {user?.name ?? t("appHeader.signedIn")}
            </div>
            <div className="text-xs text-zinc-500 truncate">
              {user?.email ?? "—"}
            </div>
          </div>
          <div className="border-t border-zinc-100 dark:border-zinc-900 my-1" />
          <Link
            href="/projects"
            onClick={() => setOpen(false)}
            className="flex items-center w-full text-left px-3 py-1.5 rounded-md text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900"
          >
            {t("appHeader.myPages")}
          </Link>
          {plan === "pro" && (
            <a
              href={`/api/billing/portal?locale=${locale}`}
              className="flex items-center w-full text-left px-3 py-1.5 rounded-md text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900"
            >
              {t("appHeader.manageBilling")}
            </a>
          )}
          {(
            [
              { key: "settings", label: t("appHeader.settings") },
              { key: "apiKeys", label: t("appHeader.apiKeys") },
            ] as const
          ).map((item) => (
            <button
              type="button"
              key={item.key}
              className="flex items-center w-full text-left px-3 py-1.5 rounded-md text-sm text-zinc-500 dark:text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-900 cursor-not-allowed"
              title={t("appHeader.comingSoon", { label: item.label })}
              disabled
            >
              {item.label}
            </button>
          ))}
          <div className="border-t border-zinc-100 dark:border-zinc-900 my-1" />
          <button
            type="button"
            onClick={() => void signOut({ callbackUrl: "/login" })}
            className="flex items-center gap-2 w-full text-left px-3 py-1.5 rounded-md text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900"
          >
            <X size={13} /> {t("appHeader.signOut")}
          </button>
        </div>
      )}
    </div>
  );
}

// Small helper for breadcrumb chevron, used by callers building the `nav` slot.
export function HeaderChevron({ className }: { className?: string }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("text-zinc-300 dark:text-zinc-700 shrink-0", className)}
      aria-hidden="true"
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}
