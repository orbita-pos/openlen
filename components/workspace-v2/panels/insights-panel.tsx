// Insights tab — privacy-first analytics for a published page.
//
// Reads the aggregated payload from /api/projects/[id]/insights and renders
// it in five blocks (KPI cards, visits-over-time, top links table, top
// referrers, top countries + device split). All views are flat — no nested
// drilldown — to keep the panel scannable at sidebar width.

"use client";

import { useEffect, useMemo, useState } from "react";
import { BarChart3 } from "../icons";
import { Sparkline } from "../insights-sparkline";
import type {
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

const DEVICE_LABELS: Record<string, string> = {
  mobile: "Mobile",
  desktop: "Desktop",
  tablet: "Tablet",
};

export function InsightsPanel({
  currentProjectId,
}: {
  currentProjectId?: string | null;
}) {
  const [range, setRange] = useState<InsightsRange>("7d");
  const [data, setData] = useState<Insights | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!currentProjectId) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetch(
      `/api/projects/${currentProjectId}/insights?range=${range}`,
    )
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as Insights;
      })
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load insights");
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
              Insights
            </div>
            <div className="text-[11px] fg-faint mt-0.5">
              Privacy-first analytics for this page.
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
  return (
    <div className="h-full flex items-center justify-center px-6 py-8 text-center">
      <div className="max-w-[220px]">
        <div className="mx-auto mb-3 inline-flex h-9 w-9 items-center justify-center rounded-md ring-1 ring-[color:var(--border)] bg-elev fg-faint">
          <BarChart3 size={14} />
        </div>
        <p className="text-[11.5px] fg-muted leading-relaxed">
          Insights live per project.
        </p>
        <p className="mt-1.5 text-[10.5px] fg-faint leading-relaxed">
          Open a project from the Pages tab to see its analytics.
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
          {r.label}
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
      <TopLinksTable links={data.topLinks} />
      <SideBySide
        referrers={data.topReferrers}
        countries={data.topCountries}
        device={data.deviceSplit}
      />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-md border bd bg-elev p-4 text-center">
      <p className="text-[11.5px] fg-muted leading-relaxed">
        No data yet for this range.
      </p>
      <p className="mt-1 text-[10.5px] fg-faint leading-relaxed">
        Publish your page and share the link — analytics start the moment a
        visitor hits it.
      </p>
    </div>
  );
}

function KpiRow({ totals }: { totals: Insights["totals"] }) {
  const ctr =
    totals.views > 0 ? Math.round((totals.clicks / totals.views) * 1000) / 10 : 0;
  return (
    <div className="grid grid-cols-2 gap-1.5">
      <KpiCard label="Views" value={totals.views} />
      <KpiCard label="Uniques" value={totals.uniques} />
      <KpiCard label="Clicks" value={totals.clicks} />
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
  const views = useMemo(() => byDay.map((d) => d.views), [byDay]);
  return (
    <div className="rounded-md border bd bg-elev p-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[9.5px] uppercase tracking-[0.14em] fg-faint font-semibold ui-small">
          Visits over time
        </span>
        <span className="text-[10px] fg-faint tabular-nums">
          {byDay.length} {byDay.length === 1 ? "day" : "days"}
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

function TopLinksTable({ links }: { links: InsightsLink[] }) {
  if (links.length === 0) {
    return (
      <div className="rounded-md border bd bg-elev p-3">
        <div className="text-[9.5px] uppercase tracking-[0.14em] fg-faint font-semibold ui-small mb-1">
          Top links
        </div>
        <p className="text-[10.5px] fg-faint">No outbound clicks yet.</p>
      </div>
    );
  }
  const total = links.reduce((s, l) => s + l.clicks, 0);
  return (
    <div className="rounded-md border bd bg-elev p-2">
      <div className="text-[9.5px] uppercase tracking-[0.14em] fg-faint font-semibold ui-small mb-1.5 px-1">
        Top links
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
  device,
}: {
  referrers: InsightsRow[];
  countries: InsightsRow[];
  device: Insights["deviceSplit"];
}) {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      <SimpleListCard label="Referrers" rows={referrers} fallback="Direct only" />
      <SimpleListCard
        label="Countries"
        rows={countries}
        fallback="No country data"
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
  const total = device.mobile + device.desktop + device.tablet;
  const rows = (["mobile", "desktop", "tablet"] as const).map((k) => ({
    key: k,
    count: device[k],
    pct: total > 0 ? Math.round((device[k] / total) * 100) : 0,
  }));
  return (
    <div className="rounded-md border bd bg-elev p-2">
      <div className="text-[9.5px] uppercase tracking-[0.14em] fg-faint font-semibold ui-small mb-1">
        Device
      </div>
      {total === 0 ? (
        <p className="text-[10.5px] fg-faint">No device data</p>
      ) : (
        <ul className="space-y-0.5">
          {rows.map((r) => (
            <li
              key={r.key}
              className="flex items-center justify-between gap-1 text-[11px]"
            >
              <span className="fg">{DEVICE_LABELS[r.key]}</span>
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
