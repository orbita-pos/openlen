// @vitest-environment node
//
// WHAT LEN PROPOSED, KEPT ON THE SERVER (spec local 2026-11-19-agentes-para-todos, §6.6; final review C2, I1): the card
// shows it on every reload and only to the person who asked; «Guardar» saves what is stored here, atomically, never over a
// skill that changed since it was proposed.
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/lib/db/schema";

const base = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", async () => {
  const s = await import("@/lib/db/schema");
  return {
    schema: s,
    get db() {
      return base.db;
    },
  };
});

const { CREATE_LEN_SKILLS } = await import("@/scripts/len-skills-migrate-sql");
const { listSkills, upsertSkill, deleteSkill } = await import("./store");
const { proposalsFor, saveProposedSkill, saveSkillProposals } = await import("./proposal-store");
const { skillFingerprint } = await import("./proposals");

const fileOf = (name: string, body = "Water when the soil is dry.") => `---\nname: ${name}\ndescription: Look after plants.\n---\n\n${body}\n`;
const BUNDLED = new Set(["cooking"]);
const proposal = (o: { name?: string; kind?: "new" | "improvement"; skillMd?: string; baseText?: string | null } = {}) => {
  const name = o.name ?? "plant-care";
  const skillMd = o.skillMd ?? fileOf(name);
  const baseText = o.baseText ?? null;
  return {
    name,
    kind: o.kind ?? "new",
    target: o.kind === "improvement" ? name : null,
    description: "Look after plants.",
    skillMd,
    base: baseText === null ? null : skillFingerprint(baseText),
    fingerprint: skillFingerprint(skillMd),
    baseText,
  };
};
const live = async (person: string, name: string) => (await listSkills("personal", person)).find((s) => s.name === name)?.text;

let pg: PGlite;
beforeEach(async () => {
  pg = new PGlite();
  // Only the columns the proposals' keys point at: the real tables are OpenLen's first migration.
  await pg.query(`CREATE TABLE "users" ("id" text PRIMARY KEY)`);
  await pg.query(`CREATE TABLE "projects" ("id" text PRIMARY KEY, "parentProjectId" text)`);
  await pg.query(`INSERT INTO "users" ("id") VALUES ('u1'), ('u2')`);
  await pg.query(`INSERT INTO "projects" ("id") VALUES ('p1'), ('p2')`);
  for (const statement of CREATE_LEN_SKILLS) await pg.query(statement);
  base.db = drizzle(pg, { schema });
});

describe("the proposals", () => {
  // Delivery 2's deferred minor: they stayed after their project or the person's account was deleted.
  // Final review of the minors pass: a Len Watch turn works in a hidden copy (its `parentProjectId` is the real project)
  // that is deleted after «Traer» or a discard; the card in the real chat lost its proposals with it.
  it("🔴 made in a hidden copy, they go with the real project, not with the copy", async () => {
    await pg.query(`INSERT INTO "projects" ("id", "parentProjectId") VALUES ('copy-1', 'p1')`);
    const [id] = await saveSkillProposals("u1", "copy-1", [proposal({ name: "one-skill" })]);
    await pg.query(`DELETE FROM "projects" WHERE "id" = 'copy-1'`);
    expect((await proposalsFor("u1", [id!])).map((p) => p.name)).toEqual(["one-skill"]);
  });

  it("🔴 go with the project they were proposed in, and with the person's account", async () => {
    const [inP1] = await saveSkillProposals("u1", "p1", [proposal({ name: "one-skill" })]);
    const [inP2] = await saveSkillProposals("u1", "p2", [proposal({ name: "two-skill" })]);
    const [theirsInP1] = await saveSkillProposals("u2", "p1", [proposal({ name: "three-skill" })]);
    await pg.query(`DELETE FROM "projects" WHERE "id" = 'p1'`);
    expect((await proposalsFor("u1", [inP1!, inP2!])).map((p) => p.name)).toEqual(["two-skill"]);
    expect(await proposalsFor("u2", [theirsInP1!])).toEqual([]);
    await pg.query(`DELETE FROM "users" WHERE "id" = 'u1'`);
    expect(await proposalsFor("u1", [inP2!])).toEqual([]);
  });

  it("🔴 are read back only by the person who asked, in the order asked", async () => {
    const [a, b] = await saveSkillProposals("u1", "p1", [proposal({ name: "one-skill" }), proposal({ name: "two-skill" })]);
    const [theirs] = await saveSkillProposals("u2", "p1", [proposal({ name: "three-skill" })]);
    expect((await proposalsFor("u1", [b!, a!, theirs!])).map((p) => p.name)).toEqual(["two-skill", "one-skill"]);
    expect(await proposalsFor("u2", [a!])).toEqual([]);
  });
});

