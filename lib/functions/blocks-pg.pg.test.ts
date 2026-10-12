// @vitest-environment node
//
// La marca de abuso en Postgres (spec local 2026-10-11, Parte 3). Base de usar y tirar.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { exigirBaseLocal } from "@/lib/len-bench/entorno";

import { functionsBlocked } from "./blocks-pg";

const DUENO = "prueba-fnblock-dueno";
const PROYECTO = "prueba-fnblock-proyecto";

beforeAll(async () => {
  await exigirBaseLocal();
  await db.insert(schema.users).values({ id: DUENO, email: `${DUENO}@ejemplo.invalido`, name: DUENO }).onConflictDoNothing();
  await db.delete(schema.projects).where(eq(schema.projects.id, PROYECTO));
  await db.insert(schema.projects).values({ id: PROYECTO, userId: DUENO, title: "block", brief: "", data: { html: "<p>x</p>" } });
});
afterAll(async () => {
  await db.delete(schema.projects).where(eq(schema.projects.id, PROYECTO));
  await db.delete(schema.users).where(eq(schema.users.id, DUENO));
});

describe("functionsBlocked", () => {
  it("con fila, apagadas; sin ella, no; y la fila se va con el proyecto", async () => {
    expect(await functionsBlocked(PROYECTO)).toBe(false);
    await db.insert(schema.functionBlocks).values({ projectId: PROYECTO, reason: "abuso de prueba" });
    expect(await functionsBlocked(PROYECTO)).toBe(true);
    await db.delete(schema.projects).where(eq(schema.projects.id, PROYECTO));
    expect(await db.select().from(schema.functionBlocks).where(eq(schema.functionBlocks.projectId, PROYECTO))).toEqual([]);
  });
});
