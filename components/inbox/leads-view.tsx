"use client";

// Formularios — the cross-project leads inbox. Every form submission from the
// user's published pages, newest-first. Read-only. Lives as a tab inside the
// unified /inbox hub (next to Chat). The data + email notification already
// exist (lib/email.ts); this surfaces them.

import { useLocale, useTranslations } from "next-intl";
import { Globe, Inbox, Mail, MapPin } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { publishedHost, publishedUrl } from "@/lib/publish/base-host";

export interface DashLead {
  id: string;
  projectId: string;
  projectTitle: string;
  subdomain: string | null;
  data: Record<string, string>;
  country: string | null;
  device: string | null;
  /** Site page the form lives on (null = home / pre-multipage rows). */
  page: string | null;
  createdAt: Date;
}

export function MessagesView({ leads }: { leads: DashLead[] }) {
  const t = useTranslations("projects");
  return (
    <main className="flex-1 w-full max-w-3xl mx-auto px-4 sm:px-6 py-7 sm:py-9">
        <div className="mb-6">
          <h1 className="text-[22px] sm:text-[26px] font-bold tracking-tight">
            {t("inbox.title")}
          </h1>
          <p className="text-[13.5px] text-zinc-500 dark:text-zinc-400 mt-1">
            {t("inbox.subtitle")}
          </p>
        </div>
        {leads.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-3">
            {leads.map((lead) => (
              <LeadCard key={lead.id} lead={lead} />
            ))}
          </div>
        )}
    </main>
  );
}

function EmptyState() {
  const t = useTranslations("projects");
  return (
    <div className="rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0a0a0a] px-6 py-14 text-center">
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-100 dark:bg-zinc-900 text-zinc-400 dark:text-zinc-500 mb-4">
        <Inbox size={22} />
      </span>
      <h2 className="text-[15px] font-semibold">{t("inbox.empty")}</h2>
      <p className="mt-1.5 max-w-sm mx-auto text-[13px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
        {t("inbox.emptyHint")}
      </p>
      <Link
        href="/new"
        className="mt-5 inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-coral-500 text-white text-[13px] font-semibold hover:bg-coral-600 transition"
      >
        {t("inbox.createCta")}
      </Link>
    </div>
  );
}

function LeadCard({ lead }: { lead: DashLead }) {
  const t = useTranslations("projects");
  const locale = useLocale();
  const when = lead.createdAt.toLocaleString(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const fields = Object.entries(lead.data);
  return (
    <div className="rounded-xl bg-white dark:bg-[#0a0a0a] ring-1 ring-zinc-200 dark:ring-zinc-800 p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-zinc-600 dark:text-zinc-300 min-w-0">
          <Mail size={13} className="text-coral-500 shrink-0" />
          <span className="truncate">
            {t("inbox.from", { page: lead.projectTitle })}
          </span>
        </span>
        <span className="text-[11.5px] text-zinc-400 dark:text-zinc-500 shrink-0">
          {when}
        </span>
      </div>
      <dl className="space-y-1.5">
        {fields.map(([k, v]) => (
          <div
            key={k}
            className="grid grid-cols-[minmax(0,7rem)_1fr] gap-2 text-[13px]"
          >
            <dt className="text-zinc-400 dark:text-zinc-500 truncate">{k}</dt>
            <dd className="text-zinc-800 dark:text-zinc-200 break-words whitespace-pre-wrap">
              {v}
            </dd>
          </div>
        ))}
      </dl>
      {(lead.subdomain || lead.country || lead.device) && (
        <div className="mt-3 flex items-center flex-wrap gap-3 text-[11px] text-zinc-400 dark:text-zinc-500">
          {lead.subdomain && (
            <a
              href={publishedUrl(lead.subdomain, lead.page ? `/${lead.page}/` : "")}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 hover:text-coral-600 dark:hover:text-coral-400 transition"
            >
              <Globe size={11} /> {publishedHost(lead.subdomain)}
              {lead.page ? `/${lead.page}` : ""}
            </a>
          )}
          {lead.country && (
            <span className="inline-flex items-center gap-1">
              <MapPin size={11} /> {lead.country}
            </span>
          )}
          {lead.device && <span className="capitalize">{lead.device}</span>}
        </div>
      )}
    </div>
  );
}
