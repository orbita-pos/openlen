// Insights tab — privacy-first analytics for a published page.
//
// Reads the aggregated payload from /api/projects/[id]/insights and renders
// it in five blocks (KPI cards, visits-over-time, top links table, top
// referrers, top countries + device split). All views are flat — no nested
// drilldown — to keep the panel scannable at sidebar width.

"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { BarChart3 } from "../icons";
import { Sparkline } from "../insights-sparkline";
import { PageCoach, FunnelBar } from "./page-coach";
import type {
  Funnel,
  Insights,
  InsightsRange,
  InsightsLink,
  InsightsRow,
} from "@/lib/analytics/queries";

const RANGES: ReadonlyArray<{ id: InsightsRange; label: string }> = [
  { id: "7d", label: "7d" },
  { id: "30d", label: "30d" },
  { id: "90d", label: "90d" },
  { id: "all", label: "All" },
];

export function InsightsPanel({
  currentProjectId,
  onApplyTip,
}: {
  currentProjectId?: string | null;
  /** Page Coach "Apply with AI" — hands a localized instruction to the parent,
   *  which loads it into the Chat composer and switches to the Chat tab. */
  onApplyTip?: (instruction: string) => void;
}) {
  const t = useTranslations("panelsB");
  const [range, setRange] = useState<InsightsRange>("7d");
  const [data, setData] = useState<Insights | null>(null);
  const [funnel, setFunnel] = useState<Funnel | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!currentProjectId) {
      setData(null);
      setFunnel(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    // Insights drives the panel; the funnel is additive (Page Coach + funnel
    // bar). A funnel failure (e.g. pre-migration) is soft — insights still show.
    void Promise.all([
      fetch(`/api/projects/${currentProjectId}/insights?range=${range}`).then(
        async (r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return (await r.json()) as Insights;
        },
      ),
      fetch(`/api/projects/${currentProjectId}/funnel?range=${range}`)
        .then((r) => (r.ok ? (r.json() as Promise<Funnel>) : null))
        .catch(() => null),
    ])
      .then(([ins, fun]) => {
        if (cancelled) return;
        setData(ins);
        setFunnel(fun);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : t("insights.loadError"));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentProjectId, range]);

  if (!currentProjectId) {
    return <NoProject />;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 pt-3 pb-2 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-[0.16em] fg-faint font-semibold ui-small">
              {t("insights.title")}
            </div>
            <div className="text-[11px] fg-faint mt-0.5">
              {t("insights.subtitle")}
            </div>
          </div>
          <RangePicker value={range} onChange={setRange} disabled={loading} />
        </div>
      </div>
      {error && (
        <div className="mx-3 mb-2 rounded-md ring-1 ring-red-500/40 bg-red-500/5 px-2 py-1.5 text-[11px] text-red-600 dark:text-red-400">
          {error}
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-y-auto nice-scroll px-3 pb-3">
        {funnel && (
          <div className="space-y-3 mb-3">
            <PageCoach funnel={funnel} onApplyTip={onApplyTip} />
            {funnel.saw > 0 && <FunnelBar funnel={funnel} />}
          </div>
        )}
        {data ? (
          <Content data={data} />
        ) : loading ? (
          <Skeleton />
        ) : null}
      </div>
    </div>
  );
}

function NoProject() {
  const t = useTranslations("panelsB");
  return (
    <div className="h-full flex items-center justify-center px-6 py-8 text-center">
      <div className="max-w-[220px]">
        <div className="mx-auto mb-3 inline-flex h-9 w-9 items-center justify-center rounded-md ring-1 ring-[color:var(--border)] bg-elev fg-faint">
          <BarChart3 size={14} />
        </div>
        <p className="text-[11.5px] fg-muted leading-relaxed">
          {t("insights.perProject")}
        </p>
        <p className="mt-1.5 text-[10.5px] fg-faint leading-relaxed">
          {t("insights.perProjectHint")}
        </p>
      </div>
    </div>
  );
}

function RangePicker({
  value,
  onChange,
  disabled,
}: {
  value: InsightsRange;
  onChange: (r: InsightsRange) => void;
  disabled: boolean;
}) {
  const t = useTranslations("panelsB");
  return (
    <div className="inline-flex items-center gap-0.5 rounded-md bg-elev border bd p-0.5">
      {RANGES.map((r) => (
        <button
          key={r.id}
          type="button"
          disabled={disabled}
          onClick={() => onChange(r.id)}
          className={`h-5 px-1.5 rounded-[5px] text-[10px] ui-small transition disabled:opacity-50 ${
            value === r.id
              ? "bg-app fg shadow-card border bd"
              : "fg-faint hover:fg"
          }`}
        >
          {r.id === "all" ? t("insights.range.all") : r.label}
        </button>
      ))}
    </div>
  );
}

function Content({ data }: { data: Insights }) {
  const isEmpty =
    data.totals.views === 0 && data.totals.clicks === 0;

  if (isEmpty) {
    return <EmptyState />;
  }

  return (
    <div className="space-y-3">
      <KpiRow totals={data.totals} />
      <VisitsChart byDay={data.byDay} />
      <TopPagesCard pages={data.topPages} />
      <TopLinksTable links={data.topLinks} />
      <SideBySide
        referrers={data.topReferrers}
        countries={data.topCountries}
        browsers={data.topBrowsers}
        device={data.deviceSplit}
      />
    </div>
  );
}

function EmptyState() {
  const t = useTranslations("panelsB");
  return (
    <div className="rounded-md border bd bg-elev p-4 text-center">
      <p className="text-[11.5px] fg-muted leading-relaxed">
        {t("insights.emptyRange")}
      </p>
      <p className="mt-1 text-[10.5px] fg-faint leading-relaxed">
        {t("insights.emptyRangeHint")}
      </p>
    </div>
  );
}

function KpiRow({ totals }: { totals: Insights["totals"] }) {
  const t = useTranslations("panelsB");
  const ctr =
    totals.views > 0 ? Math.round((totals.clicks / totals.views) * 1000) / 10 : 0;
  return (
    <div className="grid grid-cols-2 gap-1.5">
      <KpiCard label={t("insights.kpi.views")} value={totals.views} />
      <KpiCard label={t("insights.kpi.uniques")} value={totals.uniques} />
      <KpiCard label={t("insights.kpi.clicks")} value={totals.clicks} />
      <KpiCard label="CTR" value={`${ctr}%`} />
    </div>
  );
}

function KpiCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md border bd bg-elev px-2 py-1.5">
      <div className="text-[9.5px] uppercase tracking-[0.14em] fg-faint font-semibold ui-small">
        {label}
      </div>
      <div className="mt-0.5 text-[15px] font-semibold fg tabular-nums">
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
    </div>
  );
}

