// @vitest-environment node
// THE BOTTOM DOORS, ON A REAL POSTGRES (review items 13 and 18): `publishProject`, `unpublishProject` and
// `rollbackProject` respect a live A/B experiment, and explicit sources (`sourcesOverride`) are treated like a Len Watch
// branch's (`sourcesFrom`): their functions and their languages are theirs, never the draft's.
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/lib/db/schema";
import { runAbTestingMigration, type MigrationClient } from "@/scripts/ab-testing-migrate-sql";

vi.mock("server-only", () => ({}));
const base = vi.hoisted(() => ({ db: null as unknown }));
const m = vi.hoisted(() => ({
  prepareFunctions: vi.fn(),
  buildLive: vi.fn(),
  publishToDir: vi.fn(),
  prepareStripe: vi.fn(),
}));
vi.mock("@/lib/db", async () => {
  const s = await import("@/lib/db/schema");
  return {
    schema: s,
    get db() {
      return base.db;
    },
    inTransaction: async (fn: () => unknown) => fn(),
    afterCommit: (fn: () => unknown) => fn(),
  };
});
vi.mock("@/lib/limits", () => ({ getUserPlan: async () => "pro" }));
vi.mock("@/lib/functions/publish", () => ({ prepareFunctionsForPublish: m.prepareFunctions }));
vi.mock("@/lib/stripe/publish", () => ({ storedTwins: async () => new Map(), prepareStripeForPublish: m.prepareStripe }));
// Marks what control's head pass touched, so the test can tell that Variant B went through the same one.
vi.mock("@/lib/publish/ensure-page-meta", () => ({ ensurePageMeta: (html: string) => `${html}<!--META-->` }));
vi.mock("@/lib/branding/social-image", () => ({ ensureSocialOgImage: async (html: string) => html }));
vi.mock("@/lib/branding/resolve-project-logo", () => ({ resolveProjectLogo: async () => null }));
// The assistants tables aren't part of this test: the publish doesn't touch them here.
vi.mock("@/lib/assistants/enabled", () => ({ assistantsEnabled: () => false }));
vi.mock("@/lib/assistants/visitor/store", async (orig) => ({
  ...(await orig<typeof import("@/lib/assistants/visitor/store")>()),
  forgetWhatWasPublished: async () => undefined,
  assistantOnPage: async () => null,
}));
vi.mock("@/lib/ab/live-publish", () => ({ buildLiveAbPublish: m.buildLive }));
vi.mock("@/lib/publish/filesystem", async (orig) => ({
  ...(await orig<typeof import("@/lib/publish/filesystem")>()),
  publishToDir: m.publishToDir,
  unpublishDir: async () => undefined,
}));

const { publishProject, unpublishProject, rollbackProject } = await import("@/lib/projects");
const { ProjectIsToolError } = await import("@/lib/tools/errors");
const { AbExperimentRunningError } = await import("@/lib/ab/errors");

const pg = () => base.db as ReturnType<typeof drizzle>;
let raw: PGlite;

// ONE database for the file (a WASM Postgres per test crashed the worker once); every test resets its rows.
beforeAll(async () => {
  raw = new PGlite();
  await raw.query(`CREATE TABLE "projects" (
    "id" text PRIMARY KEY, "userId" text NOT NULL, "title" text, "data" jsonb, "subdomain" text, "logoUrl" text,
    "publishedAt" timestamp, "publishedHtml" text, "publishedHomeHash" text, "publishedPagesHash" text, "publishedFilesHash" text,
    "publishedEnvHash" text, "publishedReleaseSha" text, "status" text, "deployUrl" text, "updatedAt" timestamp);`);
  await raw.query(`CREATE TABLE "projectFiles" ("projectId" text NOT NULL, "path" text NOT NULL, "content" text NOT NULL);`);
  await raw.query(`CREATE TABLE "assistants" ("id" text PRIMARY KEY);`);
  await raw.query(`CREATE TABLE "pageEvents" ("id" text PRIMARY KEY, "projectId" text NOT NULL, "type" text NOT NULL, "cid" text, "uaHash" text, "ts" timestamp NOT NULL DEFAULT now());`);
  await raw.query(`CREATE TABLE "formSubmissions" ("id" text PRIMARY KEY, "projectId" text NOT NULL, "meta" jsonb, "createdAt" timestamp NOT NULL DEFAULT now());`);
  await runAbTestingMigration(raw as unknown as MigrationClient, { sleep: async () => undefined });
  base.db = drizzle(raw, { schema });
});
afterAll(async () => {
  await raw.close();
});

