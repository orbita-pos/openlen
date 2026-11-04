// @vitest-environment node
//
// The `form_submissions` source (spec local 2026-11-03-len-que-avisa, §7.2): the submissions of one form of a
// published page, after a cursor. Against real Postgres (PGlite), with `formSubmissions` as the app has it.
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/lib/db/schema";

const base = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", async () => ({
  schema: await import("@/lib/db/schema"),
  get db() {
    return base.db;
  },
}));

const { recordSubmission, formKeyOf } = await import("@/lib/projects/forms");
const { formSubmissionsSource } = await import("./form-submissions");

let pg: PGlite;
beforeEach(async () => {
  pg = new PGlite();
  await pg.exec(`
    CREATE TABLE "projects" ("id" text PRIMARY KEY, "data" jsonb);
    INSERT INTO "projects" VALUES ('p1', NULL), ('p2', NULL);
    CREATE TABLE "formSubmissions" (
      "id" text PRIMARY KEY, "projectId" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
      "data" jsonb NOT NULL, "meta" jsonb, "createdAt" timestamp NOT NULL DEFAULT now(), "seenAt" timestamp, "formId" text);`);
  // The site: home with a form of its own id and one without, and a page «contacto» with one without and «fab12».
  const site = { html: '<form data-ol-form-id="fhome1"></form><form></form>', pages: { contacto: { html: '<form></form><form data-ol-form-id="fab12"></form>' } } };
  await pg.query(`UPDATE "projects" SET "data" = $1 WHERE "id" = 'p1'`, [JSON.stringify(site)]);
  base.db = drizzle(pg, { schema });
});

const submit = (projectId: string, formId: string | null, data: Record<string, string>) => recordSubmission({ projectId, data, meta: {}, formId });

describe("the form a submission came from", () => {
  it("is saved with the submission", async () => {
    await submit("p1", "fab12", { nombre: "Ana" });
    expect((await pg.query<{ formId: string }>(`SELECT "formId" FROM "formSubmissions"`)).rows).toEqual([{ formId: "fab12" }]);
  });

  it("is the form's own id when it has one, else its page and index, as notifyOwner resolves it", () => {
    expect(formKeyOf({ formId: "fab12", formIndex: 0, page: "contacto" })).toBe("fab12");
    expect(formKeyOf({ formId: null, formIndex: 1, page: "contacto" })).toBe("contacto:1");
    expect(formKeyOf({ formId: null, formIndex: 0, page: null })).toBe("0");
    expect(formKeyOf({ formId: null, formIndex: null, page: null })).toBeNull();
  });
});

