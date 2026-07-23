"use client";

// Unified owner inbox. One page, two tabs:
//   Chat      → live visitor conversations (InboxDesk) + push activation
//   Formularios → cross-project form-submission leads (InboxForms)
// Tab lives in the URL (?tab=forms; absent = chat) so push/PWA cold-opens land
// on Chat and the Módulos "Formularios" card can deep-link to ?tab=forms.

import { useCallback, useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft, FileText, Inbox, MessageSquare } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { InboxDesk } from "./inbox-desk";
import { InboxForms } from "./inbox-forms";
import { PushActivation } from "./push-activation";
import { useInboxBadge } from "./use-inbox-badge";
import { formatBadge } from "./badge-format";

type Tab = "chat" | "forms";

export function InboxHub() {
  const t = useTranslations("inbox");
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab: Tab = searchParams.get("tab") === "forms" ? "forms" : "chat";
  // Return to the project the user came from (the workspace passes ?from=<id>),
  // not a bare /new that drops the open project. Validated (project ids are
  // uuid-ish) so nothing can be injected into the href.
  const fromRaw = searchParams.get("from");
  const from = fromRaw && /^[a-zA-Z0-9-]{1,64}$/.test(fromRaw) ? fromRaw : null;
  const backHref = from ? `/new?project=${from}` : "/new";

  const { counts, markLeadsSeen } = useInboxBadge();
  // Opening the Formularios tab IS the "seen" action (spec: timestamp
  // semantics — everything up to now counts as seen).
  useEffect(() => {
    if (tab === "forms") void markLeadsSeen();
  }, [tab, markLeadsSeen]);

  const selectTab = useCallback(
    (next: Tab) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === "chat") params.delete("tab");
      else params.set("tab", next);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-app text-zinc-900 dark:text-zinc-100">
      <header className="shrink-0 border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center gap-2 px-3 pt-3 sm:px-5">
          <Link
            href={backHref}
            aria-label={t("backToWorkspace")}
            title={t("backToWorkspace")}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
          >
            <ArrowLeft size={18} />
          </Link>
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-coral-500/10 text-coral-500">
            <Inbox size={16} />
          </span>
          <h1 className="text-[15px] font-semibold leading-tight">{t("title")}</h1>
        </div>
        <div role="tablist" aria-label={t("title")} className="flex gap-1 px-3 sm:px-5">
          <TabButton
            active={tab === "chat"}
            onClick={() => selectTab("chat")}
            icon={<MessageSquare size={14} />}
            label={t("tabs.chat")}
            count={formatBadge(counts?.chat ?? 0)}
            ariaLabel={
              (counts?.chat ?? 0) > 0
                ? `${t("tabs.chat")} — ${t("badge.count", { count: counts?.chat ?? 0 })}`
                : undefined
            }
          />
          <TabButton
            active={tab === "forms"}
            onClick={() => selectTab("forms")}
            icon={<FileText size={14} />}
            label={t("tabs.forms")}
            count={formatBadge(counts?.leads ?? 0)}
            ariaLabel={
              (counts?.leads ?? 0) > 0
                ? `${t("tabs.forms")} — ${t("badge.count", { count: counts?.leads ?? 0 })}`
                : undefined
            }
          />
        </div>
      </header>

      {tab === "chat" ? (
        <>
          <PushActivation />
          <InboxDesk />
        </>
      ) : (
        <InboxForms />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
  count = null,
  ariaLabel,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count?: string | null;
  /** Accessible name including the count — the pill itself is aria-hidden. */
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-label={ariaLabel}
      onClick={onClick}
      className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-[13px] font-medium transition ${
        active
          ? "border-coral-500 text-coral-600 dark:text-coral-400"
          : "border-transparent text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
      }`}
    >
      {icon}
      {label}
      {count !== null && (
        <span
          aria-hidden
          className="min-w-4 h-4 px-1 rounded-full bg-coral-500 text-white text-[10px] font-semibold leading-4 text-center"
        >
          {count}
        </span>
      )}
    </button>
  );
}
