// @vitest-environment node
//
// The security reviews in Postgres (lib/security-review/store-pg.ts), against
// the LOCAL database with `security-review:migrate` applied: the same contract
// as the memory store.
import { afterAll, beforeAll, beforeEach } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { exigirBaseLocal } from "@/lib/len-bench/entorno";

import { describeStoreContract } from "./store-contract";
import { pgSecurityReviewStore } from "./store-pg";

const OWNER = "test-secreview-owner";
const PROJECTS = ["test-secreview-a", "test-secreview-b"];

async function clean() {
  await db.delete(schema.securityReviews).where(inArray(schema.securityReviews.projectId, PROJECTS));
  await db.delete(schema.securityAcceptances).where(inArray(schema.securityAcceptances.projectId, PROJECTS));
}

beforeAll(async () => {
  await exigirBaseLocal();
  // Plain SQL with only the columns these rows need: a Drizzle insert names every
  // declared column, and a local database a migration behind would refuse it for
  // reasons that have nothing to do with the reviews.
  await db.execute(sql`insert into "users" ("id", "email", "name") values (${OWNER}, ${`${OWNER}@example.invalid`}, ${OWNER}) on conflict do nothing`);
  for (const id of PROJECTS) {
    await db.execute(sql`insert into "projects" ("id", "userId", "title", "brief", "data") values (${id}, ${OWNER}, ${id}, '', ${JSON.stringify({ html: "<p>x</p>" })}::jsonb) on conflict do nothing`);
  }
});
beforeEach(clean);
afterAll(async () => {
  await clean();
  await db.delete(schema.projects).where(inArray(schema.projects.id, PROJECTS));
  await db.delete(schema.users).where(eq(schema.users.id, OWNER));
});

describeStoreContract("postgres", async () => ({ store: pgSecurityReviewStore, projectA: PROJECTS[0]!, projectB: PROJECTS[1]! }));
