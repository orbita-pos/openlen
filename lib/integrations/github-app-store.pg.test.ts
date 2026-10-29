// @vitest-environment node
// The GitHub App's rows in Postgres (spec local 2026-10-28-ficheros-al-nivel-de-claude-code, §9): an installation is
// kept once per person, updated when it comes back, and disconnecting forgets it (LOCAL database only, with
// `npm run git:migrate`).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

vi.mock("server-only", () => ({}));

import { db } from "@/lib/db";
import { exigirBaseLocal } from "@/lib/len-bench/entorno";

import { installationsOf, originOf, ownsProject, removeInstallations, saveInstallation } from "./github-app-store";

const OWNER = "test-ghapp-owner";
const PROJECT = "test-ghapp-project";

async function clean() {
  await db.execute(sql`delete from "githubAppInstallations" where "userId" = ${OWNER}`);
  await db.execute(sql`delete from "projectGitRepos" where "projectId" = ${PROJECT}`);
  await db.execute(sql`delete from "projects" where "id" = ${PROJECT}`);
}

beforeAll(async () => {
  await exigirBaseLocal();
  await db.execute(sql`insert into "users" ("id", "email", "name") values (${OWNER}, ${`${OWNER}@example.invalid`}, ${"Owner"}) on conflict do nothing`);
  await clean();
  await db.execute(sql`insert into "projects" ("id", "userId", "title", "brief", "data") values (${PROJECT}, ${OWNER}, ${"g"}, ${""}, ${JSON.stringify({ html: "x" })}::jsonb)`);
});
afterAll(async () => {
  await clean();
});

describe("the GitHub App's installations", () => {
  it("saves, updates on the way back, lists in order and forgets on disconnect", async () => {
    await saveInstallation(OWNER, { installationId: 77, accountLogin: "ana", accountType: "User" });
    await saveInstallation(OWNER, { installationId: 88, accountLogin: "acme", accountType: "Organization" });
    await saveInstallation(OWNER, { installationId: 77, accountLogin: "ana-renamed", accountType: "User" });
    expect(await installationsOf(OWNER)).toEqual([
      { installationId: 77, accountLogin: "ana-renamed", accountType: "User" },
      { installationId: 88, accountLogin: "acme", accountType: "Organization" },
    ]);
    await removeInstallations(OWNER);
    expect(await installationsOf(OWNER)).toEqual([]);
  });

  it("only the owner owns the project; origin is what git remote get-url origin says", async () => {
    expect(await ownsProject(OWNER, PROJECT)).toBe(true);
    expect(await ownsProject("someone-else", PROJECT)).toBe(false);
    expect(await originOf(PROJECT)).toBeNull();
    await db.execute(
      sql`insert into "projectGitRepos" ("projectId", "head", "index", "remotes") values (${PROJECT}, ${"a".repeat(40)}, ${"{}"}::jsonb, ${JSON.stringify({ origin: { url: "https://github.com/ana/web.git", refs: {} } })}::jsonb)`,
    );
    expect(await originOf(PROJECT)).toBe("https://github.com/ana/web.git");
  });
});
