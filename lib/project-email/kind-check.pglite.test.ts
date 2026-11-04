// @vitest-environment node
//
// The owner's reply (spec local 2026-11-04-hazlo-que-se-puede-y-mas-fuentes, §7.6.6) is its own kind of email, and
// production's `emailMessages` was created refusing any kind but app, auth and form. `scripts/email-migrate.ts` swaps
// that CHECK, idempotently, against real Postgres (PGlite).
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

import { EMAIL_MESSAGES_KIND_CHECK } from "@/scripts/email-migrate-sql";

describe("emailMessages.kind", () => {
  it("admits a reply after the migration, run twice, and still refuses an unknown kind", async () => {
    const pg = new PGlite();
    // The column as production has it since 2026-10-22.
    await pg.query(`CREATE TABLE "emailMessages" ("id" text PRIMARY KEY, "kind" text NOT NULL CHECK ("kind" IN ('app', 'auth', 'form')))`);
    for (let run = 0; run < 2; run++) for (const statement of EMAIL_MESSAGES_KIND_CHECK) await pg.query(statement);
    await pg.query(`INSERT INTO "emailMessages" VALUES ('m1', 'reply'), ('m2', 'form')`);
    await expect(pg.query(`INSERT INTO "emailMessages" VALUES ('m3', 'broadcast')`)).rejects.toThrow(/emailMessages_kind_check/);
  });
});
