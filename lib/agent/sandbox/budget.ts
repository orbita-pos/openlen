// OpenLen's daily cap on the real terminal (spec local 2026-10-21-real-terminal-e2b, §8): over it,
// turns use today's terminal. What is in the ledger counts; a box still running lands when its turn
// closes, so what is in flight can pass the cap by a few cents (like the security review's cap).

import { utcDayStart } from "@/lib/security-review/budget";

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

/** What the boxes cost OpenLen since `from`, from the ledger, in micro-dollars. */
export async function spentTodayMicroUsd(from: Date): Promise<number> {
  const { db } = await import("@/lib/db");
  const { sql } = await import("drizzle-orm");
  const r = (await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL statement_timeout = '5s'`);
    return tx.execute(sql`
      SELECT COALESCE(SUM("costMicroUsd"), 0)::bigint AS spent
      FROM "creditLedger"
      WHERE "surface" = 'sandbox' AND "createdAt" >= ${from}
    `);
  })) as unknown as { rows?: { spent: string | number }[] } | { spent: string | number }[];
  const row = Array.isArray(r) ? r[0] : r.rows?.[0];
  return Number(row?.spent ?? 0);
}
