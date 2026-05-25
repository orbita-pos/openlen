// Daily aggregation + 90-day retention for the analytics events table.
//
// Run by openlen-analytics-rollup.timer at 03:17 UTC daily (offset from
// the backup timer to spread Hetzner / Neon load). Two passes:
//
//   1. Aggregate yesterday's pageEvents rows into pageEventsDaily (one
//      upsert per project × type × href × country × device). The composite
//      PK on pageEventsDaily makes ON CONFLICT idempotent — re-runs after
//      a crash converge instead of duplicating rows.
//
//   2. Delete pageEvents rows older than 90 days. The rollup preserves the
//      headline metrics (count + uniques) past the retention window, so
//      long-range queries still get data even after the raw rows go away.
//
// Failures in either pass surface to systemd's journal; no retries. The
// timer will fire again tomorrow.

import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

const RETENTION_DAYS = 90;

async function rollupYesterday(): Promise<void> {
  // Yesterday in UTC — 00:00 of (today - 1) through 00:00 of today. We
  // deliberately do NOT include the partial current day; that would
  // produce a row that grows during the day and double-counts on
  // tomorrow's run.
  const result = await db.execute(sql`
    INSERT INTO "pageEventsDaily" (
      "projectId", "day", "type", "href", "country", "device", "count", "uniques"
    )
    SELECT
      "projectId",
      DATE_TRUNC('day', "ts")::date AS day,
      "type",
      COALESCE("href", '') AS href,
      COALESCE("country", '') AS country,
      COALESCE("device", '') AS device,
      COUNT(*)::int AS count,
      COUNT(DISTINCT "uaHash")::int AS uniques
    FROM "pageEvents"
    WHERE "ts" >= (CURRENT_DATE - INTERVAL '1 day')
      AND "ts" <  CURRENT_DATE
    GROUP BY 1, 2, 3, 4, 5, 6
    ON CONFLICT ("projectId", "day", "type", "href", "country", "device")
    DO UPDATE SET
      "count"   = EXCLUDED."count",
      "uniques" = EXCLUDED."uniques";
  `);

  // eslint-disable-next-line no-console
  console.log(
    `[rollup] aggregated yesterday into pageEventsDaily — rows affected: ${result.rowCount ?? "?"}`,
  );
}

async function dropExpiredRawEvents(): Promise<void> {
  const result = await db.execute(sql`
    DELETE FROM "pageEvents"
    WHERE "ts" < NOW() - (${RETENTION_DAYS} || ' days')::interval;
  `);

  // eslint-disable-next-line no-console
  console.log(
    `[rollup] dropped expired raw events (>${RETENTION_DAYS}d) — rows: ${result.rowCount ?? "?"}`,
  );
}

async function main(): Promise<void> {
  await rollupYesterday();
  await dropExpiredRawEvents();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("[rollup] failed", err);
    process.exit(1);
  });
