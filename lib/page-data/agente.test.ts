// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { agregarDato, editarDato, leerDatos, quitarDato } from "./agente";

const USUARIO = "prueba-agente-datos-user";
const PROYECTO = "prueba-agente-datos";

const HTML = `<html lang="es"><head>
<script type="application/json" data-ol-stores>
{"menu":{"visitante":"lectura","campos":{"plato":"texto","precio":"numero"}}}
</script></head><body></body></html>`;

beforeAll(async () => {
  await db
    .insert(schema.users)
    .values({ id: USUARIO, email: `${USUARIO}@ejemplo.invalido` })
    .onConflictDoNothing();
  await db
    .insert(schema.projects)
    .values({
      id: PROYECTO,
      userId: USUARIO,
      title: "agente",
      brief: "agente",
      data: {
        html: HTML,
        almacenes: {
          menu: {
            modo: "lectura",
            caducaDias: null,
            campos: { plato: "texto", precio: "numero" },
          },
        },
      },
    })
    .onConflictDoNothing();
});

afterEach(async () => {
  await db.delete(schema.pageData).where(eq(schema.pageData.projectId, PROYECTO));
});

afterAll(async () => {
  await db.delete(schema.users).where(eq(schema.users.id, USUARIO));
});

describe("agregarDato", () => {
  it("guarda un plato y lo devuelve al leer", async () => {
    const r = await agregarDato({
      projectId: PROYECTO,
      userId: USUARIO,
      almacen: "menu",
      doc: { plato: "tacos", precio: 45 },
    });
    expect(r.ok).toBe(true);

    const filas = await leerDatos({ projectId: PROYECTO, almacen: "menu" });
    expect(filas).toHaveLength(1);
    expect(filas[0].doc).toEqual({ plato: "tacos", precio: 45 });
  });

  // Un almacén que la página no declara NO se crea al vuelo: la declaración
  // vive en el documento, y el Agente la escribe editando la página, no por la
  // puerta de atrás. Si pudiera crearlos aquí habría dos fuentes de verdad.
  it("rechaza un almacén que la página no declara", async () => {
    const r = await agregarDato({
      projectId: PROYECTO,
      userId: USUARIO,
      almacen: "pedidos",
      doc: { x: "y" },
    });
    expect(r).toEqual({ ok: false, error: "almacen_no_declarado" });
  });

  it("rechaza un campo con el tipo equivocado", async () => {
    const r = await agregarDato({
      projectId: PROYECTO,
      userId: USUARIO,
      almacen: "menu",
      doc: { plato: "tacos", precio: "cuarenta y cinco" },
    });
    expect(r).toEqual({ ok: false, error: "campo_invalido:precio" });
  });

  // El plan sale de la BASE, no de quien llama. Suponer `free` sobre un usuario
  // Pro le corta la cuota a la décima parte, y el síntoma sería «no me deja
  // guardar» sin más explicación.
  it("un usuario que no existe no escribe nada", async () => {
    const r = await agregarDato({
      projectId: PROYECTO,
      userId: "no-existe-jamas",
      almacen: "menu",
      doc: { plato: "x" },
    });
    expect(r).toEqual({ ok: false, error: "no_autorizado" });
    expect(await leerDatos({ projectId: PROYECTO, almacen: "menu" })).toEqual([]);
  });
});

describe("editarDato", () => {
  it("cambia el documento sin crear otro", async () => {
    await agregarDato({
      projectId: PROYECTO,
      userId: USUARIO,
      almacen: "menu",
      doc: { plato: "tacos", precio: 45 },
    });
    const [antes] = await leerDatos({ projectId: PROYECTO, almacen: "menu" });

    const r = await editarDato({
      projectId: PROYECTO,
      userId: USUARIO,
      almacen: "menu",
      id: antes.id,
      doc: { plato: "tacos", precio: 50 },
    });
    expect(r.ok).toBe(true);

    const despues = await leerDatos({ projectId: PROYECTO, almacen: "menu" });
    expect(despues).toHaveLength(1);
    expect(despues[0].doc).toEqual({ plato: "tacos", precio: 50 });
  });

  // Editar un id que no existe NO inserta: el Agente creería estar corrigiendo
  // y acabaría duplicando en silencio.
  it("un id que no existe no crea nada", async () => {
    const r = await editarDato({
      projectId: PROYECTO,
      userId: USUARIO,
      almacen: "menu",
      id: "no-existe",
      doc: { plato: "x" },
    });
    expect(r).toEqual({ ok: false, error: "no_encontrado" });
    expect(await leerDatos({ projectId: PROYECTO, almacen: "menu" })).toEqual([]);
  });
});

describe("quitarDato", () => {
  it("lo borra", async () => {
    await agregarDato({
      projectId: PROYECTO,
      userId: USUARIO,
      almacen: "menu",
      doc: { plato: "x" },
    });
    const [fila] = await leerDatos({ projectId: PROYECTO, almacen: "menu" });

    const r = await quitarDato({ projectId: PROYECTO, almacen: "menu", id: fila.id });
    expect(r.ok).toBe(true);
    expect(await leerDatos({ projectId: PROYECTO, almacen: "menu" })).toEqual([]);
  });

  it("un id que no existe devuelve no_encontrado", async () => {
    const r = await quitarDato({ projectId: PROYECTO, almacen: "menu", id: "no-existe" });
    expect(r).toEqual({ ok: false, error: "no_encontrado" });
  });
});
