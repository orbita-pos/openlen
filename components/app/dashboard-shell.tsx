"use client";

// Dashboard chrome — a thin left icon-rail shared by /projects, /business and
// /messages, matching the editor's left-rail so the whole app feels like one
// surface (the user's ask). The rail = brand · create · nav (Pages · Messages
// · Business) · locale/theme/account. Each page renders its own content +
// in-content header to the right.

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { signOut, useSession } from "next-auth/react";
import {
  BarChart3,
  FileText,
  Inbox,
  LogOut,
  Moon,
  Plus,
  Store,
  Sun,
} from "lucide-react";
import { Link } from "@/i18n/navigation";
import { useDarkMode } from "@/lib/use-dark-mode";
import { cn } from "@/lib/cn";
import { OpenLenMark } from "@/components/openlen-logo";
import { LocaleSwitcher } from "@/components/locale-switcher";

type DashboardSection = "pages" | "analytics" | "business" | "messages";

const NAV: ReadonlyArray<{
  key: DashboardSection;
  href: string;
  icon: typeof FileText;
  labelKey: string;
}> = [
  { key: "pages", href: "/projects", icon: FileText, labelKey: "nav.myPages" },
  { key: "analytics", href: "/analytics", icon: BarChart3, labelKey: "nav.analytics" },
  { key: "messages", href: "/inbox", icon: Inbox, labelKey: "nav.messages" },
  { key: "business", href: "/business", icon: Store, labelKey: "nav.myBusiness" },
];

export function DashboardShell({
  active,
  children,
}: {
  active: DashboardSection;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen bg-zinc-50 dark:bg-[#0a0a0a]">
      <GlobalRail active={active} />
      <div className="flex-1 min-w-0 flex flex-col">{children}</div>
    </div>
  );
}

// The shared global rail. Used by the dashboard (with the locale/theme/account
// footer) AND injected at the far left of the editor (footer off — the editor
// TopBar already carries account/theme) so the SAME nav lives everywhere.
export function GlobalRail({
  active = null,
  showFooter = true,
}: {
  active?: DashboardSection | null;
  showFooter?: boolean;
}) {
  const t = useTranslations("projects");
  const [dark, toggleDark] = useDarkMode();
  return (
    <aside className="sticky top-0 z-30 h-screen w-14 shrink-0 flex flex-col items-center gap-1.5 border-r border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0a0a0a] py-3">
      <Link href="/projects" aria-label="OpenLen" className="mb-1.5">
        <OpenLenMark className="h-7 w-7" />
      </Link>

      <Link
        href="/new"
        title={t("header.newPage")}
        aria-label={t("header.newPage")}
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-coral-500 text-white shadow-[0_4px_14px_-4px_rgba(255,90,54,0.6)] hover:bg-coral-600 active:scale-95 transition"
      >
        <Plus size={18} />
      </Link>

      <div className="my-1 h-px w-6 bg-zinc-200 dark:bg-zinc-800" />

      {NAV.map((it) => {
        const I = it.icon;
        const isActive = active === it.key;
        return (
          <Link
            key={it.key}
            href={it.href}
            title={t(it.labelKey)}
            aria-label={t(it.labelKey)}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "inline-flex h-9 w-9 items-center justify-center rounded-lg transition",
              isActive
                ? "bg-coral-50 dark:bg-coral-500/15 text-coral-600 dark:text-coral-300"
                : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-900",
            )}
          >
            <I size={18} />
          </Link>
        );
      })}

      {showFooter && (
        <>
          <div className="flex-1" />
          <LocaleSwitcher />
          <button
            type="button"
            onClick={toggleDark}
            aria-label={t("appHeader.toggleDarkMode")}
            title={t("appHeader.toggleDarkMode")}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition"
          >
            {dark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <AccountMenu />
        </>
      )}
    </aside>
  );
}

function AccountMenu() {
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
        aria-label={user?.name ?? user?.email ?? t("appHeader.signedIn")}
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-900 transition"
      >
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-coral-400 to-coral-700 text-white text-[11px] font-semibold ring-2 ring-white dark:ring-[#0a0a0a]">
          {initials}
        </span>
      </button>
      {open && (
        <div className="absolute bottom-0 left-full ml-2 w-60 rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-800 bg-white dark:bg-[#0a0a0a] shadow-lg p-1.5">
          <div className="px-3 py-2.5">
            <div className="text-sm font-medium truncate">
              {user?.name ?? t("appHeader.signedIn")}
            </div>
            <div className="text-xs text-zinc-500 truncate">
              {user?.email ?? "—"}
            </div>
          </div>
          {plan === "pro" && (
            <>
              <div className="border-t border-zinc-100 dark:border-zinc-900 my-1" />
              <a
                href={`/api/billing/portal?locale=${locale}`}
                className="flex items-center w-full text-left px-3 py-1.5 rounded-md text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900"
              >
                {t("appHeader.manageBilling")}
              </a>
            </>
          )}
          <div className="border-t border-zinc-100 dark:border-zinc-900 my-1" />
          <button
            type="button"
            onClick={() => void signOut({ callbackUrl: `/${locale}/login` })}
            className="flex items-center gap-2 w-full text-left px-3 py-1.5 rounded-md text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900"
          >
            <LogOut size={13} /> {t("appHeader.signOut")}
          </button>
        </div>
      )}
    </div>
  );
}