beforeEach(async () => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  await raw.exec(`DELETE FROM "abExperiments"; DELETE FROM "projects";`);
  await raw.query(`INSERT INTO "projects" ("id","userId","title","data","subdomain") VALUES
    ('p1','u1','Panadería','{"html":"<html>DRAFT</html>","settings":{}}','pan'),
    ('tool1','u1','Tool','{"html":"x","tool":{"bornAt":"2026-11-04T00:00:00Z"}}',null);`);
  m.prepareFunctions.mockResolvedValue(null);
  m.prepareStripe.mockResolvedValue(null);
  m.publishToDir.mockRejectedValue(new Error("STOP-AFTER-CLAIM"));
});

const liveExperiment = async (status = "running") =>
  raw.query(
    `INSERT INTO "abExperiments" ("id","projectId","name","targetPath","salt","status","createdBy","controlReleaseSha","startedAt")
     VALUES ('ab_1234abcd','p1','Direct hero','/','salt','${status}','u1','rel-c', CASE WHEN '${status}' = 'draft' THEN NULL ELSE now() END)`,
  );

describe("with the flag off", () => {
  it("🔴 a live experiment row is nobody's business: publishing and unpublishing are what they always were", async () => {
    await liveExperiment();
    await expect(publishProject({ projectId: "tool1", userId: "u1", subdomain: "tool" })).rejects.toBeInstanceOf(ProjectIsToolError);
    await expect(publishProject({ projectId: "p1", userId: "u1", subdomain: "pan" })).rejects.toThrow(/STOP-AFTER-CLAIM/);
    await expect(unpublishProject({ projectId: "p1", userId: "u1" })).resolves.toBeUndefined();
  });
});

