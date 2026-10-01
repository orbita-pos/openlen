// @vitest-environment node
// La regla de «visto» de un formulario, y que el globito la use. Base LOCAL.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { exigirBaseLocal } from "@/lib/len-bench/entorno";
import { countInboxBadge } from "@/lib/inbox/badge";
import { marcarFormularioVisto } from "./visto";

const USUARIO = "prueba-visto-user";
const PROYECTO = "prueba-visto-proyecto";
const OTRO_PROYECTO = "prueba-visto-otro";
const MARCA = new Date("2026-09-30T12:00:00Z");

beforeAll(async () => {
  await exigirBaseLocal();
  await db.insert(schema.users).values({ id: USUARIO, email: `${USUARIO}@ejemplo.invalido`, lastSeenLeadsAt: MARCA }).onConflictDoNothing();
  await db.insert(schema.projects).values([
    { id: PROYECTO, userId: USUARIO, title: "visto", brief: "visto", data: { html: "<!doctype html><html><body></body></html>" } },
    { id: OTRO_PROYECTO, userId: USUARIO, title: "otro", brief: "otro", data: { html: "<!doctype html><html><body></body></html>" } },
  ]).onConflictDoNothing();
  await db.insert(schema.formSubmissions).values([
    { id: "visto-antes", projectId: PROYECTO, data: { nombre: "A" }, createdAt: new Date("2026-09-30T11:00:00Z") },
    { id: "visto-nuevo", projectId: PROYECTO, data: { nombre: "B" }, createdAt: new Date("2026-09-30T13:00:00Z") },
    { id: "visto-marcado", projectId: PROYECTO, data: { nombre: "C" }, createdAt: new Date("2026-09-30T14:00:00Z"), seenAt: new Date("2026-09-30T15:00:00Z") },
  ]).onConflictDoNothing();
});

afterAll(async () => {
  await db.delete(schema.formSubmissions).where(inArray(schema.formSubmissions.projectId, [PROYECTO, OTRO_PROYECTO]));
  await db.delete(schema.projects).where(inArray(schema.projects.id, [PROYECTO, OTRO_PROYECTO]));
  await db.delete(schema.users).where(eq(schema.users.id, USUARIO));
});

describe("el visto por formulario", () => {
  it("el globito cuenta sólo lo que no tiene seenAt y llegó después de la marca", async () => {
    expect((await countInboxBadge(USUARIO)).leads).toBe(1);
  });
  it("marcar uno lo quita del globito", async () => {
    expect(await marcarFormularioVisto(PROYECTO, "visto-nuevo")).toBe(true);
    expect((await countInboxBadge(USUARIO)).leads).toBe(0);
  });
  it("un formulario de OTRO proyecto no se marca por este", async () => {
    expect(await marcarFormularioVisto(OTRO_PROYECTO, "visto-antes")).toBe(false);
  });
});
