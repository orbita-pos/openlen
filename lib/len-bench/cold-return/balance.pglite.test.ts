// @vitest-environment node
//
// THE SERVER'S LOCK ON THE CAP (review, finding 1): the owner's balance is opened ONCE at the cap and from
// then on only ever goes down — by what the route itself charges, or because the runner's own count says
// less is left. It never goes back up: a runner whose count is stuck at zero cannot refill it.
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";

import { balanceUsd, lowerBalance, openBalance } from "./balance";
import type { Sql } from "./snapshot";

let pg: PGlite;
let sql: Sql;
const credits = async () => (await pg.query<{ credits: number; at: string | null }>(`select "credits", "creditsRefreshedAt"::text as at from "users" where "id" = 'u1'`)).rows[0]!;

beforeEach(async () => {
  pg = new PGlite();
  sql = { query: async (text, params) => (await pg.query(text, params as unknown[] | undefined)).rows as never };
  await pg.exec(`
    create table "users" ("id" text primary key, "credits" integer not null default 0, "creditsRefreshedAt" timestamp);
    insert into "users" values ('u1', 500000, null), ('other', 777, null);
  `);
});

describe("the owner's balance as the cap's lock", () => {
  it("opening it sets it to the cap, in the unit the route charges in, and stamps it so the plan's refill does not fire", async () => {
    await openBalance(sql, "u1", 1.5);
    // One credit is one cent; the column holds hundredths of a credit.
    expect((await credits()).credits).toBe(15_000);
    expect((await credits()).at).not.toBeNull();
    expect(await balanceUsd(sql, "u1")).toBeCloseTo(1.5, 9);
  });

  it("🔴 it is only ever lowered: a count that says more is left than the balance does not raise it", async () => {
    await openBalance(sql, "u1", 1);
    // The route charged 30 cents on its own.
    await pg.exec(`update "users" set "credits" = 7000 where "id" = 'u1'`);
    await lowerBalance(sql, "u1", 1);
    expect((await credits()).credits).toBe(7_000);
    await lowerBalance(sql, "u1", 0.25);
    expect((await credits()).credits).toBe(2_500);
    await lowerBalance(sql, "u1", 0.9);
    expect((await credits()).credits).toBe(2_500);
  });

  it("at the end it is left at zero, and never below", async () => {
    await openBalance(sql, "u1", 1);
    await lowerBalance(sql, "u1", 0);
    expect((await credits()).credits).toBe(0);
    await lowerBalance(sql, "u1", -3);
    expect((await credits()).credits).toBe(0);
  });

  it("nobody else's balance is touched", async () => {
    await openBalance(sql, "u1", 1);
    await lowerBalance(sql, "u1", 0.1);
    expect((await pg.query<{ credits: number }>(`select "credits" from "users" where "id" = 'other'`)).rows[0]!.credits).toBe(777);
  });
});