describe("with the flag on and a live experiment", () => {
  beforeEach(() => {
    vi.stubEnv("OPENLEN_AB_TESTING", "1");
  });

  it("🔴 publishProject with no policy is refused, naming the experiment, before an address is claimed", async () => {
    await liveExperiment();
    const err = await publishProject({ projectId: "p1", userId: "u1", subdomain: "pan" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AbExperimentRunningError);
    expect(err).toMatchObject({ experimentId: "ab_1234abcd", experimentName: "Direct hero" });
    expect(m.prepareFunctions).not.toHaveBeenCalled();
    expect(m.publishToDir).not.toHaveBeenCalled();
  });

  it("🔴 unpublishProject is refused and the site stays published", async () => {
    await liveExperiment();
    await expect(unpublishProject({ projectId: "p1", userId: "u1" })).rejects.toBeInstanceOf(AbExperimentRunningError);
    const [row] = await pg().select({ subdomain: schema.projects.subdomain }).from(schema.projects).where(await import("drizzle-orm").then((d) => d.eq(schema.projects.id, "p1")));
    expect(row?.subdomain).toBe("pan");
  });

  it("🔴 rollbackProject is refused: an older release has no manifest", async () => {
    await liveExperiment();
    await expect(rollbackProject({ projectId: "p1", userId: "u1", sha: "a".repeat(64) })).rejects.toBeInstanceOf(AbExperimentRunningError);
  });

  it("🔴 `ending` (the experiment's own decision, «Stop and publish») goes through the door", async () => {
    await liveExperiment();
    await expect(publishProject({ projectId: "p1", userId: "u1", subdomain: "pan", abLive: "ending" })).rejects.toThrow(/STOP-AFTER-CLAIM/);
    expect(m.publishToDir).toHaveBeenCalledTimes(1);
  });

  it("a draft or ended experiment is no obstacle", async () => {
    await liveExperiment("draft");
    await expect(publishProject({ projectId: "p1", userId: "u1", subdomain: "pan" })).rejects.toThrow(/STOP-AFTER-CLAIM/);
  });

  it("🔴 a system republish (`keep`) publishes Control = the PUBLISHED sources with the experiment re-emitted, protecting Control's release", async () => {
    await liveExperiment();
    const published = { html: "<html>PUBLISHED</html>", settings: {} };
    const abExperiment = { id: "ab_1234abcd", targetPath: "/", splitBps: 5000, salt: "salt", includeLocales: false, variantB: { html: "<html>B</html>" } };
    // (Stripe has nothing copied to live here: toLive is null. The swap itself is lib/ab/prebake.test.ts.)
    m.buildLive.mockImplementation(async (exp: { id: string }) => ({
      experiment: exp,
      sourcesOverride: { data: published, folder: { "/css/a.css": "a{}", "/supabase/functions/hi/index.ts": "export {}" } },
      abExperiment,
      protectReleaseShas: ["rel-c"],
    }));
    await expect(publishProject({ projectId: "p1", userId: "u1", subdomain: "pan", abLive: "keep" })).rejects.toThrow(/STOP-AFTER-CLAIM/);
    const call = m.publishToDir.mock.calls[0]![0] as Record<string, unknown>;
    expect(call.html).toBe("<html>PUBLISHED</html><!--META-->");
    // 🔴 Variant B went through control's pre-bake (item 16): the same head pass.
    expect(call.abExperiment).toMatchObject({ id: "ab_1234abcd", variantB: { html: "<html>B</html><!--META-->" } });
    expect(call.protectReleaseShas).toEqual(["rel-c"]);
    expect((call.files as Array<{ path: string }>).map((f) => f.path).sort()).toEqual(["/css/a.css", "/supabase/functions/hi/index.ts"]);
  });

  it("a system republish that can't rebuild the experiment is refused: it must not end it", async () => {
    await liveExperiment();
    m.buildLive.mockResolvedValue(null);
    await expect(publishProject({ projectId: "p1", userId: "u1", subdomain: "pan", abLive: "keep" })).rejects.toBeInstanceOf(AbExperimentRunningError);
    expect(m.publishToDir).not.toHaveBeenCalled();
  });
});

describe("Variant B's Stripe ids are twinned too (G1+G3 review, item 15)", () => {
  const sources = { data: { html: "<html>CONTROL no stripe</html>", settings: {} }, folder: { "/css/a.css": "a{}" } };
  const spec = {
    id: "ab_1234abcd",
    targetPath: "/",
    splitBps: 5000,
    salt: "salt",
    includeLocales: false,
    variantB: {
      html: '<html><a data-price="price_OnlyBtest">B</a></html>',
      pages: [{ slug: "pricing", html: "<p>plink https://buy.stripe.com/test_PageOnlyB</p>" }],
      files: [{ path: "/js/pay.js", content: 'const p = "prod_OnlyBtest";' }],
    },
  };
  const twins = new Map([
    ["price_OnlyBtest", "price_OnlyBlive"],
    ["https://buy.stripe.com/test_PageOnlyB", "https://buy.stripe.com/live_PageOnlyB"],
    ["prod_OnlyBtest", "prod_OnlyBlive"],
  ]);

  beforeEach(() => vi.stubEnv("OPENLEN_AB_TESTING", "1"));

  it("🔴 what only B uses is looked for: B's home, pages and files are part of the texts the Stripe step reads", async () => {
    await expect(
      publishProject({ projectId: "p1", userId: "u1", subdomain: "pan", sourcesOverride: sources, abExperiment: spec }),
    ).rejects.toThrow(/STOP-AFTER-CLAIM/);
    const o = m.prepareStripe.mock.calls[0]![1] as { texts: string[] };
    expect(o.texts).toEqual(expect.arrayContaining([spec.variantB.html, spec.variantB.pages[0]!.html, spec.variantB.files[0]!.content]));
    // …and the control's own are still there
    expect(o.texts).toContain("<html>CONTROL no stripe</html><!--META-->");
  });

  it("🔴 a price id only B uses comes out LIVE in B's baked documents, with no Stripe ref in control at all", async () => {
    m.prepareStripe.mockResolvedValue({ preview: { plan: { create: {}, swaps: 3, unknownRefs: [], chargesEnabled: null, needsWrites: false, droppedImages: 0 }, accountName: null }, apply: async () => twins });
    await expect(
      publishProject({ projectId: "p1", userId: "u1", subdomain: "pan", sourcesOverride: sources, abExperiment: spec }),
    ).rejects.toThrow(/STOP-AFTER-CLAIM/);
    const call = m.publishToDir.mock.calls[0]![0] as { html: string; abExperiment: { variantB: { html: string; pages: { html: string }[]; files: { content: string }[] } } };
    expect(call.abExperiment.variantB.html).toContain("price_OnlyBlive");
    expect(call.abExperiment.variantB.html).not.toContain("price_OnlyBtest");
    expect(call.abExperiment.variantB.pages[0]!.html).toContain("live_PageOnlyB");
    expect(call.abExperiment.variantB.files[0]!.content).toContain("prod_OnlyBlive");
    // control had nothing to swap
    expect(call.html).toContain("CONTROL no stripe");
  });

  it("with no experiment the texts are exactly what they were", async () => {
    await expect(publishProject({ projectId: "p1", userId: "u1", subdomain: "pan" })).rejects.toThrow(/STOP-AFTER-CLAIM/);
    const o = m.prepareStripe.mock.calls[0]![1] as { texts: string[] };
    expect(o.texts).toEqual(["<html>DRAFT</html><!--META-->"]);
  });
});

describe("explicit sources are treated like a branch's (review item 18)", () => {
  const override = {
    data: { html: "<html>PUBLISHED</html>", settings: { languages: ["fr"] } },
    folder: { "/css/a.css": "a{}", "/supabase/functions/hi/index.ts": "export const live = 1", "/supabase/config.toml": "x" },
  };

  it("🔴 the functions come from the sources' own /supabase/ files — not the draft's", async () => {
    await expect(publishProject({ projectId: "p1", userId: "u1", subdomain: "pan", sourcesOverride: override })).rejects.toThrow(/STOP-AFTER-CLAIM/);
    expect(m.prepareFunctions).toHaveBeenCalledTimes(1);
    const opts = m.prepareFunctions.mock.calls[0]![1] as { files?: Record<string, string>; sourcesFrom?: string };
    expect(opts.files).toEqual({ "/supabase/functions/hi/index.ts": "export const live = 1", "/supabase/config.toml": "x" });
    expect(opts.sourcesFrom).toBeUndefined();
  });

  it("without explicit sources the functions are the project's, as before", async () => {
    await expect(publishProject({ projectId: "p1", userId: "u1", subdomain: "pan" })).rejects.toThrow(/STOP-AFTER-CLAIM/);
    expect(m.prepareFunctions.mock.calls[0]![1]).not.toHaveProperty("files");
  });

  it("🔴 languages asked for during such a publish are NOT written over the draft's data (they were: the published version replaced the draft)", async () => {
    await expect(
      publishProject({ projectId: "p1", userId: "u1", subdomain: "pan", languages: ["fr"], sourcesOverride: override }),
    ).rejects.toThrow(/STOP-AFTER-CLAIM/);
    const [row] = await pg().select({ data: schema.projects.data }).from(schema.projects).where(await import("drizzle-orm").then((d) => d.eq(schema.projects.id, "p1")));
    expect((row?.data as { html: string }).html).toBe("<html>DRAFT</html>");
  });

  it("CONTROL: the same languages without explicit sources are persisted on the project (the guard is what stopped it)", async () => {
    await expect(publishProject({ projectId: "p1", userId: "u1", subdomain: "pan", languages: ["fr"] })).rejects.toThrow(/STOP-AFTER-CLAIM/);
    const [row] = await pg().select({ data: schema.projects.data }).from(schema.projects).where(await import("drizzle-orm").then((d) => d.eq(schema.projects.id, "p1")));
    expect((row?.data as { settings: { languages: string[] } }).settings.languages).toEqual(["fr"]);
  });
});
