// @vitest-environment node
//
// Installed workspace themes, their releases and a person's choices against real Postgres (PGlite), with the tables
// exactly as `npm run themes:migrate` creates them (spec local 2026-11-27-temas-del-workspace, §12.1).
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/lib/db/schema";

import type { StoredThemeDefinition } from "./types";

const base = vi.hoisted(() => ({ db: null as unknown, pg: null as unknown }));
vi.mock("@/lib/db", async () => {
  const s = await import("@/lib/db/schema");
  return {
    schema: s,
    get db() {
      return base.db;
    },
  };
});

const { CREATE_THEMES } = await import("@/scripts/themes-migrate-sql");
const store = await import("./store");

const pg = () => base.pg as PGlite;
const count = async (table: string) => {
  const { rows } = await pg().query(`SELECT count(*)::int AS n FROM "${table}"`);
  return (rows[0] as { n: number }).n;
};

const SCENE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60"><rect width="100" height="60" fill="#0b3a2e"/><!-- estanque · «quieto» --></svg>`;

const estanque: StoredThemeDefinition = {
  id: "estanque",
  window: "light",
  twin: "estanque-noche",
  scene: SCENE,
  glass: { blur: 10, opacity: 0.38, tint: "#eef8f1" },
  titles: { en: "Pond", es: "Estanque" },
  blurbs: { en: "Still water.", es: "Agua quieta." },
};
const night: StoredThemeDefinition = {
  id: "estanque-noche",
  window: "dark",
  twin: "estanque",
  scene: SCENE.replace("#0b3a2e", "#04120d"),
  glass: { blur: 10, opacity: 0.45, tint: "#0c1a14" },
  titles: { en: "Pond at night", es: "Estanque de noche" },
  blurbs: { en: "The same pond, dark.", es: "El mismo estanque, de noche." },
};

const release = (over: Partial<Parameters<typeof store.saveThemeRelease>[0]> = {}) => ({
  sha: "sha-1",
  projectId: "p1",
  themes: [estanque, night],
  costs: {
    estanque: { elements: 40, animated: 3, heavy: false },
    "estanque-noche": { elements: 40, animated: 3, heavy: false },
  },
  glassAdjusted: { "estanque-noche": 0.52 },
  ...over,
});

beforeEach(async () => {
  const db = new PGlite();
  await db.query(`CREATE TABLE "users" ("id" text PRIMARY KEY);`);
  await db.query(`CREATE TABLE "projects" ("id" text PRIMARY KEY);`);
  await db.query(`INSERT INTO "users" VALUES ('u1'), ('u2');`);
  await db.query(`INSERT INTO "projects" VALUES ('p1'), ('p2');`);
  // Twice: the migration is idempotent.
  for (const statement of [...CREATE_THEMES, ...CREATE_THEMES]) await db.query(statement);
  base.pg = db;
  base.db = drizzle(db, { schema });
});

