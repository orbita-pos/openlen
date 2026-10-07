// @vitest-environment node
//
// UN PROYECTO EN BLANCO NACE COMO APP, CONTRA POSTGRES (H10 de la spec local
// docs/superpowers/specs/2026-10-07-apps-design.md): el esqueleto entra entero
// —cascarón, `data.app` y /src— y sólo en un proyecto en blanco.
//
// Corre contra la base de DATABASE_URL, como deshacer-turno.pg.test.ts.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { esqueletoDeApp } from "@/lib/apps/esqueleto";
import { folderFingerprint } from "@/lib/projects/files-hash";
import { nacerComoApp } from "@/lib/projects/nacer-como-app";
import type { ProjectData } from "@/lib/projects/types";

const USUARIO = "prueba-nacer-app-user";
const OTRO = "prueba-nacer-app-otro";
const PROYECTO = "prueba-nacer-app";

async function ponerProyecto(data: ProjectData) {
  await db.delete(schema.projectChatMessages).where(eq(schema.projectChatMessages.projectId, PROYECTO));
  await db.delete(schema.projectFiles).where(eq(schema.projectFiles.projectId, PROYECTO));
  await db.update(schema.projects).set({ data, filesHash: null }).where(eq(schema.projects.id, PROYECTO));
}

async function estado() {
  const [p] = await db.select({ data: schema.projects.data, filesHash: schema.projects.filesHash }).from(schema.projects).where(eq(schema.projects.id, PROYECTO));
  const filas = await db.select({ path: schema.projectFiles.path, content: schema.projectFiles.content }).from(schema.projectFiles).where(eq(schema.projectFiles.projectId, PROYECTO));
  return { data: p!.data as ProjectData, filesHash: p!.filesHash, ficheros: Object.fromEntries(filas.map((f) => [f.path, f.content])) };
}

beforeEach(async () => {
  for (const id of [USUARIO, OTRO]) {
    await db.insert(schema.users).values({ id, email: `${id}@ejemplo.invalido` }).onConflictDoNothing();
  }
  await db.insert(schema.projects).values({ id: PROYECTO, userId: USUARIO, title: "Untitled page", brief: "", data: { html: "" } }).onConflictDoNothing();
  await ponerProyecto({ html: "" });
});

afterAll(async () => {
  await db.delete(schema.projects).where(eq(schema.projects.id, PROYECTO));
  for (const id of [USUARIO, OTRO]) await db.delete(schema.users).where(eq(schema.users.id, id));
});

describe("un proyecto en blanco nace como app", () => {
  it("🔴 recibe el esqueleto ENTERO: el cascarón, data.app, los ficheros de /src y su huella", async () => {
    expect(await nacerComoApp({ projectId: PROYECTO, userId: USUARIO, titulo: "Caja", idioma: "es" })).toBe(true);
    const e = esqueletoDeApp({ titulo: "Caja", idioma: "es" });
    const s = await estado();
    expect(s.data.html).toBe(e.html);
    expect(s.data.app).toEqual(e.app);
    expect(s.ficheros).toEqual(e.ficheros);
    expect(s.filesHash).toBe(folderFingerprint(e.ficheros));
  });

  it("una segunda vez no hace nada: ya no está en blanco", async () => {
    expect(await nacerComoApp({ projectId: PROYECTO, userId: USUARIO, titulo: "Caja" })).toBe(true);
    await db.update(schema.projectFiles).set({ content: "editado" }).where(eq(schema.projectFiles.path, "/src/App.jsx"));
    expect(await nacerComoApp({ projectId: PROYECTO, userId: USUARIO, titulo: "Otra" })).toBe(false);
    expect((await estado()).ficheros["/src/App.jsx"]).toBe("editado");
  });

  it("🔴 un proyecto con algo dentro NO se toca: portada, páginas o conversación", async () => {
    for (const data of [{ html: "<p>mi página</p>" }, { html: "", pages: { menu: { html: "<h1>menú</h1>" } } }] as ProjectData[]) {
      await ponerProyecto(data);
      expect(await nacerComoApp({ projectId: PROYECTO, userId: USUARIO, titulo: "Caja" })).toBe(false);
      const s = await estado();
      expect(s.data).toEqual(data);
      expect(s.ficheros).toEqual({});
    }
    await ponerProyecto({ html: "" });
    await db.insert(schema.projectChatMessages).values({ id: "prueba-nacer-app-turno", projectId: PROYECTO, userText: "hola", assistantReasoning: "", status: "done" });
    expect(await nacerComoApp({ projectId: PROYECTO, userId: USUARIO, titulo: "Caja" })).toBe(false);
    expect((await estado()).data.app).toBeUndefined();
  });

  it("el proyecto de otro, tampoco", async () => {
    expect(await nacerComoApp({ projectId: PROYECTO, userId: OTRO, titulo: "Caja" })).toBe(false);
    expect((await estado()).data.app).toBeUndefined();
  });
});
