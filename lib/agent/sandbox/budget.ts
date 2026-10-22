// OpenLen's daily cap on the real terminal (spec local 2026-10-21-real-terminal-e2b, §8): over it,
// turns use today's terminal. What is in the ledger counts, and so does what the boxes running right
// now have spent since their turn took them (they are charged when the turn closes): turns that start
// together see each other. A hold older than two hours is a dead turn's, and its box is paused.

import { utcDayStart } from "@/lib/security-review/budget";

import { SANDBOX_USD_PER_SECOND } from "./size";

export async function sandboxBudgetOk(o: {
  readonly now: Date;
  readonly dailyUsd: number;
  readonly spentTodayMicroUsd: (from: Date) => Promise<number>;
}): Promise<boolean> {
  if (!(o.dailyUsd > 0)) return false;
  try {
    return (await o.spentTodayMicroUsd(utcDayStart(o.now))) < o.dailyUsd * 1_000_000;
  } catch {
    // Without the ledger there is no cap to check: no box this turn, today's terminal still works.
    return false;
  }
}

/** What the boxes cost OpenLen since `from` — the ledger plus the boxes running now — in micro-dollars. */
export async function spentTodayMicroUsd(from: Date): Promise<number> {
  const { db } = await import("@/lib/db");
  const { sql } = await import("drizzle-orm");
  type Row = { spent: string | number; running: string | number };
  const r = (await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL statement_timeout = '5s'`);
    return tx.execute(sql`
      SELECT
        (SELECT COALESCE(SUM("costMicroUsd"), 0)::bigint FROM "creditLedger"
          WHERE "surface" = 'sandbox' AND "createdAt" >= ${from}) AS spent,
        (SELECT COALESCE(SUM(GREATEST(0, EXTRACT(EPOCH FROM now() - GREATEST("updatedAt", ${from}::timestamptz)))), 0) FROM "projectSandboxes"
          WHERE "state" = 'running' AND "heldBy" IS NOT NULL AND "updatedAt" > now() - interval '2 hours') AS running
    `);
  })) as unknown as { rows?: Row[] } | Row[];
  const row = Array.isArray(r) ? r[0] : r.rows?.[0];
  return Number(row?.spent ?? 0) + Math.round(Number(row?.running ?? 0) * SANDBOX_USD_PER_SECOND * 1_000_000);
}
