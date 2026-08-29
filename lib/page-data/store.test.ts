// @vitest-environment node
//
// Estas pruebas van contra la base de DESARROLLO y se limpian solas: crean un
// usuario y un proyecto de usar y tirar, y borran sus filas tras cada caso.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { borrar, bytesUsados, escribir, listar } from "./store";

const USUARIO = "prueba-page-data-user";
const PROYECTO = "prueba-page-data";

beforeAll(async () => {
  // El FK exige que existan los dos. `userId` es notNull en `projects`.
  await db
    .insert(schema.users)
    .values({ id: USUARIO, email: `${USUARIO}@ejemplo.invalido` })
    .onConflictDoNothing();
  await db
    .insert(schema.projects)
    .values({
      id: PROYECTO,
      userId: USUARIO,
      title: "prueba",
      brief: "prueba",
      data: { html: "<html lang='es'></html>" },
    })
    .onConflictDoNothing();
});

afterEach(async () => {
  await db.delete(schema.pageData).where(eq(schema.pageData.projectId, PROYECTO));
});

afterAll(async () => {
  // El proyecto cae por CASCADE al borrar el usuario.
  await db.delete(schema.users).where(eq(schema.users.id, USUARIO));
});

describe("escribir y listar", () => {
  it("guarda y devuelve el documento", async () => {
    await escribir({
      projectId: PROYECTO,
      store: "carrito",
      visitorId: "v1",
      doc: { total: 10 },
      caducaDias: 90,
    });
    const filas = await listar({
      projectId: PROYECTO,
      store: "carrito",
      alcance: "todos",
      visitorId: null,
    });
    expect(filas).toHaveLength(1);
    expect(filas[0].doc).toEqual({ total: 10 });
  });

  // La propiedad que sostiene el modo `propio`. Si esto se rompe, un visitante
  // ve el carrito de otro.
  it("alcance «propios» sólo devuelve lo del visitante que pregunta", async () => {
    await escribir({
      projectId: PROYECTO, store: "carrito", visitorId: "v1", doc: { total: 1 }, caducaDias: 90,
    });
    await escribir({
      projectId: PROYECTO, store: "carrito", visitorId: "v2", doc: { total: 2 }, caducaDias: 90,
    });

    const filas = await listar({
      projectId: PROYECTO, store: "carrito", alcance: "propios", visitorId: "v1",
    });
    expect(filas).toHaveLength(1);
    expect(filas[0].doc).toEqual({ total: 1 });
  });

  it("alcance «ninguno» no devuelve nada", async () => {
    await escribir({
      projectId: PROYECTO, store: "r", visitorId: "v1", doc: { a: "x" }, caducaDias: 90,
    });
    const filas = await listar({
      projectId: PROYECTO, store: "r", alcance: "ninguno", visitorId: "v1",
    });
    expect(filas).toEqual([]);
  });

  it("un documento vencido no se devuelve", async () => {
    const d = await escribir({
      projectId: PROYECTO, store: "carrito", visitorId: "v1", doc: { total: 1 }, caducaDias: 90,
    });
    await db
      .update(schema.pageData)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.pageData.id, d.id));

    const filas = await listar({
      projectId: PROYECTO, store: "carrito", alcance: "todos", visitorId: null,
    });
    expect(filas).toEqual([]);
  });

  it("caducaDias null deja expiresAt en null", async () => {
    const d = await escribir({
      projectId: PROYECTO, store: "menu", visitorId: null, doc: { plato: "x" }, caducaDias: null,
    });
    const [fila] = await db
      .select()
      .from(schema.pageData)
      .where(eq(schema.pageData.id, d.id));
    expect(fila.expiresAt).toBeNull();
  });

  it("reemplaza en vez de acumular cuando se le pasa reemplazaId", async () => {
    const primero = await escribir({
      projectId: PROYECTO, store: "carrito", visitorId: "v1", doc: { total: 1 }, caducaDias: 90,
    });
    await escribir({
      projectId: PROYECTO, store: "carrito", visitorId: "v1", doc: { total: 9 },
      caducaDias: 90, reemplazaId: primero.id,
    });

    const filas = await listar({
      projectId: PROYECTO, store: "carrito", alcance: "todos", visitorId: null,
    });
    expect(filas).toHaveLength(1);
    expect(filas[0].doc).toEqual({ total: 9 });
  });
});

describe("bytesUsados", () => {
  it("suma los bytes del proyecto entero, de todos los almacenes", async () => {
    await escribir({
      projectId: PROYECTO, store: "a", visitorId: null, doc: { x: "1" }, caducaDias: null,
    });
    await escribir({
      projectId: PROYECTO, store: "b", visitorId: null, doc: { x: "22" }, caducaDias: null,
    });
    expect(await bytesUsados(PROYECTO)).toBe(
      Buffer.byteLength(JSON.stringify({ x: "1" })) +
        Buffer.byteLength(JSON.stringify({ x: "22" })),
    );
  });

  it("un proyecto vacío usa cero", async () => {
    expect(await bytesUsados(PROYECTO)).toBe(0);
  });
});

describe("borrar", () => {
  it("con alcance propios, no borra lo de otro visitante", async () => {
    const ajeno = await escribir({
      projectId: PROYECTO, store: "carrito", visitorId: "v2", doc: { total: 2 }, caducaDias: 90,
    });
    const hecho = await borrar({
      projectId: PROYECTO, store: "carrito", id: ajeno.id, alcance: "propios", visitorId: "v1",
    });
    expect(hecho).toBe(false);

    const quedan = await listar({
      projectId: PROYECTO, store: "carrito", alcance: "todos", visitorId: null,
    });
    expect(quedan).toHaveLength(1);
  });

  it("el dueño sí lo borra", async () => {
    const doc = await escribir({
      projectId: PROYECTO, store: "carrito", visitorId: "v2", doc: { total: 2 }, caducaDias: 90,
    });
    expect(
      await borrar({
        projectId: PROYECTO, store: "carrito", id: doc.id, alcance: "todos", visitorId: null,
      }),
    ).toBe(true);
  });
});
