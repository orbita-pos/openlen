// lib/app-ai/store-pg.ts — THE AI SPEND IN THE APP'S DATABASE (spec local
// 2026-10-15, 4.4). Each write is ONE statement; the alert's condition lives
// in the WHERE of its upsert, so two calls at once can't both win it.

import "server-only";

import { eq, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";

import type { AppAiEnvironment, AppAiStore, ProjectMonth } from "./store";

/** `db.execute` returns a node-postgres result (with `.rows`) or an array. */
function rows(r: unknown): unknown[] {
  return Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? []);
}

export const pgAppAiStore: AppAiStore = {
  async monthSpent(userId, month) {
    const [f] = rows(await db.execute(sql`
      SELECT coalesce(sum("centicredits"), 0)::int AS total FROM "appAiSpend"
      WHERE "userId" = ${userId} AND "month" = ${month}`)) as { total: number | string }[];
    return Number(f?.total ?? 0);
  },
  async add({ userId, month, projectId, environment, centicredits }) {
    await db.execute(sql`
      INSERT INTO "appAiSpend" ("userId", "month", "projectId", "environment", "centicredits", "calls")
      VALUES (${userId}, ${month}, ${projectId}, ${environment}, ${centicredits}, 1)
      ON CONFLICT ("userId", "month", "projectId", "environment")
      DO UPDATE SET "centicredits" = "appAiSpend"."centicredits" + EXCLUDED."centicredits",
                    "calls" = "appAiSpend"."calls" + 1`);
  },
  async projectMonth(projectId, month) {
    const out: Record<AppAiEnvironment, ProjectMonth> = { draft: { centicredits: 0, calls: 0 }, live: { centicredits: 0, calls: 0 } };
    const found = rows(await db.execute(sql`
      SELECT "environment", sum("centicredits")::int AS centicredits, sum("calls")::int AS calls
      FROM "appAiSpend" WHERE "projectId" = ${projectId} AND "month" = ${month}
      GROUP BY "environment"`)) as { environment: string; centicredits: number | string; calls: number | string }[];
    for (const f of found) {
      if (f.environment === "draft" || f.environment === "live") out[f.environment] = { centicredits: Number(f.centicredits), calls: Number(f.calls) };
    }
    return out;
  },
  async claimCapAlert(userId, month, percent) {
    const r = await db.execute(sql`
      INSERT INTO "appAiAlerts" ("userId", "month", "percent") VALUES (${userId}, ${month}, ${percent})
      ON CONFLICT ("userId", "month") DO UPDATE SET "percent" = EXCLUDED."percent"
      WHERE "appAiAlerts"."percent" < EXCLUDED."percent"
      RETURNING 1`);
    return rows(r).length > 0;
  },
  async explicitCap(userId) {
    const [u] = await db.select({ cap: schema.users.appAiCap }).from(schema.users).where(eq(schema.users.id, userId)).limit(1);
    return u?.cap ?? null;
  },
  async setExplicitCap(userId, cap) {
    await db.update(schema.users).set({ appAiCap: cap }).where(eq(schema.users.id, userId));
  },
};
