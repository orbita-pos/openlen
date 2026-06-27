"use client";

// Unified owner inbox. One page, two tabs:
//   Chat      → live visitor conversations (InboxDesk) + push activation
//   Formularios → cross-project form-submission leads (InboxForms)
// Tab lives in the URL (?tab=forms; absent = chat) so push/PWA cold-opens land
// on Chat and the Módulos "Formularios" card can deep-link to ?tab=forms.

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { FileText, Inbox, MessageSquare } from "lucide-react";
import { InboxDesk } from "./inbox-desk";
import { InboxForms } from "./inbox-forms";
import { PushActivation } from "./push-activation";

type Tab = "chat" | "forms";

export function InboxHub() {
  const t = useTranslations("inbox");
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab: Tab = searchParams.get("tab") === "forms" ? "forms" : "chat";

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
    <div className="flex h-dvh flex-col bg-white text-zinc-900 dark:bg-[#0a0a0a] dark:text-zinc-100">
      <header className="shrink-0 border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center gap-2 px-4 pt-3 sm:px-6">
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
          />
          <TabButton
            active={tab === "forms"}
            onClick={() => selectTab("forms")}
            icon={<FileText size={14} />}
            label={t("tabs.forms")}
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
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-[13px] font-medium transition ${
        active
          ? "border-coral-500 text-coral-600 dark:text-coral-400"
          : "border-transparent text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
