// @vitest-environment node
//
// LA CARPETA EN LA BASE (pieza 9 de Len 2.5): guardar, borrar y copiar los
// ficheros del proyecto con su huella al día, y sus versiones para deshacer.
// Contra un Postgres de verdad (PGlite) con el esquema real de Drizzle: la
// semántica de `ON CONFLICT`, del borrado y del orden es la de producción.
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/lib/db/schema";
import { folderFingerprint } from "@/lib/projects/files-hash";

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

const { copyFolderForDuplicate, copyFolderForRemix, copyProjectFiles, deleteProjectFile, listProjectFiles, saveProjectFile } = await import("./files");
const { archiveFileVersion, restoreFileVersion } = await import("@/lib/projects/file-versions");

let pg: PGlite;

async function huella(projectId: string): Promise<string | null> {
  const r = await pg.query<{ filesHash: string | null }>(`select "filesHash" from projects where id = $1`, [projectId]);
  return r.rows[0]?.filesHash ?? null;
}

beforeEach(async () => {
  pg = new PGlite();
  // Lo mínimo de `projects` que esto toca, y las dos tablas tal como las crea
  // scripts/folder-migrate.ts y scripts/pages-backend-migrate.ts.
  await pg.exec(`
    create table "projects" ("id" text primary key, "userId" text not null, "filesHash" text, "publishedFilesHash" text);
    create table "projectFiles" (
      "projectId" text not null references "projects"("id") on delete cascade,
      "path" text not null, "content" text not null,
      "updatedAt" timestamp not null default now(),
      primary key ("projectId", "path"));
    create table "projectFileVersions" (
      "id" text primary key,
      "projectId" text not null references "projects"("id") on delete cascade,
      "path" text not null, "content" text, "label" text not null, "source" text not null,
      "createdAt" timestamp not null default now());
    insert into "projects" ("id", "userId") values ('p1', 'u1'), ('p2', 'u1'), ('p3', 'u2');
  `);
  base.db = drizzle(pg, { schema });
});

describe("los ficheros del proyecto", () => {
  it("🔴 guardar deja la huella de lo publicable al día; una prueba no la mueve", async () => {
    await saveProjectFile("p1", "/js/app.js", "console.log(1)");
    expect(await huella("p1")).toBe(folderFingerprint({ "/js/app.js": "console.log(1)" }));
    const antes = await huella("p1");
    await saveProjectFile("p1", "/tests/a.spec.ts", "test()");
    expect(await huella("p1")).toBe(antes);
    await saveProjectFile("p1", "/js/app.js", "console.log(2)");
    expect(await huella("p1")).not.toBe(antes);
  });

  it("listar todo, o por prefijo", async () => {
    await saveProjectFile("p1", "/js/app.js", "1");
    await saveProjectFile("p1", "/supabase/migrations/1_a.sql", "2");
    expect(await listProjectFiles("p1")).toEqual({ "/js/app.js": "1", "/supabase/migrations/1_a.sql": "2" });
    expect(await listProjectFiles("p1", "/supabase/")).toEqual({ "/supabase/migrations/1_a.sql": "2" });
  });

  it("🔴 borrar quita el fichero y la huella vuelve a nula si no queda nada publicable", async () => {
    await saveProjectFile("p1", "/js/app.js", "1");
    expect(await deleteProjectFile("p1", "/js/app.js")).toBe(true);
    expect(await listProjectFiles("p1")).toEqual({});
    expect(await huella("p1")).toBeNull();
    expect(await deleteProjectFile("p1", "/js/app.js")).toBe(false);
  });

  it("copiar a otro proyecto lo que se pide, con su huella", async () => {
    await saveProjectFile("p1", "/js/app.js", "1");
    await saveProjectFile("p1", "/tests/a.spec.ts", "t");
    expect(await copyProjectFiles("p1", "p2", (p) => p.startsWith("/js/"))).toBe(1);
    expect(await listProjectFiles("p2")).toEqual({ "/js/app.js": "1" });
    expect(await huella("p2")).toBe(await huella("p1"));
  });

  // REMEZCLAR Y DUPLICAR (Task 9): remezclar se lleva SÓLO lo que la publicada
  // ya enseña —las pruebas y las migraciones del autor no son públicas—;
  // duplicar, tu propia carpeta entera.
  it("🔴 remezclar copia sólo lo publicable; duplicar, todo", async () => {
    await saveProjectFile("p1", "/js/app.js", "1");
    await saveProjectFile("p1", "/tests/a.spec.ts", "t");
    await saveProjectFile("p1", "/supabase/migrations/20261004120000_init.sql", "create table t ();");
    expect(await copyFolderForRemix("p1", "p3")).toBe(1);
    expect(await listProjectFiles("p3")).toEqual({ "/js/app.js": "1" });
    expect(await copyFolderForDuplicate("p1", "p2")).toBe(3);
    expect(Object.keys(await listProjectFiles("p2")).sort()).toEqual([
      "/js/app.js",
      "/supabase/migrations/20261004120000_init.sql",
      "/tests/a.spec.ts",
    ]);
  });

  it("borrar el proyecto se lleva su carpeta y sus versiones (ON DELETE CASCADE)", async () => {
    await saveProjectFile("p1", "/js/app.js", "1");
    await archiveFileVersion({ projectId: "p1", path: "/js/app.js", content: null, label: "x", source: "chat" });
    await pg.exec(`delete from "projects" where "id" = 'p1'`);
    expect((await pg.query(`select 1 from "projectFiles" where "projectId" = 'p1'`)).rows).toHaveLength(0);
    expect((await pg.query(`select 1 from "projectFileVersions" where "projectId" = 'p1'`)).rows).toHaveLength(0);
  });

  it("🔴 los eslabones: remezclar y duplicar llaman a su copia", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const store = readFileSync(join(process.cwd(), "lib", "community", "store.ts"), "utf8");
    const projects = readFileSync(join(process.cwd(), "lib", "projects.ts"), "utf8");
    expect(store).toMatch(/copyFolderForRemix\(src\.id, newId\)/);
    expect(projects).toMatch(/copyFolderForDuplicate\(projectId, id\)/);
  });
});

