// @vitest-environment node
// El proyecto en blanco y su título, contra la base LOCAL (plans/crear-es-len).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { exigirBaseLocal } from "@/lib/len-bench/entorno";
import { adoptPlaceholderTitle, createProject, renameProject } from "@/lib/projects";
import { UNTITLED_PROJECT_TITLE } from "@/lib/projects/titulo-del-html";

const USER = "prueba-crear-es-len-user";

beforeAll(async () => {
  await exigirBaseLocal();
  await db.insert(schema.users).values({ id: USER, email: `${USER}@ejemplo.invalido` }).onConflictDoNothing();
});

afterAll(async () => {
  await db.delete(schema.users).where(eq(schema.users.id, USER));
});

const titleOf = async (id: string) =>
  (await db.select({ t: schema.projects.title }).from(schema.projects).where(eq(schema.projects.id, id)))[0]!.t;

describe("el título de un proyecto que nace en blanco", () => {
  it("nace con el de relleno y adopta el <title> de la portada", async () => {
    const id = await createProject(USER, { brief: "", html: "" });
    expect(await titleOf(id)).toBe(UNTITLED_PROJECT_TITLE);
    await adoptPlaceholderTitle(id, USER, "<html><head><title>Taquería Lupita</title></head></html>");
    expect(await titleOf(id)).toBe("Taquería Lupita");
  });

  it("🔴 un nombre puesto a mano NO se pisa", async () => {
    const id = await createProject(USER, { brief: "", html: "" });
    await renameProject(id, USER, "Mi negocio");
    await adoptPlaceholderTitle(id, USER, "<title>Otra cosa</title>");
    expect(await titleOf(id)).toBe("Mi negocio");
  });

  it("sin <title> no cambia nada", async () => {
    const id = await createProject(USER, { brief: "", html: "" });
    await adoptPlaceholderTitle(id, USER, "<h1>Hola</h1>");
    expect(await titleOf(id)).toBe(UNTITLED_PROJECT_TITLE);
  });
});
