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

import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { sourceKey, type EventSource } from "@/lib/analytics/cid";

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
  /** Views per document — key is the path ('/' = home, '/pricing' = site
   *  page). Raw-only like referrers/browsers: the rollup doesn't carry the
   *  page, so "all" range effectively shows the last ≤90 days. Events from
   *  before the page column existed count as home. */
  topPages: InsightsRow[];
  topReferrers: InsightsRow[];
  topCountries: InsightsRow[];
  topBrowsers: InsightsRow[];
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

/** Views per document, newest-biggest first. A site caps at 21 documents
 *  (home + MAX_SITE_PAGES) so the limit only trims junk. */
async function getTopPages(
  projectId: string,
  since: Date | null,
): Promise<InsightsRow[]> {
  const rows = await db
    .select({
      page: schema.pageEvents.page,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(schema.pageEvents)
    .where(
      and(whereClause(projectId, since), eq(schema.pageEvents.type, "view")),
    )
    .groupBy(schema.pageEvents.page)
    .orderBy(sql`COUNT(*) DESC`)
    .limit(21);

  return rows.map((r) => ({
    key: r.page ? `/${r.page}` : "/",
    count: Number(r.count),
  }));
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

/** Top browsers (chrome/safari/firefox/edge/other). Raw-only — the rollup
 *  doesn't carry browser, so for "all" range this is the last ≤90 days. */
async function getTopBrowsers(
  projectId: string,
  since: Date | null,
): Promise<InsightsRow[]> {
  const rows = await db
    .select({
      browser: schema.pageEvents.browser,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(schema.pageEvents)
    .where(
      and(
        whereClause(projectId, since),
        eq(schema.pageEvents.type, "view"),
        sql`${schema.pageEvents.browser} IS NOT NULL`,
      ),
    )
    .groupBy(schema.pageEvents.browser)
    .orderBy(sql`COUNT(*) DESC`)
    .limit(8);

  return rows
    .filter((r): r is { browser: string; count: number } => Boolean(r.browser))
    .map((r) => ({ key: r.browser, count: Number(r.count) }));
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
  const [
    totals,
    byDay,
    topPages,
    topReferrers,
    topCountries,
    topBrowsers,
    deviceSplit,
    topLinks,
  ] = await Promise.all([
    getTotals(projectId, since),
    getByDay(projectId, since),
    getTopPages(projectId, since),
    getTopReferrers(projectId, since),
    getTopCountries(projectId, since),
    getTopBrowsers(projectId, since),
    getDeviceSplit(projectId, since),
    getTopLinks(projectId, since),
  ]);

  return {
    range,
    totals,
    byDay,
    topPages,
    topReferrers,
    topCountries,
    topBrowsers,
    deviceSplit,
    topLinks,
  };
}

// ─── "all" range — dual-source (rollup + today's raw) ──────────────────────

/** Headline KPIs for "all" range: rollup for historical days + raw for today. */
async function getTotalsAllRange(projectId: string): Promise<InsightsTotals> {
  const [historical, today, uniqueRows] = await Promise.all([
    db
      .select({
        views: sql<number>`COALESCE(SUM(${schema.pageEventsDaily.count}) FILTER (WHERE ${schema.pageEventsDaily.type} = 'view'), 0)::int`,
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
        clicks: sql<number>`COUNT(*) FILTER (WHERE ${schema.pageEvents.type} = 'click')::int`,
      })
      .from(schema.pageEvents)
      .where(
        and(
          eq(schema.pageEvents.projectId, projectId),
          sql`${schema.pageEvents.ts} >= CURRENT_DATE`,
        ),
      ),
    // Uniques can't be summed across days (returning visitors would
    // double-count) and can't be exact once raw uaHashes are shed after 90d.
    // COUNT DISTINCT over ALL retained raw events — exact for the ≤90d window
    // (which is everything for a young page) instead of inflating the total.
    db
      .select({
        uniques: sql<number>`COUNT(DISTINCT ${schema.pageEvents.uaHash}) FILTER (WHERE ${schema.pageEvents.type} = 'view')::int`,
      })
      .from(schema.pageEvents)
      .where(eq(schema.pageEvents.projectId, projectId)),
  ]);

  const h = historical[0] ?? { views: 0, clicks: 0 };
  const t = today[0] ?? { views: 0, clicks: 0 };
  return {
    views: Number(h.views) + Number(t.views),
    uniques: Number(uniqueRows[0]?.uniques ?? 0),
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

// ─── Conversion funnel — saw → clicked → submitted → booked ────────────────
//
// Distinct session visitor ids (cid, lib/analytics/cid.ts) that reached each
// stage, plus first-touch acquisition source per visitor with lead attribution.
// "Untracked" = submissions/bookings with no cid (e.g. a native no-JS form POST
// where the JS-stamped hidden input never filled) — reported honestly rather
// than silently dropped or mis-attributed.
//
// Source is frozen client-side per session, so a cid maps to exactly one source
// — the per-cid scan below collapses to ~one row per visitor. Capped at
// SOURCE_SCAN_CAP; a daily rollup (deferred) replaces the scan at scale.

export interface FunnelSource {
  /** utm_source, else referrer host, else "direct". */
  key: string;
  visitors: number;
  leads: number;
}

export interface Funnel {
  range: InsightsRange;
  /** Distinct cids with a view / click / form submission / booking. */
  saw: number;
  clicked: number;
  submitted: number;
  booked: number;
  /** Submissions / bookings with no cid — untracked (e.g. native no-JS POST). */
  untrackedLeads: number;
  untrackedBookings: number;
  /** Top acquisition sources by first-touch, with lead attribution. */
  sources: FunnelSource[];
}

const SOURCE_SCAN_CAP = 5000;

// "booked" = a successful conversion. Exclude cancelled / no_show so the
// terminal funnel rate isn't inflated by bookings that fell through. Aligns
// with the slot-guard's live set (confirmed/pending) + completed past ones.
const BOOKED_STATUSES = ["confirmed", "pending", "completed"] as const;

export async function getFunnel(
  projectId: string,
  range: InsightsRange,
): Promise<Funnel> {
  const since = sinceFor(range);
  const evScope = since
    ? and(
        eq(schema.pageEvents.projectId, projectId),
        gte(schema.pageEvents.ts, since),
      )
    : eq(schema.pageEvents.projectId, projectId);
  const subScope = since
    ? and(
        eq(schema.formSubmissions.projectId, projectId),
        gte(schema.formSubmissions.createdAt, since),
      )
    : eq(schema.formSubmissions.projectId, projectId);
  const bkScope = and(
    eq(schema.bookings.projectId, projectId),
    inArray(schema.bookings.status, BOOKED_STATUSES),
    ...(since ? [gte(schema.bookings.createdAt, since)] : []),
  );

  const cidJson = sql<string>`${schema.formSubmissions.meta} ->> 'cid'`;

  const [stageRows, subRows, bkRows, sourceCidRows, leadCidRows] =
    await Promise.all([
      db
        .select({
          saw: sql<number>`COUNT(DISTINCT ${schema.pageEvents.cid}) FILTER (WHERE ${schema.pageEvents.type} = 'view')::int`,
          clicked: sql<number>`COUNT(DISTINCT ${schema.pageEvents.cid}) FILTER (WHERE ${schema.pageEvents.type} = 'click')::int`,
        })
        .from(schema.pageEvents)
        .where(and(evScope, sql`${schema.pageEvents.cid} IS NOT NULL`)),
      db
        .select({
          submitted: sql<number>`COUNT(DISTINCT ${schema.formSubmissions.meta} ->> 'cid')::int`,
          untracked: sql<number>`COUNT(*) FILTER (WHERE ${schema.formSubmissions.meta} ->> 'cid' IS NULL)::int`,
        })
        .from(schema.formSubmissions)
        .where(subScope),
      db
        .select({
          booked: sql<number>`COUNT(DISTINCT ${schema.bookings.cid})::int`,
          untracked: sql<number>`COUNT(*) FILTER (WHERE ${schema.bookings.cid} IS NULL)::int`,
        })
        .from(schema.bookings)
        .where(bkScope),
      // First-touch source per cid: DISTINCT ON (cid) ORDER BY cid, ts ASC →
      // exactly one row per cid = its EARLIEST view's source. Deterministic
      // (the cap truncates a stable cid-ordered set, not an arbitrary one).
      db
        .selectDistinctOn([schema.pageEvents.cid], {
          cid: schema.pageEvents.cid,
          source: schema.pageEvents.source,
        })
        .from(schema.pageEvents)
        .where(
          and(
            evScope,
            eq(schema.pageEvents.type, "view"),
            sql`${schema.pageEvents.cid} IS NOT NULL`,
          ),
        )
        .orderBy(schema.pageEvents.cid, asc(schema.pageEvents.ts))
        .limit(SOURCE_SCAN_CAP),
      // Distinct cids that submitted a lead — attributed to their source below.
      // Ordered so the cap truncates deterministically.
      db
        .selectDistinct({ cid: cidJson })
        .from(schema.formSubmissions)
        .where(and(subScope, sql`${schema.formSubmissions.meta} ->> 'cid' IS NOT NULL`))
        .orderBy(cidJson)
        .limit(SOURCE_SCAN_CAP),
    ]);

  // cid → first-touch source key (one row per cid from DISTINCT ON).
  const cidToSrc = new Map<string, string>();
  for (const r of sourceCidRows) {
    if (!r.cid || cidToSrc.has(r.cid)) continue;
    cidToSrc.set(r.cid, sourceKey(r.source as EventSource | null));
  }
  const visitorsBySrc = new Map<string, number>();
  for (const src of cidToSrc.values()) {
    visitorsBySrc.set(src, (visitorsBySrc.get(src) ?? 0) + 1);
  }
  const leadsBySrc = new Map<string, number>();
  for (const r of leadCidRows) {
    if (!r.cid) continue;
    // A lead whose cid has no in-range view (e.g. converted on a prior day
    // outside the range) is "unattributed" — don't fold it into "direct".
    const src = cidToSrc.get(r.cid) ?? "unattributed";
    leadsBySrc.set(src, (leadsBySrc.get(src) ?? 0) + 1);
  }
  const sources: FunnelSource[] = [
    ...new Set([...visitorsBySrc.keys(), ...leadsBySrc.keys()]),
  ]
    .map((key) => ({
      key,
      visitors: visitorsBySrc.get(key) ?? 0,
      leads: leadsBySrc.get(key) ?? 0,
    }))
    .sort((a, b) => b.visitors - a.visitors || b.leads - a.leads)
    .slice(0, 8);

  return {
    range,
    saw: Number(stageRows[0]?.saw ?? 0),
    clicked: Number(stageRows[0]?.clicked ?? 0),
    submitted: Number(subRows[0]?.submitted ?? 0),
    booked: Number(bkRows[0]?.booked ?? 0),
    untrackedLeads: Number(subRows[0]?.untracked ?? 0),
    untrackedBookings: Number(bkRows[0]?.untracked ?? 0),
    sources,
  };
}

async function getInsightsAll(projectId: string): Promise<Insights> {
  // Top referrers + pages stay raw-only (rollup tracks neither). For
  // "all" range that effectively shows "the last 90 days" of each —
  // acceptable v1 limit, fixable by adding them to the rollup later.
  const [
    totals,
    byDay,
    topPages,
    topReferrers,
    topCountries,
    topBrowsers,
    deviceSplit,
    topLinks,
  ] = await Promise.all([
    getTotalsAllRange(projectId),
    getByDayAllRange(projectId),
    getTopPages(projectId, null),
    getTopReferrers(projectId, null),
    getTopCountriesAllRange(projectId),
    getTopBrowsers(projectId, null),
    getDeviceSplitAllRange(projectId),
    getTopLinksAllRange(projectId),
  ]);

  return {
    range: "all",
    totals,
    byDay,
    topPages,
    topReferrers,
    topCountries,
    topBrowsers,
    deviceSplit,
    topLinks,
  };
}