describe("install, choose, remove", () => {
  it("saves a release, installs it, chooses it everywhere and finds the choice from a project; a reinstall keeps its row", async () => {
    await store.saveThemeRelease(release());
    const first = await store.upsertThemeInstallation({ personId: "u1", projectId: "p1", releaseSha: "sha-1" });
    const ref = `installed:${first.id}:estanque`;
    await store.setThemeChoice("u1", "everywhere", ref);
    expect(await store.themeChoicesOf("u1", "p2")).toEqual({ project: null, everywhere: ref });

    // A choice for ONE project does not touch «everywhere», and clearing it leaves «everywhere» as it was.
    const bundled = "bundled:honu-lagoon";
    await store.setThemeChoice("u1", "p2", bundled);
    expect(await store.themeChoicesOf("u1", "p2")).toEqual({ project: bundled, everywhere: ref });
    await store.setThemeChoice("u1", "p2", null);
    expect(await store.themeChoicesOf("u1", "p2")).toEqual({ project: null, everywhere: ref });

    // Installing again moves the row to the new version: same id, same count.
    await store.saveThemeRelease(release({ sha: "sha-2" }));
    const again = await store.upsertThemeInstallation({ personId: "u1", projectId: "p1", releaseSha: "sha-2" });
    expect(again.id).toBe(first.id);
    expect(again.releaseSha).toBe("sha-2");
    expect(await count("themeInstallations")).toBe(1);
    expect((await store.themeChoicesOf("u1", "p2")).everywhere).toBe(ref);
  });

  it("removing keeps the row, marks it, and a reinstall brings it back", async () => {
    await store.saveThemeRelease(release());
    const row = await store.upsertThemeInstallation({ personId: "u1", projectId: "p1", releaseSha: "sha-1" });
    expect(row.removedAt).toBeNull();
    expect(await store.markThemeRemoved(row.id, "u1")).toBe(true);
    const [removed] = await store.listThemeInstallations("u1");
    expect(removed?.id).toBe(row.id);
    expect(removed?.removedAt).not.toBeNull();
    expect(await count("themeInstallations")).toBe(1);

    const back = await store.upsertThemeInstallation({ personId: "u1", projectId: "p1", releaseSha: "sha-1" });
    expect(back.id).toBe(row.id);
    expect(back.removedAt).toBeNull();
  });

  it("another person can't remove it", async () => {
    await store.saveThemeRelease(release());
    const row = await store.upsertThemeInstallation({ personId: "u1", projectId: "p1", releaseSha: "sha-1" });
    expect(await store.markThemeRemoved(row.id, "u2")).toBe(false);
    expect((await store.listThemeInstallations("u1"))[0]?.removedAt).toBeNull();
    expect(await store.markThemeRemoved("no-such-id", "u1")).toBe(false);
  });

  it("lists only the person's own installations, oldest first, removed ones included", async () => {
    await store.saveThemeRelease(release());
    await store.saveThemeRelease(release({ sha: "sha-p2", projectId: "p2" }));
    const a = await store.upsertThemeInstallation({ personId: "u1", projectId: "p1", releaseSha: "sha-1" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const b = await store.upsertThemeInstallation({ personId: "u1", projectId: "p2", releaseSha: "sha-p2" });
    await store.upsertThemeInstallation({ personId: "u2", projectId: "p1", releaseSha: "sha-1" });
    await store.markThemeRemoved(a.id, "u1");
    expect((await store.listThemeInstallations("u1")).map((r) => r.id)).toEqual([a.id, b.id]);
    expect((await store.listThemeInstallations("u2")).length).toBe(1);
    expect(await store.listThemeInstallations("nobody")).toEqual([]);
  });
});

describe("theme releases", () => {
  it("keeps the checked scenes as text, the costs and the glass adjustments, byte for byte", async () => {
    await store.saveThemeRelease(release());
    const read = await store.readThemeRelease("sha-1");
    expect(read?.sha).toBe("sha-1");
    expect(read?.projectId).toBe("p1");
    expect(read?.themes).toEqual([estanque, night]);
    expect(read?.themes[0]?.scene).toBe(SCENE);
    expect(read?.costs.estanque).toEqual({ elements: 40, animated: 3, heavy: false });
    expect(read?.glassAdjusted).toEqual({ "estanque-noche": 0.52 });
    expect(read?.createdAt).toBeInstanceOf(Date);
    expect(await store.readThemeRelease("missing")).toBeNull();
  });

  it("saving is idempotent on the sha: a version never changes", async () => {
    await store.saveThemeRelease(release());
    await store.saveThemeRelease(release({ themes: [{ ...estanque, titles: { en: "Changed" } }], glassAdjusted: {} }));
    const read = await store.readThemeRelease("sha-1");
    expect(read?.themes[0]?.titles.en).toBe("Pond");
    expect(read?.glassAdjusted).toEqual({ "estanque-noche": 0.52 });
    expect(await count("themeReleases")).toBe(1);
  });

  it("pruning deletes only the project's versions no installation points at, anyone's and removed ones counted", async () => {
    await store.saveThemeRelease(release({ sha: "old" }));
    await store.saveThemeRelease(release({ sha: "u1-now" }));
    await store.saveThemeRelease(release({ sha: "u2-removed" }));
    await store.saveThemeRelease(release({ sha: "other-project", projectId: "p2" }));
    await store.upsertThemeInstallation({ personId: "u1", projectId: "p1", releaseSha: "old" });
    // u1 moves on: «old» is pointed at by nobody now.
    await store.upsertThemeInstallation({ personId: "u1", projectId: "p1", releaseSha: "u1-now" });
    const u2 = await store.upsertThemeInstallation({ personId: "u2", projectId: "p1", releaseSha: "u2-removed" });
    await store.markThemeRemoved(u2.id, "u2");

    expect(await store.pruneThemeReleases("p1")).toBe(1);
    expect(await store.readThemeRelease("old")).toBeNull();
    expect(await store.readThemeRelease("u1-now")).not.toBeNull();
    expect(await store.readThemeRelease("u2-removed")).not.toBeNull();
    // Another project's version, which nothing points at either, is not this project's to prune.
    expect(await store.readThemeRelease("other-project")).not.toBeNull();
    expect(await store.pruneThemeReleases("p1")).toBe(0);
  });

  it("a theme without a scene (a palette alone) needs no costs", async () => {
    const plain: StoredThemeDefinition = { id: "tinta", window: "dark", colors: { "--bg": "#101010" }, titles: { en: "Ink" }, blurbs: { en: "Just a palette." } };
    await store.saveThemeRelease({ sha: "sha-plain", projectId: "p1", themes: [plain], costs: {}, glassAdjusted: {} });
    expect((await store.readThemeRelease("sha-plain"))?.themes).toEqual([plain]);
  });
});

describe("choices", () => {
  it("one choice per person and scope: choosing again replaces it", async () => {
    await store.setThemeChoice("u1", "everywhere", "bundled:a");
    await store.setThemeChoice("u1", "everywhere", "bundled:b");
    expect(await count("workspaceThemeChoices")).toBe(1);
    expect(await store.themeChoicesOf("u1", null)).toEqual({ project: null, everywhere: "bundled:b" });
  });

  it("without a project, only «everywhere» is read", async () => {
    await store.setThemeChoice("u1", "everywhere", "bundled:a");
    await store.setThemeChoice("u1", "p1", "bundled:b");
    expect(await store.themeChoicesOf("u1", null)).toEqual({ project: null, everywhere: "bundled:a" });
  });

  it("each person has their own, and a project's choice is not another project's", async () => {
    await store.setThemeChoice("u1", "p1", "bundled:a");
    await store.setThemeChoice("u2", "p1", "bundled:b");
    expect(await store.themeChoicesOf("u1", "p2")).toEqual({ project: null, everywhere: null });
    expect(await store.themeChoicesOf("u1", "p1")).toEqual({ project: "bundled:a", everywhere: null });
    expect(await store.themeChoicesOf("u2", "p1")).toEqual({ project: "bundled:b", everywhere: null });
  });

  it("clearing a choice that was never there is not an error", async () => {
    await store.setThemeChoice("u1", "p1", null);
    await store.setThemeChoice("u1", "everywhere", null);
    expect(await count("workspaceThemeChoices")).toBe(0);
  });
});

describe("what deleting takes with it", () => {
  it("deleting the theme's project deletes its release and its installations", async () => {
    await store.saveThemeRelease(release());
    await store.upsertThemeInstallation({ personId: "u1", projectId: "p1", releaseSha: "sha-1" });
    await pg().query(`DELETE FROM "projects" WHERE "id" = 'p1'`);
    expect(await store.listThemeInstallations("u1")).toEqual([]);
    expect(await store.readThemeRelease("sha-1")).toBeNull();
  });

  it("deleting a person deletes their installations and choices", async () => {
    await store.saveThemeRelease(release());
    await store.upsertThemeInstallation({ personId: "u1", projectId: "p1", releaseSha: "sha-1" });
    await store.setThemeChoice("u1", "everywhere", "bundled:a");
    await store.setThemeChoice("u2", "everywhere", "bundled:b");
    await pg().query(`DELETE FROM "users" WHERE "id" = 'u1'`);
    expect(await count("themeInstallations")).toBe(0);
    expect(await count("workspaceThemeChoices")).toBe(1);
    expect(await store.themeChoicesOf("u2", null)).toEqual({ project: null, everywhere: "bundled:b" });
  });
});
