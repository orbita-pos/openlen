// Aggregation queries for the Insights tab.
//
// Two source tables in play:
//   - pageEvents      — raw events, kept for 90 days (retention cron)
//   - pageEventsDaily — pre-aggregated per (project, day, type, href, country,
//                       device), maintained by the same retention cron
//
// Range routing:
//   - 7d / 30d / 90d → raw events (the 90d retention guarantees coverage)
//   - all            → rollup for everything up to (today - 1) + raw for today.
//                      topReferrers stays raw-only (rollup doesn't track them).
//
// "all" range uniques are approximate: SUM(daily.uniques) double-counts
// returning visitors across days. Plausible-grade dedup needs raw uaHashes,
// which we shed after 90d on purpose — privacy > exactness for headline KPIs.

import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export type InsightsRange = "7d" | "30d" | "90d" | "all";

export interface InsightsTotals {
  views: number;
  uniques: number;
  clicks: number;
}

export interface InsightsDayBucket {
  /** ISO date YYYY-MM-DD. */
  day: string;
  views: number;
  clicks: number;
}

export interface InsightsLink {
  href: string;
  label: string | null;
  clicks: number;
  /** Last 7 days of click counts (oldest → newest), length 7. */
  sparkline: number[];
}

export interface InsightsRow {
  key: string;
  count: number;
}

export interface InsightsDeviceSplit {
  mobile: number;
  desktop: number;
  tablet: number;
}

