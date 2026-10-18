// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ db: null as unknown, change: async () => {} }));
vi.mock("@/lib/db", async () => ({ schema: await import("@/lib/db/schema"), get db() { return m.db; } }));
vi.mock("@/lib/images", () => ({ processImage: async () => ({ variants: [{ bytes: Buffer.from("avif") }] }) }));
vi.mock("@/lib/storage", () => ({ getStorage: () => ({ upload: async () => { await m.change(); return { url: "https://image.test/new.avif" }; } }) }));
vi.mock("@/lib/security/render-ssrf-guard", () => ({ installSubresourceSsrfGuard: async () => {} }));
vi.mock("@/lib/ai/visual-quality-renderer", () => ({ lanzarChromium: async () => ({ newPage: async () => ({ on: () => {}, goto: async () => {}, setViewport: async () => {}, waitForNetworkIdle: async () => {}, evaluate: async () => {}, screenshot: async () => Buffer.from("png"), close: async () => {} }), close: async () => {} }) }));
vi.mock("@/lib/ai/origen-de-medida", () => ({ origenDeMedida: async () => ({ origin: "127.0.0.1:7777", publicar: () => ({ url: "http://127.0.0.1:7777/doc/", soltar: () => {} }) }) }));
import { renderProjectThumbnail, type DraftThumbnailGuard } from "./thumbnail";
import * as schema from "@/lib/db/schema";
import { draftEnvVersionSql } from "./thumbnail-state";
import { sql } from "drizzle-orm";

let pg: PGlite;
let guard: DraftThumbnailGuard;
beforeAll(async () => {
  pg = new PGlite(); m.db = drizzle(pg, { schema });
  await pg.exec(`CREATE TABLE projects (id text PRIMARY KEY, subdomain text, "publishedAt" timestamp, "updatedAt" timestamp, "filesHash" text, "envHash" text, "thumbnailUrl" text);
    CREATE TABLE "projectEnvVars" ("projectId" text, name text, value text, target text);`);
});
afterAll(async () => pg.close());
beforeEach(async () => {
  m.change = async () => {};
  await pg.exec(`DELETE FROM projects; DELETE FROM "projectEnvVars";
    INSERT INTO projects VALUES ('p1',NULL,NULL,'2026-10-17 12:00:00.123456','files1','prod1','https://image.test/old.avif');
    INSERT INTO "projectEnvVars" VALUES ('p1','VITE_TITLE','before','draft');`);
  const [row] = await drizzle(pg).select({ version: draftEnvVersionSql(sql`${schema.projects}."id"`) }).from(schema.projects);
  guard = { revision: "rev", updatedAt: "2026-10-17 12:00:00.123456", filesHash: "files1", envHash: "prod1", draftEnvVersion: row!.version };
});
const render = () => renderProjectThumbnail({ projectId: "p1", html: "<p>before</p>", draft: guard });

it("saves the current capture without moving the project's edit timestamp", async () => {
  expect(await render()).toBe("https://image.test/new.avif");
  const r = await pg.query<{ at: string }>(`select "updatedAt"::text as at from projects`);
  expect(r.rows[0]?.at).toBe(guard.updatedAt);
});
it.each([
  ['edit', `UPDATE projects SET "updatedAt"='2026-10-17 12:01:00'`],
  ['file change', `UPDATE projects SET "filesHash"='files2'`],
  ['production env change', `UPDATE projects SET "envHash"='prod2'`],
  ['draft env change', `UPDATE "projectEnvVars" SET value='after'`],
  ['publication', `UPDATE projects SET subdomain='published', "publishedAt"=now()`],
])("keeps the old image after a concurrent %s", async (_name, statement) => {
  m.change = async () => { await pg.exec(statement); };
  expect(await render()).toBeNull();
  const result = await pg.query<{ url: string }>('select "thumbnailUrl" as url from projects');
  expect(result.rows[0]?.url).toBe("https://image.test/old.avif");
});
