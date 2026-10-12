// @vitest-environment node
//
// EL REF PROPIO DEL BORRADOR (spec local 2026-10-11, Parte 3), contra la base
// LOCAL con `npm run functions:migrate` aplicada (`exigirBaseLocal`).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { exigirBaseLocal } from "@/lib/len-bench/entorno";
import { publishedBaseHosts } from "@/lib/publish/request-origin";

import { createEnvironment, ensureDraftPublicRef, getEnvironment, getEnvironmentByPublicRef } from "./environments";
import { backendForHost, draftProjectUrl, ensureBackend, isBackendRef, projectUrl } from "./registry";
import { refFromHost } from "./realtime/project-lookup";

const DUENO = "prueba-draftref-dueno";
const PROYECTO = "prueba-draftref-proyecto";

beforeAll(async () => {
  await exigirBaseLocal();
  await db.insert(schema.users).values({ id: DUENO, email: `${DUENO}@ejemplo.invalido`, name: DUENO }).onConflictDoNothing();
  await db.delete(schema.projects).where(eq(schema.projects.id, PROYECTO));
  await db.insert(schema.projects).values({ id: PROYECTO, userId: DUENO, title: "draft ref", brief: "", data: { html: "<p>x</p>" } });
});
afterAll(async () => {
  await db.delete(schema.projects).where(eq(schema.projects.id, PROYECTO));
  await db.delete(schema.users).where(eq(schema.users.id, DUENO));
});

describe("el ref del borrador", () => {
  it("nace con el borrador, distinto del ref, y lleva SIEMPRE al borrador", async () => {
    const rec = await ensureBackend(PROYECTO);
    const draft = await createEnvironment(PROYECTO, rec.ref, "draft");
    expect(draft.publicRef).toMatch(/^[a-z]{20}$/);
    expect(draft.publicRef).not.toBe(rec.ref);
    expect((await getEnvironmentByPublicRef(draft.publicRef!))?.projectId).toBe(PROYECTO);

    const base = publishedBaseHosts()[0]!;
    const hb = await backendForHost(`${draft.publicRef}.${base}`);
    expect(hb?.record.projectId).toBe(PROYECTO);
    expect(hb?.environment).toBe("draft");
    // CONTROL: el ref principal no fija entorno (lo decide el Origin, como hoy).
    expect((await backendForHost(`${rec.ref}.${base}`))?.environment).toBeUndefined();

    expect(await isBackendRef(draft.publicRef!)).toBe(true);
    expect(await draftProjectUrl(rec)).toBe(projectUrl(draft.publicRef!));
    expect(refFromHost(`${draft.publicRef}.${base}`, [base])).toBe(draft.publicRef);
  });

  it("un borrador de antes sin ref lo recibe", async () => {
    await db
      .update(schema.projectBackendEnvironments)
      .set({ publicRef: null })
      .where(eq(schema.projectBackendEnvironments.projectId, PROYECTO));
    const e = (await getEnvironment(PROYECTO, "draft"))!;
    expect(e.publicRef).toBeNull();
    const r = await ensureDraftPublicRef(e);
    expect(r).toMatch(/^[a-z]{20}$/);
    expect((await getEnvironment(PROYECTO, "draft"))!.publicRef).toBe(r);
    expect(await ensureDraftPublicRef((await getEnvironment(PROYECTO, "draft"))!)).toBe(r);
  });
});
