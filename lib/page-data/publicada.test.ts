// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { declaracionPublicada } from "./publicada";

const USUARIO = "prueba-publicada-user";
const CON = "prueba-publicada-con";
const SIN = "prueba-publicada-sin";

beforeAll(async () => {
  await db
    .insert(schema.users)
    .values({ id: USUARIO, email: `${USUARIO}@ejemplo.invalido` })
    .onConflictDoNothing();
  await db
    .insert(schema.projects)
    .values({
      id: CON,
      userId: USUARIO,
      title: "con",
      brief: "con",
      data: {
        html: "<html lang='es'></html>",
        almacenes: {
          carrito: { modo: "propio", caducaDias: 90, campos: { total: "numero" } },
        },
      },
    })
    .onConflictDoNothing();
  await db
    .insert(schema.projects)
    .values({
      id: SIN,
      userId: USUARIO,
      title: "sin",
      brief: "sin",
      data: { html: "<html lang='es'></html>" },
    })
    .onConflictDoNothing();
});

afterAll(async () => {
  await db.delete(schema.users).where(eq(schema.users.id, USUARIO));
});

describe("declaracionPublicada", () => {
  it("devuelve la declaración guardada al publicar", async () => {
    const d = await declaracionPublicada(CON);
    expect(d.carrito?.modo).toBe("propio");
    expect(d.carrito?.caducaDias).toBe(90);
  });

  // La propiedad que hace que un almacén sin declarar no acepte escrituras:
  // la ruta pregunta por él, no lo encuentra, y responde 404.
  it("un proyecto sin almacenes devuelve vacío", async () => {
    expect(await declaracionPublicada(SIN)).toEqual({});
  });

  it("un proyecto que no existe devuelve vacío, no lanza", async () => {
    expect(await declaracionPublicada("no-existe-jamas")).toEqual({});
  });
});
