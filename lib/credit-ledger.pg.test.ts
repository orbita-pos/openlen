// @vitest-environment node
//
// The spend ledger against a LOCAL database with `credit-ledger:migrate` applied:
// the row and the balance move in one statement, also under concurrent charges.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";

import { chargeCredits, chargeCreditsIfEnough, recordUncharged, returnCredits } from "@/lib/credits";
import { db, schema } from "@/lib/db";
import { exigirBaseLocal } from "@/lib/len-bench/entorno";

import type { LedgerEntry } from "./credit-ledger";

const OWNER = "test-ledger-owner";
const ENTRY: LedgerEntry = {
  surface: "agent_turn",
  outcome: "ok",
  projectId: "test-ledger-project",
  refId: "turn-1",
  listCenticredits: 120,
  uses: [{ provider: "fireworks", model: "accounts/fireworks/models/deepseek-v4p1-flash", inputTokens: 1_000, cachedTokens: 0, outputTokens: 10 }],
};

async function setBalance(credits: number, plan = "pro") {
  await db.update(schema.users).set({ credits, plan }).where(eq(schema.users.id, OWNER));
}
async function balance(): Promise<number> {
  const [u] = await db.select({ credits: schema.users.credits }).from(schema.users).where(eq(schema.users.id, OWNER));
  return u.credits;
}
async function ledger() {
  return db.select().from(schema.creditLedger).where(eq(schema.creditLedger.userId, OWNER));
}

beforeAll(async () => {
  await exigirBaseLocal();
  // Raw SQL with only the columns this test needs: Drizzle's insert names every
  // column of `users`, and a local database a few migrations behind would fail
  // on ones that have nothing to do with the ledger.
  await db.execute(sql`INSERT INTO "users" ("id", "email", "name") VALUES (${OWNER}, ${`${OWNER}@example.invalid`}, ${OWNER}) ON CONFLICT DO NOTHING`);
});
beforeEach(async () => {
  await db.delete(schema.creditLedger).where(eq(schema.creditLedger.userId, OWNER));
});
afterAll(async () => {
  await db.delete(schema.creditLedger).where(eq(schema.creditLedger.userId, OWNER));
  await db.delete(schema.users).where(eq(schema.users.id, OWNER));
});

describe("creditLedger", () => {
  it("one row per charge, with what really left the balance", async () => {
    await setBalance(500);
    expect(await chargeCredits(OWNER, 120, ENTRY)).toBe(120);
    expect(await balance()).toBe(380);
    const [row] = await ledger();
    expect(row).toMatchObject({
      plan: "pro",
      surface: "agent_turn",
      projectId: "test-ledger-project",
      refId: "turn-1",
      centicredits: 120,
      listCenticredits: 120,
      balanceAfter: 380,
      outcome: "ok",
      provider: "fireworks",
      inputTokens: 1_000,
      outputTokens: 10,
      // 1 000 × 0.30 + 10 × 1.20 = 312 micro-USD
      costMicroUsd: 312,
    });
  });

  it("a charge bigger than the balance is clamped and says so", async () => {
    await setBalance(0);
    expect(await chargeCredits(OWNER, 120, ENTRY)).toBe(0);
    expect(await balance()).toBe(0);
    const [row] = await ledger();
    expect(row).toMatchObject({ centicredits: 0, listCenticredits: 120, balanceAfter: 0 });
  });

  it("ten charges at once: the ledger sums exactly what the balance lost", async () => {
    await setBalance(10_000);
    await Promise.all(Array.from({ length: 10 }, () => chargeCredits(OWNER, 37, ENTRY)));
    expect(await balance()).toBe(9_630);
    const rows = await ledger();
    expect(rows).toHaveLength(10);
    expect(rows.reduce((s, r) => s + r.centicredits, 0)).toBe(370);
  });

  it("returnCredits writes a negative row", async () => {
    await setBalance(100);
    await returnCredits(OWNER, 40, { surface: "app_ai", outcome: "settle", refId: "req-1" });
    expect(await balance()).toBe(140);
    const [row] = await ledger();
    expect(row).toMatchObject({ centicredits: -40, balanceAfter: 140, outcome: "settle", costMicroUsd: null });
  });

  it("chargeCreditsIfEnough without balance writes nothing", async () => {
    await setBalance(10);
    expect(await chargeCreditsIfEnough(OWNER, 50, { surface: "app_ai", outcome: "reserve" })).toBe(false);
    expect(await balance()).toBe(10);
    expect(await ledger()).toHaveLength(0);
    expect(await chargeCreditsIfEnough(OWNER, 10, { surface: "app_ai", outcome: "reserve" })).toBe(true);
    expect(await balance()).toBe(0);
    expect((await ledger())[0]).toMatchObject({ centicredits: 10, balanceAfter: 0 });
  });

  it("recordUncharged leaves the balance alone", async () => {
    await setBalance(200);
    await recordUncharged(OWNER, { ...ENTRY, surface: "security_review", outcome: "ok" });
    expect(await balance()).toBe(200);
    const [row] = await ledger();
    expect(row).toMatchObject({ centicredits: 0, balanceAfter: null, surface: "security_review", costMicroUsd: 312 });
  });

  it("the row keeps the plan of the moment", async () => {
    await setBalance(500, "pro");
    await chargeCredits(OWNER, 10, ENTRY);
    await setBalance(500, "free");
    const [row] = await ledger();
    expect(row.plan).toBe("pro");
  });
});
