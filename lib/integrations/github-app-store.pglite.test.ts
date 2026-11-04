// @vitest-environment node
//
// A project's GitHub repository and the owner's token for it (spec local 2026-11-04-hazlo, §7.4.5): the remote gh would
// pick, the owner's installation for its account, a token asked for that one repository. Against PGlite.
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/lib/db/schema";

const base = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", async () => ({
  schema: await import("@/lib/db/schema"),
  get db() {
    return base.db;
  },
}));

const { githubRepoOfProject } = await import("./github-app-store");

let pg: PGlite;
beforeEach(async () => {
  pg = new PGlite();
  await pg.exec(`
    CREATE TABLE "githubAppInstallations" ("userId" text NOT NULL, "installationId" bigint NOT NULL, "accountLogin" text NOT NULL, "accountType" text NOT NULL, "createdAt" timestamp NOT NULL DEFAULT now(), PRIMARY KEY ("userId", "installationId"));
    CREATE TABLE "projectGitRepos" ("projectId" text PRIMARY KEY, "remotes" jsonb NOT NULL DEFAULT '{}');`);
  base.db = drizzle(pg, { schema });
});

describe("githubRepoOfProject", () => {
  it("says why when there is no remote, no installation or no token", async () => {
    const token = vi.fn(async () => "ghs_tok");
    expect(await githubRepoOfProject("p1", "owner", token)).toEqual({ ok: false, reason: "no_remote" });
    await pg.query(`INSERT INTO "projectGitRepos" VALUES ('p1', $1)`, [JSON.stringify({ origin: { url: "https://github.com/ana/web.git", refs: {} } })]);
    expect(await githubRepoOfProject("p1", "owner", token)).toEqual({ ok: false, reason: "not_connected" });
    await pg.query(`INSERT INTO "githubAppInstallations" ("userId", "installationId", "accountLogin", "accountType") VALUES ('owner', 77, 'Ana', 'User')`);
    expect(await githubRepoOfProject("p1", "owner", token)).toEqual({ ok: true, owner: "ana", repo: "web", token: "ghs_tok" });
    expect(token).toHaveBeenCalledWith([{ installationId: 77, accountLogin: "Ana", accountType: "User" }], "https://github.com/ana/web.git");
    expect(await githubRepoOfProject("p1", "owner", async () => null)).toEqual({ ok: false, reason: "no_token" });
  });
});
