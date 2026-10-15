// @vitest-environment node
//
// The AI spend in Postgres (lib/app-ai/store-pg.ts) and the conditional debit
// (lib/credits.ts), against a LOCAL database with `app-ai:migrate` applied.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { debitCreditsIfEnough } from "@/lib/credits";
import { db, schema } from "@/lib/db";
import { exigirBaseLocal } from "@/lib/len-bench/entorno";

import { pgAppAiStore } from "./store-pg";

const OWNER = "test-appai-owner";
const PROJECT = "test-appai-project";
const MONTH = "1999-02";

async function clean() {
  await db.delete(schema.appAiSpend).where(eq(schema.appAiSpend.userId, OWNER));
  await db.delete(schema.appAiAlerts).where(eq(schema.appAiAlerts.userId, OWNER));
}

beforeAll(async () => {
  await exigirBaseLocal();
  await db.insert(schema.users).values({ id: OWNER, email: `${OWNER}@example.invalid`, name: OWNER }).onConflictDoNothing();
  await db.update(schema.users).set({ credits: 0, appAiCap: null }).where(eq(schema.users.id, OWNER));
  await clean();
});
afterAll(async () => {
  await clean();
  await db.delete(schema.users).where(eq(schema.users.id, OWNER));
});

describe("pgAppAiStore", () => {
  it("adds per project and environment, and sums the account's month", async () => {
    await pgAppAiStore.add({ userId: OWNER, month: MONTH, projectId: PROJECT, environment: "draft", centicredits: 3 });
    await pgAppAiStore.add({ userId: OWNER, month: MONTH, projectId: PROJECT, environment: "draft", centicredits: 4 });
    await pgAppAiStore.add({ userId: OWNER, month: MONTH, projectId: PROJECT, environment: "live", centicredits: 10 });
    await pgAppAiStore.add({ userId: OWNER, month: MONTH, projectId: "other", environment: "live", centicredits: 1 });
    expect(await pgAppAiStore.monthSpent(OWNER, MONTH)).toBe(18);
    expect(await pgAppAiStore.projectMonth(PROJECT, MONTH)).toEqual({ draft: { centicredits: 7, calls: 2 }, live: { centicredits: 10, calls: 1 } });
    expect(await pgAppAiStore.monthSpent(OWNER, "1999-03")).toBe(0);
  });

  it("claims each alert once a month, and 100 swallows 80", async () => {
    expect(await pgAppAiStore.claimCapAlert(OWNER, MONTH, 80)).toBe(true);
    expect(await pgAppAiStore.claimCapAlert(OWNER, MONTH, 80)).toBe(false);
    expect(await pgAppAiStore.claimCapAlert(OWNER, MONTH, 100)).toBe(true);
    expect(await pgAppAiStore.claimCapAlert(OWNER, MONTH, 80)).toBe(false);
  });

  it("🔴 ten claims at once: exactly one wins", async () => {
    const r = await Promise.all(Array.from({ length: 10 }, () => pgAppAiStore.claimCapAlert(OWNER, "1999-04", 80)));
    expect(r.filter(Boolean)).toHaveLength(1);
  });

  it("keeps the explicit cap", async () => {
    await pgAppAiStore.setExplicitCap(OWNER, 5_000);
    expect(await pgAppAiStore.explicitCap(OWNER)).toBe(5_000);
    await pgAppAiStore.setExplicitCap(OWNER, null);
    expect(await pgAppAiStore.explicitCap(OWNER)).toBeNull();
  });
});

describe("debitCreditsIfEnough", () => {
  it("🔴 ten debits at once with room for three: exactly three pass, never below zero", async () => {
    await db.update(schema.users).set({ credits: 30 }).where(eq(schema.users.id, OWNER));
    const r = await Promise.all(Array.from({ length: 10 }, () => debitCreditsIfEnough(OWNER, 10)));
    expect(r.filter(Boolean)).toHaveLength(3);
    const [u] = await db.select({ credits: schema.users.credits }).from(schema.users).where(eq(schema.users.id, OWNER));
    expect(u!.credits).toBe(0);
  });
});