describe("formSubmissionsSource", () => {
  it("validate refuses a form the site doesn't have, naming the ones it does (review I12)", async () => {
    const v = await formSubmissionsSource.validate("p1", { form: "home:0" });
    expect(v.ok).toBe(false);
    if (!v.ok) for (const key of ["fhome1", "1", "contacto:0"]) expect(v.reason).toContain(key);
    for (const form of ["fhome1", "1", "contacto:0"]) expect((await formSubmissionsSource.validate("p1", { form })).ok).toBe(true);
    // A form whose submissions already came is accepted even if the page no longer has it.
    await submit("p2", "fold9", { nombre: "Ana" });
    expect((await formSubmissionsSource.validate("p2", { form: "fold9" })).ok).toBe(true);
    // Every form of the project: nothing to check.
    expect((await formSubmissionsSource.validate("p2", {})).ok).toBe(true);
  });

  it("validate starts the cursor at the newest submission of that form", async () => {
    await submit("p1", "fab12", { nombre: "Ana" });
    await submit("p1", "fcd34", { nombre: "Otro formulario" });
    const r = await formSubmissionsSource.validate("p1", { form: "fab12" });
    expect(r.ok).toBe(true);
    const o = await formSubmissionsSource.observe("p1", { form: "fab12" }, r.ok ? r.initialState : (null as never));
    expect(o.changes).toEqual([]);
  });

  it("observe returns submissions after the cursor, only of the asked form and the project", async () => {
    const r = await formSubmissionsSource.validate("p1", { form: "fab12" });
    await submit("p1", "fab12", { nombre: "Ana", correo: "ana@ejemplo.com", mensaje: "Hola" });
    await submit("p1", "fcd34", { nombre: "Otro formulario" });
    await submit("p2", "fab12", { nombre: "Otro proyecto" });
    const o = await formSubmissionsSource.observe("p1", { form: "fab12" }, r.ok ? r.initialState : (null as never));
    expect(o.changes.map((c) => c.detail)).toEqual([{ nombre: "Ana", correo: "ana@ejemplo.com", mensaje: "Hola" }]);
    // jsonb keeps keys in its own order (shorter first, then bytewise), not the form's.
    expect(o.changes[0]).toMatchObject({ subject: "fab12", summary: "correo: ana@ejemplo.com · nombre: Ana" });
    const again = await formSubmissionsSource.observe("p1", { form: "fab12" }, o.state);
    expect(again.changes).toEqual([]);
  });

  it("without a form it watches every form of the project", async () => {
    const r = await formSubmissionsSource.validate("p1", {});
    await submit("p1", "fab12", { nombre: "Ana" });
    await submit("p1", null, { nombre: "Sin id" });
    const o = await formSubmissionsSource.observe("p1", {}, r.ok ? r.initialState : (null as never));
    expect(o.changes.map((c) => c.subject)).toEqual(["fab12", "form"]);
  });

  it("two submissions in the same microsecond are both seen once", async () => {
    const r = await formSubmissionsSource.validate("p1", {});
    await pg.exec(`INSERT INTO "formSubmissions" ("id","projectId","data","createdAt","formId") VALUES
      ('a', 'p1', '{"n":"1"}', '2030-01-01 00:00:00.123456', 'fab12'), ('b', 'p1', '{"n":"2"}', '2030-01-01 00:00:00.123456', 'fab12');`);
    const first = await formSubmissionsSource.observe("p1", {}, r.ok ? r.initialState : (null as never));
    expect(first.changes.map((c) => c.detail)).toEqual([{ n: "1" }, { n: "2" }]);
    expect((await formSubmissionsSource.observe("p1", {}, first.state)).changes).toEqual([]);
  });

  it("read returns the candidate's submissions and the previous 20 of that form", async () => {
    await submit("p1", "fab12", { nombre: "Eva" });
    const r = await formSubmissionsSource.validate("p1", { form: "fab12" });
    await submit("p1", "fab12", { nombre: "Ana" });
    const o = await formSubmissionsSource.observe("p1", { form: "fab12" }, r.ok ? r.initialState : (null as never));
    const id = String(o.changes[0]!.link);
    const read = (await formSubmissionsSource.read("p1", { form: "fab12" }, { keys: [id], state: o.state })) as { items: unknown[]; previous: unknown[] };
    expect(read.items).toEqual([{ id, data: { nombre: "Ana" } }]);
    expect(read.previous).toHaveLength(2);
  });

  it("read finds older submissions by their fields (Task 13)", async () => {
    await submit("p1", "fab12", { nombre: "Ana", fecha: "2026-11-14" });
    await submit("p1", "fab12", { nombre: "Luis", fecha: "2026-11-15" });
    await submit("p2", "fab12", { nombre: "Otro", fecha: "2026-11-14" });
    const out = (await formSubmissionsSource.read("p1", { form: "fab12" }, { keys: [], state: { cursor: { at: "-infinity", id: "" } }, match: [{ field: "fecha", value: "2026-11-14" }] })) as {
      matching: { data: Record<string, string> }[];
    };
    expect(out.matching.map((r) => r.data.nombre)).toEqual(["Ana"]);
  });
});
