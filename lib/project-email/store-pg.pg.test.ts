// @vitest-environment node
//
// The project email tables in Postgres. Runs ONLY on a throwaway database:
// DATABASE_URL=postgres://postgres@127.0.0.1:5562/openlen, migrated with scripts/email-migrate.ts.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { exigirBaseLocal } from "@/lib/len-bench/entorno";

import { pgEmailStore } from "./store-pg";
import { describeEmailStoreContract } from "./store-contract";

const OWNER = "test-email-owner";
const A = "test-email-project-a";
const B = "test-email-project-b";

async function fresh(): Promise<void> {
  for (const id of [A, B]) {
    await db.delete(schema.projects).where(eq(schema.projects.id, id));
    await db.insert(schema.projects).values({ id, userId: OWNER, title: "email", brief: "", data: { html: "<p>x</p>" } });
  }
  await db.delete(schema.emailUsage).where(eq(schema.emailUsage.ownerId, OWNER));
  await db.delete(schema.emailBlocks).where(inArray(schema.emailBlocks.id, [A, B, OWNER]));
  // Rows of an earlier run that the cascade didn't take (none should exist).
  await db.delete(schema.emailDomains).where(inArray(schema.emailDomains.sendingHost, ["notify.taller.mx", "notify.otro.mx", "taller.mx"]));
}

beforeAll(async () => {
  await exigirBaseLocal();
  await db.insert(schema.users).values({ id: OWNER, email: `${OWNER}@example.invalid`, name: OWNER }).onConflictDoNothing();
});
beforeEach(fresh);
afterAll(async () => {
  for (const id of [A, B]) await db.delete(schema.projects).where(eq(schema.projects.id, id));
  await db.delete(schema.emailBlocks).where(inArray(schema.emailBlocks.id, [A, B, OWNER]));
  await db.delete(schema.users).where(eq(schema.users.id, OWNER));
});

describeEmailStoreContract("pgEmailStore", async () => ({ store: pgEmailStore, projectA: A, projectB: B, owner: OWNER }));

describe("pgEmailStore and the project", () => {
  it("deleting the project deletes its domain, messages and suppressions", async () => {
    await pgEmailStore.putDomain({
      projectId: A, domain: "taller.mx", sendingHost: "notify.taller.mx", showAsRoot: false, resendDomainId: "rd_1",
      records: [], status: "pending", lastCheckedAt: null, verifiedAt: null,
    });
    await pgEmailStore.logMessage({ projectId: A, ownerId: OWNER, environment: "live", kind: "app", toAddress: "a@x.com", subject: "s", status: "sent", reason: null, resendId: null, tag: null });
    await pgEmailStore.suppress(A, "a@x.com", "bounced");
    await db.delete(schema.projects).where(eq(schema.projects.id, A));
    expect(await pgEmailStore.getDomain(A)).toBeNull();
    expect(await pgEmailStore.recentMessages(A, 10)).toEqual([]);
    expect(await pgEmailStore.listSuppressions(A)).toEqual([]);
  });
});
