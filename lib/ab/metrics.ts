// Unique-visitor attribution queries for OpenLen Edge A/B Testing (Plan 3).
// Counts distinct visitors (COALESCE(cid, uaHash)) so repeat reloads never inflate
// conversion rates, and snapshots daily totals into `abExperimentDaily`.
import "server-only";

import { sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { formatAbTag } from "@/lib/analytics/ab-tag";
import { evaluateAbStats } from "./stats";
import type {
  AbMetricsSnapshot,
  AbPrimaryMetric,
  AbVariant,
  AbVariantCounts,
} from "./types";

export interface ComputeMetricsInput {
  readonly experimentId: string;
  readonly projectId: string;
  readonly primaryMetric: AbPrimaryMetric;
  readonly splitBps: number;
  readonly startedAt: Date;
  readonly endedAt?: Date | null;
  readonly maxDurationDays?: number;
}

interface RawVariantAggregate {
  readonly views: number;
  readonly clicks: number;
  readonly conversions: number;
}

async function aggregateVariant(
  projectId: string,
  abTag: string,
  primaryMetric: AbPrimaryMetric,
  startedAt: Date,
  upperBound: Date,
): Promise<RawVariantAggregate> {
  // 1. Unique views and CTA/outbound clicks from pageEvents (indexed on projectId, ab, ts).
  const eventRes = await db.execute<{
    views: number;
    clicks: number;
    outbound_clicks: number;
    orders: number;
  }>(sql`
    SELECT
      (COUNT(DISTINCT COALESCE("cid", "uaHash")) FILTER (WHERE "type" = 'view'))::int AS views,
      (COUNT(DISTINCT COALESCE("cid", "uaHash")) FILTER (WHERE "type" IN ('click', 'cta')))::int AS clicks,
      (COUNT(DISTINCT COALESCE("cid", "uaHash")) FILTER (WHERE "type" = 'click'))::int AS outbound_clicks,
      (COUNT(DISTINCT COALESCE("cid", "uaHash")) FILTER (WHERE "type" = 'order'))::int AS orders
    FROM "pageEvents"
    WHERE "projectId" = ${projectId}
      AND "ab" = ${abTag}
      AND "ts" >= ${startedAt}
      AND "ts" <= ${upperBound}
  `);

  const evRow = eventRes.rows[0];
  const views = Number(evRow?.views ?? 0);
  const clicks = Number(evRow?.clicks ?? 0);

  if (primaryMetric === "cta_click") {
    return { views, clicks, conversions: clicks };
  }

  // 2. Form submissions attributed statically via meta->>'ab' OR joined via exposed cid.
  const formRes = await db.execute<{ form_convs: number }>(sql`
    WITH exposed_cids AS (
      SELECT DISTINCT "cid"
      FROM "pageEvents"
      WHERE "projectId" = ${projectId}
        AND "ab" = ${abTag}
        AND "type" = 'view'
        AND "cid" IS NOT NULL
        AND "ts" >= ${startedAt}
        AND "ts" <= ${upperBound}
    )
    SELECT COUNT(DISTINCT COALESCE("meta" ->> 'cid', "id"))::int AS form_convs
    FROM "formSubmissions"
    WHERE "projectId" = ${projectId}
      AND "createdAt" >= ${startedAt}
      AND "createdAt" <= ${upperBound}
      AND (
        ("meta" ->> 'ab') = ${abTag}
        OR (("meta" ->> 'ab') IS NULL AND ("meta" ->> 'cid') IN (SELECT "cid" FROM exposed_cids))
      )
  `);
  const formConvs = Number(formRes.rows[0]?.form_convs ?? 0);

  if (primaryMetric === "form_submit") {
    return { views, clicks, conversions: formConvs };
  }

  // 3. `conversion_any`: union of distinct converters across forms, bookings, orders, outbound clicks.
  const anyRes = await db.execute<{ total_convs: number }>(sql`
    WITH exposed_cids AS (
      SELECT DISTINCT "cid"
      FROM "pageEvents"
      WHERE "projectId" = ${projectId}
        AND "ab" = ${abTag}
        AND "type" = 'view'
        AND "cid" IS NOT NULL
        AND "ts" >= ${startedAt}
        AND "ts" <= ${upperBound}
    ),
    converters AS (
      SELECT COALESCE("meta" ->> 'cid', 'form:' || "id") AS actor
      FROM "formSubmissions"
      WHERE "projectId" = ${projectId}
        AND "createdAt" >= ${startedAt}
        AND "createdAt" <= ${upperBound}
        AND (
          ("meta" ->> 'ab') = ${abTag}
          OR (("meta" ->> 'ab') IS NULL AND ("meta" ->> 'cid') IN (SELECT "cid" FROM exposed_cids))
        )
      UNION
      SELECT COALESCE("cid", 'booking:' || "id") AS actor
      FROM "bookings"
      WHERE "projectId" = ${projectId}
        AND "createdAt" >= ${startedAt}
        AND "createdAt" <= ${upperBound}
        AND "cid" IN (SELECT "cid" FROM exposed_cids)
      UNION
      SELECT COALESCE("cid", "uaHash") AS actor
      FROM "pageEvents"
      WHERE "projectId" = ${projectId}
        AND "ab" = ${abTag}
        AND "type" IN ('click', 'order')
        AND "ts" >= ${startedAt}
        AND "ts" <= ${upperBound}
    )
    SELECT COUNT(DISTINCT actor)::int AS total_convs FROM converters WHERE actor IS NOT NULL
  `);

  const conversions = Number(anyRes.rows[0]?.total_convs ?? formConvs);
  return { views, clicks, conversions };
}

function toCounts(raw: RawVariantAggregate): AbVariantCounts {
  const conversions = Math.min(raw.views, raw.conversions);
  return {
    views: raw.views,
    clicks: raw.clicks,
    conversions,
    rate: raw.views > 0 ? conversions / raw.views : 0,
  };
}

export async function computeExperimentMetrics(
  input: ComputeMetricsInput,
  now: Date = new Date(),
): Promise<AbMetricsSnapshot> {
  const upperBound = input.endedAt && input.endedAt < now ? input.endedAt : now;
  const [rawA, rawB] = await Promise.all([
    aggregateVariant(
      input.projectId,
      formatAbTag(input.experimentId, "a"),
      input.primaryMetric,
      input.startedAt,
      upperBound,
    ),
    aggregateVariant(
      input.projectId,
      formatAbTag(input.experimentId, "b"),
      input.primaryMetric,
      input.startedAt,
      upperBound,
    ),
  ]);

  const a = toCounts(rawA);
  const b = toCounts(rawB);
  const durationHours = Math.max(0, (upperBound.getTime() - input.startedAt.getTime()) / 3_600_000);
  const stats = evaluateAbStats({
    viewsA: a.views,
    conversionsA: a.conversions,
    viewsB: b.views,
    conversionsB: b.conversions,
    splitBps: input.splitBps,
    durationHours,
    maxDurationDays: input.maxDurationDays,
  });

  return {
    a,
    b,
    stats,
    computedAt: now.toISOString(),
  };
}

/** Persist today's cumulative/daily snapshot into `abExperimentDaily` so historical
 *  experiment charts survive beyond the 90-day raw `pageEvents` retention window. */
export async function upsertExperimentDailySnapshot(
  experimentId: string,
  dayIso: string,
  variant: AbVariant,
  counts: AbVariantCounts,
): Promise<void> {
  await db
    .insert(schema.abExperimentDaily)
    .values({
      experimentId,
      day: dayIso,
      variant,
      views: counts.views,
      clicks: counts.clicks,
      conversions: counts.conversions,
    })
    .onConflictDoUpdate({
      target: [
        schema.abExperimentDaily.experimentId,
        schema.abExperimentDaily.day,
        schema.abExperimentDaily.variant,
      ],
      set: {
        views: counts.views,
        clicks: counts.clicks,
        conversions: counts.conversions,
      },
    });
}