describe("saving a proposal", () => {
  it("🔴 a new one becomes the person's skill, and saving it again says saved", async () => {
    const [id] = await saveSkillProposals("u1", "p1", [proposal()]);
    expect(await saveProposedSkill("u1", id!, BUNDLED)).toEqual({ ok: true, fingerprint: skillFingerprint(fileOf("plant-care")) });
    expect(await live("u1", "plant-care")).toBe(fileOf("plant-care"));
    expect(await saveProposedSkill("u1", id!, BUNDLED)).toMatchObject({ ok: true });
  });

  it("🔴 another person's proposal is not found, and nothing is saved", async () => {
    const [id] = await saveSkillProposals("u1", "p1", [proposal()]);
    expect(await saveProposedSkill("u2", id!, BUNDLED)).toEqual({ ok: false, error: "not_found" });
    expect(await live("u2", "plant-care")).toBeUndefined();
    expect(await live("u1", "plant-care")).toBeUndefined();
  });

  it("🔴 an improvement saves only over the text it was proposed on", async () => {
    await upsertSkill("personal", "u1", "plant-care", fileOf("plant-care"), "u1");
    const [id] = await saveSkillProposals("u1", "p1", [proposal({ kind: "improvement", skillMd: fileOf("plant-care", "Water less in winter."), baseText: fileOf("plant-care") })]);
    expect(await saveProposedSkill("u1", id!, BUNDLED)).toMatchObject({ ok: true });
    expect(await live("u1", "plant-care")).toContain("winter");
  });

  it("🔴 a skill that changed since it was proposed is never overwritten", async () => {
    await upsertSkill("personal", "u1", "plant-care", fileOf("plant-care"), "u1");
    const [id] = await saveSkillProposals("u1", "p1", [proposal({ kind: "improvement", skillMd: fileOf("plant-care", "Water less in winter."), baseText: fileOf("plant-care") })]);
    await upsertSkill("personal", "u1", "plant-care", fileOf("plant-care", "Edited by hand."), "u1");
    expect(await saveProposedSkill("u1", id!, BUNDLED)).toEqual({ ok: false, error: "changed" });
    expect(await live("u1", "plant-care")).toContain("Edited by hand.");
  });

  it("a new one whose name another skill took meanwhile is a change; one that was removed comes back", async () => {
    const [id] = await saveSkillProposals("u1", "p1", [proposal()]);
    await upsertSkill("personal", "u1", "plant-care", fileOf("plant-care", "Other."), "u1");
    expect(await saveProposedSkill("u1", id!, BUNDLED)).toEqual({ ok: false, error: "changed" });
    await deleteSkill("personal", "u1", "plant-care");
    expect(await saveProposedSkill("u1", id!, BUNDLED)).toMatchObject({ ok: true });
    expect(await live("u1", "plant-care")).toBe(fileOf("plant-care"));
  });

  it("one of OpenLen's names is reserved, and past the most skills a person keeps there is no room", async () => {
    const [reserved] = await saveSkillProposals("u1", "p1", [proposal({ name: "cooking" })]);
    expect(await saveProposedSkill("u1", reserved!, BUNDLED)).toEqual({ ok: false, error: "reserved" });
    for (let i = 0; i < 100; i++) await upsertSkill("personal", "u1", `s-${i}`, fileOf(`s-${i}`), "u1");
    const [id] = await saveSkillProposals("u1", "p1", [proposal()]);
    expect(await saveProposedSkill("u1", id!, BUNDLED)).toEqual({ ok: false, error: "limit" });
  });
});