function VisitsChart({ byDay }: { byDay: Insights["byDay"] }) {
  const t = useTranslations("panelsB");
  const views = useMemo(() => byDay.map((d) => d.views), [byDay]);
  return (
    <div className="rounded-md border bd bg-elev p-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[9.5px] uppercase tracking-[0.14em] fg-faint font-semibold ui-small">
          {t("insights.visitsOverTime")}
        </span>
        <span className="text-[10px] fg-faint tabular-nums">
          {t("insights.dayCount", { count: byDay.length })}
        </span>
      </div>
      <Sparkline
        data={views}
        width={280}
        height={48}
        fill
        className="w-full h-12"
      />
    </div>
  );
}

// Views per document. Hidden for single-document sites — a lone "/" row
// just repeats the Views KPI.
function TopPagesCard({ pages }: { pages: InsightsRow[] }) {
  const t = useTranslations("panelsB");
  if (pages.length < 2) return null;
  const total = pages.reduce((s, p) => s + p.count, 0);
  return (
    <div className="rounded-md border bd bg-elev p-2">
      <div className="text-[9.5px] uppercase tracking-[0.14em] fg-faint font-semibold ui-small mb-1.5 px-1">
        {t("insights.pages")}
      </div>
      <ul className="space-y-0.5">
        {pages.map((p) => {
          const pct = total > 0 ? Math.round((p.count / total) * 100) : 0;
          return (
            <li
              key={p.key}
              className="px-1 py-1 rounded-md hover:bg-app/40 transition flex items-center gap-2"
            >
              <span
                className="min-w-0 flex-1 text-[11px] fg font-mono truncate"
                title={p.key}
              >
                {p.key}
              </span>
              <span
                className="shrink-0 h-1 w-12 rounded-full bg-app overflow-hidden"
                aria-hidden
              >
                <span
                  className="block h-full rounded-full bg-[color:var(--accent)]/70"
                  style={{ width: `${pct}%` }}
                />
              </span>
              <span className="shrink-0 text-right min-w-[44px]">
                <span className="text-[11.5px] fg font-semibold tabular-nums">
                  {p.count.toLocaleString()}
                </span>
                <span className="ml-1 text-[9.5px] fg-faint tabular-nums">
                  {pct}%
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function TopLinksTable({ links }: { links: InsightsLink[] }) {
  const t = useTranslations("panelsB");
  if (links.length === 0) {
    return (
      <div className="rounded-md border bd bg-elev p-3">
        <div className="text-[9.5px] uppercase tracking-[0.14em] fg-faint font-semibold ui-small mb-1">
          {t("insights.topLinks")}
        </div>
        <p className="text-[10.5px] fg-faint">{t("insights.noClicks")}</p>
      </div>
    );
  }
  const total = links.reduce((s, l) => s + l.clicks, 0);
  return (
    <div className="rounded-md border bd bg-elev p-2">
      <div className="text-[9.5px] uppercase tracking-[0.14em] fg-faint font-semibold ui-small mb-1.5 px-1">
        {t("insights.topLinks")}
      </div>
      <ul className="space-y-0.5">
        {links.map((link) => (
          <LinkRow key={link.href} link={link} total={total} />
        ))}
      </ul>
    </div>
  );
}

function LinkRow({ link, total }: { link: InsightsLink; total: number }) {
  const pct = total > 0 ? Math.round((link.clicks / total) * 100) : 0;
  const display = link.label?.trim() || displayHost(link.href);
  return (
    <li className="px-1 py-1.5 rounded-md hover:bg-app/40 transition flex items-center gap-2">
      <div className="min-w-0 flex-1">
        <div className="text-[11.5px] fg truncate" title={display}>
          {display}
        </div>
        <div
          className="text-[9.5px] fg-faint font-mono truncate"
          title={link.href}
        >
          {link.href.replace(/^https?:\/\//, "")}
        </div>
      </div>
      <Sparkline
        data={link.sparkline}
        width={48}
        height={16}
        className="shrink-0 opacity-80"
      />
      <div className="shrink-0 text-right min-w-[44px]">
        <div className="text-[11.5px] fg font-semibold tabular-nums">
          {link.clicks.toLocaleString()}
        </div>
        <div className="text-[9.5px] fg-faint tabular-nums">{pct}%</div>
      </div>
    </li>
  );
}

function SideBySide({
  referrers,
  countries,
  browsers,
  device,
}: {
  referrers: InsightsRow[];
  countries: InsightsRow[];
  browsers: InsightsRow[];
  device: Insights["deviceSplit"];
}) {
  const t = useTranslations("panelsB");
  return (
    <div className="grid grid-cols-2 gap-1.5">
      <SimpleListCard
        label={t("insights.referrers")}
        rows={referrers}
        fallback={t("insights.directOnly")}
      />
      <SimpleListCard
        label={t("insights.countries")}
        rows={countries}
        fallback={t("insights.noCountryData")}
      />
      <SimpleListCard
        label={t("insights.browsers")}
        rows={browsers.map((b) => ({
          key: b.key.charAt(0).toUpperCase() + b.key.slice(1),
          count: b.count,
        }))}
        fallback="—"
      />
      <DeviceCard device={device} />
    </div>
  );
}

function SimpleListCard({
  label,
  rows,
  fallback,
}: {
  label: string;
  rows: InsightsRow[];
  fallback: string;
}) {
  return (
    <div className="rounded-md border bd bg-elev p-2">
      <div className="text-[9.5px] uppercase tracking-[0.14em] fg-faint font-semibold ui-small mb-1">
        {label}
      </div>
      {rows.length === 0 ? (
        <p className="text-[10.5px] fg-faint">{fallback}</p>
      ) : (
        <ul className="space-y-0.5">
          {rows.map((r) => (
            <li
              key={r.key}
              className="flex items-center justify-between gap-1 text-[11px]"
            >
              <span className="fg truncate" title={r.key}>
                {r.key}
              </span>
              <span className="fg-faint tabular-nums">
                {r.count.toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DeviceCard({ device }: { device: Insights["deviceSplit"] }) {
  const t = useTranslations("panelsB");
  const total = device.mobile + device.desktop + device.tablet;
  const rows = (["mobile", "desktop", "tablet"] as const).map((k) => ({
    key: k,
    count: device[k],
    pct: total > 0 ? Math.round((device[k] / total) * 100) : 0,
  }));
  return (
    <div className="rounded-md border bd bg-elev p-2">
      <div className="text-[9.5px] uppercase tracking-[0.14em] fg-faint font-semibold ui-small mb-1">
        {t("insights.device")}
      </div>
      {total === 0 ? (
        <p className="text-[10.5px] fg-faint">{t("insights.noDeviceData")}</p>
      ) : (
        <ul className="space-y-0.5">
          {rows.map((r) => (
            <li
              key={r.key}
              className="flex items-center justify-between gap-1 text-[11px]"
            >
              <span className="fg">{t(`insights.deviceType.${r.key}`)}</span>
              <span className="fg-faint tabular-nums">{r.pct}%</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      <div className="grid grid-cols-2 gap-1.5">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-12 rounded-md bg-elev border bd" />
        ))}
      </div>
      <div className="h-16 rounded-md bg-elev border bd" />
      <div className="h-32 rounded-md bg-elev border bd" />
      <div className="grid grid-cols-2 gap-1.5">
        <div className="h-20 rounded-md bg-elev border bd" />
        <div className="h-20 rounded-md bg-elev border bd" />
      </div>
    </div>
  );
}

function displayHost(href: string): string {
  try {
    return new URL(href).host;
  } catch {
    return href;
  }
}