export interface Insights {
  range: InsightsRange;
  totals: InsightsTotals;
  byDay: InsightsDayBucket[];
  topReferrers: InsightsRow[];
  topCountries: InsightsRow[];
  deviceSplit: InsightsDeviceSplit;
  topLinks: InsightsLink[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

function sinceFor(range: InsightsRange): Date | null {
  switch (range) {
    case "7d":
      return new Date(Date.now() - 7 * DAY_MS);
    case "30d":
      return new Date(Date.now() - 30 * DAY_MS);
    case "90d":
      return new Date(Date.now() - 90 * DAY_MS);
    case "all":
      return null;
  }
}

function whereClause(projectId: string, since: Date | null) {
  if (since) {
    return and(
      eq(schema.pageEvents.projectId, projectId),
      gte(schema.pageEvents.ts, since),
    );
  }
  return eq(schema.pageEvents.projectId, projectId);
}

// ── results-loop: batched per-project stats for the dashboard cards ─────────

export interface ProjectStat {
  views: number;
  clicks: number;
  leads: number;
}

/** Per-project {views, clicks, leads} for ALL of a user's projects in the last
 *  `sinceDays` — one grouped query each for events + leads (no N+1), scoped by
 *  ownership. Powers the inline stat strip on /projects + /business cards. */
export async function getProjectStatsForUser(
  userId: string,
  sinceDays: number,
): Promise<Map<string, ProjectStat>> {
  const since = new Date(Date.now() - sinceDays * DAY_MS);
  const [events, leads] = await Promise.all([
    db
      .select({
        projectId: schema.pageEvents.projectId,
        views: sql<number>`COUNT(*) FILTER (WHERE ${schema.pageEvents.type} = 'view')::int`,
        clicks: sql<number>`COUNT(*) FILTER (WHERE ${schema.pageEvents.type} = 'click')::int`,
      })
      .from(schema.pageEvents)
      .innerJoin(
        schema.projects,
        eq(schema.pageEvents.projectId, schema.projects.id),
      )
      .where(
        and(eq(schema.projects.userId, userId), gte(schema.pageEvents.ts, since)),
      )
      .groupBy(schema.pageEvents.projectId),
    db
      .select({
        projectId: schema.formSubmissions.projectId,
        leads: sql<number>`COUNT(*)::int`,
      })
      .from(schema.formSubmissions)
      .innerJoin(
        schema.projects,
        eq(schema.formSubmissions.projectId, schema.projects.id),
      )
      .where(
        and(
          eq(schema.projects.userId, userId),
          gte(schema.formSubmissions.createdAt, since),
        ),
      )
      .groupBy(schema.formSubmissions.projectId),
  ]);
  const map = new Map<string, ProjectStat>();
  for (const e of events) {
    map.set(e.projectId, {
      views: Number(e.views),
      clicks: Number(e.clicks),
      leads: 0,
    });
  }
  for (const l of leads) {
    const cur = map.get(l.projectId) ?? { views: 0, clicks: 0, leads: 0 };
    cur.leads = Number(l.leads);
    map.set(l.projectId, cur);
  }
  return map;
}

/** Headline KPIs: total views, unique visitors, total clicks. */
async function getTotals(
  projectId: string,
  since: Date | null,
): Promise<InsightsTotals> {
  const rows = await db
    .select({
      views: sql<number>`COUNT(*) FILTER (WHERE ${schema.pageEvents.type} = 'view')::int`,
      uniques: sql<number>`COUNT(DISTINCT ${schema.pageEvents.uaHash}) FILTER (WHERE ${schema.pageEvents.type} = 'view')::int`,
      clicks: sql<number>`COUNT(*) FILTER (WHERE ${schema.pageEvents.type} = 'click')::int`,
    })
    .from(schema.pageEvents)
    .where(whereClause(projectId, since));

  const r = rows[0];
  return {
    views: Number(r?.views ?? 0),
    uniques: Number(r?.uniques ?? 0),
    clicks: Number(r?.clicks ?? 0),
  };
}

/** Day-bucketed view + click counts for the visits-over-time chart. */
async function getByDay(
  projectId: string,
  since: Date | null,
): Promise<InsightsDayBucket[]> {
  const rows = await db
    .select({
      day: sql<string>`TO_CHAR(DATE_TRUNC('day', ${schema.pageEvents.ts}), 'YYYY-MM-DD')`,
      views: sql<number>`COUNT(*) FILTER (WHERE ${schema.pageEvents.type} = 'view')::int`,
      clicks: sql<number>`COUNT(*) FILTER (WHERE ${schema.pageEvents.type} = 'click')::int`,
    })
    .from(schema.pageEvents)
    .where(whereClause(projectId, since))
    .groupBy(sql`DATE_TRUNC('day', ${schema.pageEvents.ts})`)
    .orderBy(sql`DATE_TRUNC('day', ${schema.pageEvents.ts})`);

  return rows.map((r) => ({
    day: r.day,
    views: Number(r.views),
    clicks: Number(r.clicks),
  }));
}

/** Top outbound link destinations + a 7d-back sparkline for each. */
async function getTopLinks(
  projectId: string,
  since: Date | null,
): Promise<InsightsLink[]> {
  const baseWhere = since
    ? and(
        eq(schema.pageEvents.projectId, projectId),
        eq(schema.pageEvents.type, "click"),
        gte(schema.pageEvents.ts, since),
      )
    : and(
        eq(schema.pageEvents.projectId, projectId),
        eq(schema.pageEvents.type, "click"),
      );

  const top = await db
    .select({
      href: schema.pageEvents.href,
      // Take the most recent label seen for this href (labels can vary
      // slightly across visits if the page is edited; the latest text is
      // closest to the current page). MAX(text) is deterministic enough.
      label: sql<string | null>`MAX(${schema.pageEvents.linkLabel})`,
      clicks: sql<number>`COUNT(*)::int`,
    })
    .from(schema.pageEvents)
    .where(baseWhere)
    .groupBy(schema.pageEvents.href)
    .orderBy(sql`COUNT(*) DESC`)
    .limit(20);

  const realHrefs = top.map((t) => t.href).filter((h): h is string => !!h);
  if (realHrefs.length === 0) return [];

  // Per-href, per-day buckets for the last 7 days for the sparkline. We
  // compute the sparkline floor at 7 days regardless of the requested
  // range — the sparkline is always "recent activity" not "the range".
  const sevenAgo = new Date(Date.now() - 7 * DAY_MS);
  const buckets = await db
    .select({
      href: schema.pageEvents.href,
      day: sql<string>`TO_CHAR(DATE_TRUNC('day', ${schema.pageEvents.ts}), 'YYYY-MM-DD')`,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(schema.pageEvents)
    .where(
      and(
        eq(schema.pageEvents.projectId, projectId),
        eq(schema.pageEvents.type, "click"),
        gte(schema.pageEvents.ts, sevenAgo),
        inArray(schema.pageEvents.href, realHrefs),
      ),
    )
    .groupBy(
      schema.pageEvents.href,
      sql`DATE_TRUNC('day', ${schema.pageEvents.ts})`,
    );

  // Build the 7 day slots oldest→newest based on today's date.
  const slots: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * DAY_MS);
    slots.push(d.toISOString().slice(0, 10));
  }

  return top
    .filter((t): t is { href: string; label: string | null; clicks: number } =>
      Boolean(t.href),
    )
    .map((row) => {
      const dayMap = new Map<string, number>();
      for (const b of buckets) {
        if (b.href === row.href) dayMap.set(b.day, Number(b.count));
      }
      const sparkline = slots.map((d) => dayMap.get(d) ?? 0);
      return {
        href: row.href,
        label: row.label ?? null,
        clicks: Number(row.clicks),
        sparkline,
      };
    });
}

/** Top referrer hosts (the page's referrer header, grouped by host). */
async function getTopReferrers(
  projectId: string,
  since: Date | null,
): Promise<InsightsRow[]> {
  // Extract host from referrer. NULLIF rejects empty strings; the
  // regexp_replace pulls everything up to the first '/' after the scheme.
  // Anything that doesn't look like an http(s) URL falls through to NULL
  // and gets filtered out.
  const rows = await db
    .select({
      host: sql<string>`SUBSTRING(${schema.pageEvents.referrer} FROM '^https?://([^/?#]+)')`,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(schema.pageEvents)
    .where(
      and(
        whereClause(projectId, since),
        eq(schema.pageEvents.type, "view"),
        sql`${schema.pageEvents.referrer} IS NOT NULL AND ${schema.pageEvents.referrer} != ''`,
      ),
    )
    .groupBy(sql`SUBSTRING(${schema.pageEvents.referrer} FROM '^https?://([^/?#]+)')`)
    .orderBy(sql`COUNT(*) DESC`)
    .limit(8);

  return rows
    .filter((r): r is { host: string; count: number } => Boolean(r.host))
    .map((r) => ({ key: r.host, count: Number(r.count) }));
}

/** Top country codes (ISO alpha-2 from CF-IPCountry). */
async function getTopCountries(
  projectId: string,
  since: Date | null,
): Promise<InsightsRow[]> {
  const rows = await db
    .select({
      country: schema.pageEvents.country,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(schema.pageEvents)
    .where(
      and(
        whereClause(projectId, since),
        eq(schema.pageEvents.type, "view"),
        sql`${schema.pageEvents.country} IS NOT NULL`,
      ),
    )
    .groupBy(schema.pageEvents.country)
    .orderBy(sql`COUNT(*) DESC`)
    .limit(8);

  return rows
    .filter((r): r is { country: string; count: number } => Boolean(r.country))
    .map((r) => ({ key: r.country, count: Number(r.count) }));
}

/** Mobile / desktop / tablet view counts. */
async function getDeviceSplit(
  projectId: string,
  since: Date | null,
): Promise<InsightsDeviceSplit> {
  const rows = await db
    .select({
      device: schema.pageEvents.device,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(schema.pageEvents)
    .where(
      and(whereClause(projectId, since), eq(schema.pageEvents.type, "view")),
    )
    .groupBy(schema.pageEvents.device);

  const split: InsightsDeviceSplit = { mobile: 0, desktop: 0, tablet: 0 };
  for (const r of rows) {
    const k = r.device;
    const n = Number(r.count);
    if (k === "mobile") split.mobile = n;
    else if (k === "desktop") split.desktop = n;
    else if (k === "tablet") split.tablet = n;
  }
  return split;
}

/** Build the full Insights payload for a project + range. */
export async function getInsights(
  projectId: string,
  range: InsightsRange,
): Promise<Insights> {
  if (range === "all") {
    return getInsightsAll(projectId);
  }

  const since = sinceFor(range);
  const [totals, byDay, topReferrers, topCountries, deviceSplit, topLinks] =
    await Promise.all([
      getTotals(projectId, since),
      getByDay(projectId, since),
      getTopReferrers(projectId, since),
      getTopCountries(projectId, since),
      getDeviceSplit(projectId, since),
      getTopLinks(projectId, since),
    ]);

  return {
    range,
    totals,
    byDay,
    topReferrers,
    topCountries,
    deviceSplit,
    topLinks,
  };
}

// ─── "all" range — dual-source (rollup + today's raw) ──────────────────────

/** Headline KPIs for "all" range: rollup for historical days + raw for today. */
async function getTotalsAllRange(projectId: string): Promise<InsightsTotals> {
  const [historical, today] = await Promise.all([
    db
      .select({
        views: sql<number>`COALESCE(SUM(${schema.pageEventsDaily.count}) FILTER (WHERE ${schema.pageEventsDaily.type} = 'view'), 0)::int`,
        uniques: sql<number>`COALESCE(SUM(${schema.pageEventsDaily.uniques}) FILTER (WHERE ${schema.pageEventsDaily.type} = 'view'), 0)::int`,
        clicks: sql<number>`COALESCE(SUM(${schema.pageEventsDaily.count}) FILTER (WHERE ${schema.pageEventsDaily.type} = 'click'), 0)::int`,
      })
      .from(schema.pageEventsDaily)
      .where(
        and(
          eq(schema.pageEventsDaily.projectId, projectId),
          sql`${schema.pageEventsDaily.day} < CURRENT_DATE`,
        ),
      ),
    db
      .select({
        views: sql<number>`COUNT(*) FILTER (WHERE ${schema.pageEvents.type} = 'view')::int`,
        uniques: sql<number>`COUNT(DISTINCT ${schema.pageEvents.uaHash}) FILTER (WHERE ${schema.pageEvents.type} = 'view')::int`,
        clicks: sql<number>`COUNT(*) FILTER (WHERE ${schema.pageEvents.type} = 'click')::int`,
      })
      .from(schema.pageEvents)
      .where(
        and(
          eq(schema.pageEvents.projectId, projectId),
          sql`${schema.pageEvents.ts} >= CURRENT_DATE`,
        ),
      ),
  ]);

  const h = historical[0] ?? { views: 0, uniques: 0, clicks: 0 };
  const t = today[0] ?? { views: 0, uniques: 0, clicks: 0 };
  return {
    views: Number(h.views) + Number(t.views),
    uniques: Number(h.uniques) + Number(t.uniques),
    clicks: Number(h.clicks) + Number(t.clicks),
  };
}

/** Day buckets across rollup history + today's raw. */
async function getByDayAllRange(
  projectId: string,
): Promise<InsightsDayBucket[]> {
  const [historical, today] = await Promise.all([
    db
      .select({
        day: sql<string>`TO_CHAR(${schema.pageEventsDaily.day}, 'YYYY-MM-DD')`,
        views: sql<number>`COALESCE(SUM(${schema.pageEventsDaily.count}) FILTER (WHERE ${schema.pageEventsDaily.type} = 'view'), 0)::int`,
        clicks: sql<number>`COALESCE(SUM(${schema.pageEventsDaily.count}) FILTER (WHERE ${schema.pageEventsDaily.type} = 'click'), 0)::int`,
      })
      .from(schema.pageEventsDaily)
      .where(
        and(
          eq(schema.pageEventsDaily.projectId, projectId),
          sql`${schema.pageEventsDaily.day} < CURRENT_DATE`,
        ),
      )
      .groupBy(schema.pageEventsDaily.day)
      .orderBy(schema.pageEventsDaily.day),
    db
      .select({
        day: sql<string>`TO_CHAR(DATE_TRUNC('day', ${schema.pageEvents.ts}), 'YYYY-MM-DD')`,
        views: sql<number>`COUNT(*) FILTER (WHERE ${schema.pageEvents.type} = 'view')::int`,
        clicks: sql<number>`COUNT(*) FILTER (WHERE ${schema.pageEvents.type} = 'click')::int`,
      })
      .from(schema.pageEvents)
      .where(
        and(
          eq(schema.pageEvents.projectId, projectId),
          sql`${schema.pageEvents.ts} >= CURRENT_DATE`,
        ),
      )
      .groupBy(sql`DATE_TRUNC('day', ${schema.pageEvents.ts})`),
  ]);

  return [
    ...historical.map((r) => ({
      day: r.day,
      views: Number(r.views),
      clicks: Number(r.clicks),
    })),
    ...today.map((r) => ({
      day: r.day,
      views: Number(r.views),
      clicks: Number(r.clicks),
    })),
  ];
}

/** Top-link rows aggregated from the rollup over all time. The sparkline
 *  always reflects the last 7 days from raw events — same as the bounded
 *  ranges — so a hot link visually pops the same way regardless of range. */
async function getTopLinksAllRange(projectId: string): Promise<InsightsLink[]> {
  // Aggregate over rollup (all time). href '' is the placeholder used for
  // 'view' events in the rollup; filter to clicks only.
  const top = await db
    .select({
      href: schema.pageEventsDaily.href,
      clicks: sql<number>`SUM(${schema.pageEventsDaily.count})::int`,
    })
    .from(schema.pageEventsDaily)
    .where(
      and(
        eq(schema.pageEventsDaily.projectId, projectId),
        eq(schema.pageEventsDaily.type, "click"),
        sql`${schema.pageEventsDaily.href} != ''`,
      ),
    )
    .groupBy(schema.pageEventsDaily.href)
    .orderBy(sql`SUM(${schema.pageEventsDaily.count}) DESC`)
    .limit(20);

  if (top.length === 0) return [];

  const hrefs = top.map((t) => t.href);
  // Pull link labels + last-7d sparkline from raw events (the rollup
  // doesn't carry labels, and the sparkline window is always 7 days).
  const sevenAgo = new Date(Date.now() - 7 * DAY_MS);
  const [labelRows, bucketRows] = await Promise.all([
    db
      .select({
        href: schema.pageEvents.href,
        label: sql<string | null>`MAX(${schema.pageEvents.linkLabel})`,
      })
      .from(schema.pageEvents)
      .where(
        and(
          eq(schema.pageEvents.projectId, projectId),
          eq(schema.pageEvents.type, "click"),
          inArray(schema.pageEvents.href, hrefs),
        ),
      )
      .groupBy(schema.pageEvents.href),
    db
      .select({
        href: schema.pageEvents.href,
        day: sql<string>`TO_CHAR(DATE_TRUNC('day', ${schema.pageEvents.ts}), 'YYYY-MM-DD')`,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(schema.pageEvents)
      .where(
        and(
          eq(schema.pageEvents.projectId, projectId),
          eq(schema.pageEvents.type, "click"),
          gte(schema.pageEvents.ts, sevenAgo),
          inArray(schema.pageEvents.href, hrefs),
        ),
      )
      .groupBy(
        schema.pageEvents.href,
        sql`DATE_TRUNC('day', ${schema.pageEvents.ts})`,
      ),
  ]);

  const labelByHref = new Map(labelRows.map((r) => [r.href, r.label]));

  // 7 day slots oldest→newest.
  const slots: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * DAY_MS);
    slots.push(d.toISOString().slice(0, 10));
  }

  return top.map((row) => {
    const dayMap = new Map<string, number>();
    for (const b of bucketRows) {
      if (b.href === row.href) dayMap.set(b.day, Number(b.count));
    }
    return {
      href: row.href,
      label: labelByHref.get(row.href) ?? null,
      clicks: Number(row.clicks),
      sparkline: slots.map((d) => dayMap.get(d) ?? 0),
    };
  });
}

/** Top countries from the rollup (all time). */
async function getTopCountriesAllRange(
  projectId: string,
): Promise<InsightsRow[]> {
  const rows = await db
    .select({
      country: schema.pageEventsDaily.country,
      count: sql<number>`SUM(${schema.pageEventsDaily.count})::int`,
    })
    .from(schema.pageEventsDaily)
    .where(
      and(
        eq(schema.pageEventsDaily.projectId, projectId),
        eq(schema.pageEventsDaily.type, "view"),
        sql`${schema.pageEventsDaily.country} != ''`,
      ),
    )
    .groupBy(schema.pageEventsDaily.country)
    .orderBy(sql`SUM(${schema.pageEventsDaily.count}) DESC`)
    .limit(8);

  return rows.map((r) => ({ key: r.country, count: Number(r.count) }));
}

/** Device split from the rollup (all time). */
async function getDeviceSplitAllRange(
  projectId: string,
): Promise<InsightsDeviceSplit> {
  const rows = await db
    .select({
      device: schema.pageEventsDaily.device,
      count: sql<number>`SUM(${schema.pageEventsDaily.count})::int`,
    })
    .from(schema.pageEventsDaily)
    .where(
      and(
        eq(schema.pageEventsDaily.projectId, projectId),
        eq(schema.pageEventsDaily.type, "view"),
      ),
    )
    .groupBy(schema.pageEventsDaily.device);

  const split: InsightsDeviceSplit = { mobile: 0, desktop: 0, tablet: 0 };
  for (const r of rows) {
    const k = r.device;
    const n = Number(r.count);
    if (k === "mobile") split.mobile = n;
    else if (k === "desktop") split.desktop = n;
    else if (k === "tablet") split.tablet = n;
  }
  return split;
}

async function getInsightsAll(projectId: string): Promise<Insights> {
  // Top referrers stays raw-only (rollup doesn't track referrer). For
  // "all" range that effectively shows "last 90 days of referrers" —
  // acceptable v1 limit, fixable by adding referrer to the rollup later.
  const [totals, byDay, topReferrers, topCountries, deviceSplit, topLinks] =
    await Promise.all([
      getTotalsAllRange(projectId),
      getByDayAllRange(projectId),
      getTopReferrers(projectId, null),
      getTopCountriesAllRange(projectId),
      getDeviceSplitAllRange(projectId),
      getTopLinksAllRange(projectId),
    ]);

  return {
    range: "all",
    totals,
    byDay,
    topReferrers,
    topCountries,
    deviceSplit,
    topLinks,
  };
}