describe("las versiones de un fichero", () => {
  it("🔴 restaurar devuelve el contenido de antes y archiva el de ahora (deshacer se deshace)", async () => {
    await saveProjectFile("p1", "/css/a.css", "rojo");
    const v = await archiveFileVersion({ projectId: "p1", path: "/css/a.css", content: "rojo", label: "Edit css/a.css", source: "chat" });
    await saveProjectFile("p1", "/css/a.css", "azul");
    const r = await restoreFileVersion({ projectId: "p1", userId: "u1", versionId: v });
    expect(r).toMatchObject({ path: "/css/a.css", content: "rojo" });
    expect((await listProjectFiles("p1"))["/css/a.css"]).toBe("rojo");
    const deshacer = await restoreFileVersion({ projectId: "p1", userId: "u1", versionId: r!.versionPrevia });
    expect(deshacer?.content).toBe("azul");
    expect((await listProjectFiles("p1"))["/css/a.css"]).toBe("azul");
  });

  it("🔴 una versión de «no existía» borra el fichero al restaurarla", async () => {
    const v = await archiveFileVersion({ projectId: "p1", path: "/js/nuevo.js", content: null, label: "Write js/nuevo.js", source: "chat" });
    await saveProjectFile("p1", "/js/nuevo.js", "x");
    await restoreFileVersion({ projectId: "p1", userId: "u1", versionId: v });
    expect(await listProjectFiles("p1")).toEqual({});
  });

  it("🔴 la versión de otro dueño u otro proyecto no se restaura", async () => {
    const v = await archiveFileVersion({ projectId: "p3", path: "/a.css", content: "x", label: "l", source: "chat" });
    expect(await restoreFileVersion({ projectId: "p3", userId: "u1", versionId: v })).toBeNull();
    expect(await restoreFileVersion({ projectId: "p1", userId: "u1", versionId: v })).toBeNull();
  });

  it("se quedan las 20 más recientes por ruta", async () => {
    for (let i = 0; i < 23; i++) {
      await archiveFileVersion({ projectId: "p1", path: "/a.css", content: String(i), label: `v${i}`, source: "chat" });
    }
    await archiveFileVersion({ projectId: "p1", path: "/b.css", content: "b", label: "b", source: "chat" });
    const r = await pg.query<{ path: string; n: number }>(
      `select "path", count(*)::int as n from "projectFileVersions" group by "path" order by "path"`,
    );
    expect(r.rows).toEqual([{ path: "/a.css", n: 20 }, { path: "/b.css", n: 1 }]);
  });
});
