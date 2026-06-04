"use client";

// Analytics — account-level metrics across all the user's pages (last 30 days).
// Aggregates the same pageEvents + formSubmissions the per-page Insights tab
// uses; here it's the bird's-eye "how are all my pages doing" view.

import type { ComponentType } from "react";
import { useTranslations } from "next-intl";
import { Eye, Mail, MousePointerClick } from "lucide-react";
import { Link } from "@/i18n/navigation";

interface PageStat {
  id: string;
  title: string;
  subdomain: string | null;
  views: number;
  clicks: number;
  leads: number;
}
interface Totals {
  views: number;
  clicks: number;
  leads: number;
}

export function AnalyticsView({
  totals,
  perPage,
}: {
  totals: Totals;
  perPage: PageStat[];
}) {
  const t = useTranslations("projects");
  const hasData = totals.views > 0 || totals.clicks > 0 || totals.leads > 0;
  return (
    <main className="flex-1 w-full max-w-4xl mx-auto px-4 sm:px-6 py-7 sm:py-9">
      <div className="mb-6">
        <h1 className="text-[22px] sm:text-[26px] font-bold tracking-tight">
          {t("analytics.title")}
        </h1>
        <p className="text-[13.5px] text-zinc-500 dark:text-zinc-400 mt-1">
          {t("analytics.subtitle")}
        </p>
      </div>

      {!hasData ? (
        <EmptyState />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2.5 sm:gap-3 mb-7">
            <Kpi icon={Eye} label={t("analytics.views")} value={totals.views} />
            <Kpi
              icon={MousePointerClick}
              label={t("analytics.clicks")}
              value={totals.clicks}
            />
            <Kpi icon={Mail} label={t("analytics.leads")} value={totals.leads} accent />
          </div>

          <h2 className="text-[13px] font-semibold text-zinc-500 dark:text-zinc-400 mb-2 px-1">
            {t("analytics.perPage")}
          </h2>
          <div className="rounded-xl bg-white dark:bg-[#0a0a0a] ring-1 ring-zinc-200 dark:ring-zinc-800 divide-y divide-zinc-100 dark:divide-zinc-900">
            {perPage.map((p) => (
              <Link
                key={p.id}
                href={`/new?project=${p.id}`}
                className="group flex items-center gap-3 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition first:rounded-t-xl last:rounded-b-xl"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-medium truncate group-hover:text-coral-700 dark:group-hover:text-coral-300">
                    {p.title}
                  </span>
                  {p.subdomain && (
                    <span className="block text-[11px] text-zinc-400 dark:text-zinc-500 truncate">
                      {p.subdomain}.openlen.com
                    </span>
                  )}
                </span>
                <span className="shrink-0 inline-flex items-center gap-3.5 text-[12px] text-zinc-500 dark:text-zinc-400">
                  <span className="inline-flex items-center gap-1">
                    <Eye size={12} /> {p.views}
                  </span>
                  <span
                    className={
                      p.leads > 0
                        ? "inline-flex items-center gap-1 text-coral-600 dark:text-coral-400 font-medium"
                        : "inline-flex items-center gap-1"
                    }
                  >
                    <Mail size={12} /> {p.leads}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </>
      )}
    </main>
  );
}

function Kpi({
  icon: I,
  label,
  value,
  accent,
}: {
  icon: ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl bg-white dark:bg-[#0a0a0a] ring-1 ring-zinc-200 dark:ring-zinc-800 p-4">
      <div
        className={
          accent
            ? "inline-flex items-center gap-1.5 text-[11.5px] font-medium text-coral-600 dark:text-coral-400"
            : "inline-flex items-center gap-1.5 text-[11.5px] font-medium text-zinc-500 dark:text-zinc-400"
        }
      >
        <I size={13} /> {label}
      </div>
      <div className="mt-1.5 text-[26px] font-bold tracking-tight tabular-nums">
        {value.toLocaleString()}
      </div>
    </div>
  );
}

function EmptyState() {
  const t = useTranslations("projects");
  return (
    <div className="rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0a0a0a] px-6 py-14 text-center">
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-100 dark:bg-zinc-900 text-zinc-400 dark:text-zinc-500 mb-4">
        <Eye size={22} />
      </span>
      <h2 className="text-[15px] font-semibold">{t("analytics.empty")}</h2>
      <p className="mt-1.5 max-w-sm mx-auto text-[13px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
        {t("analytics.emptyHint")}
      </p>
    </div>
  );
}
