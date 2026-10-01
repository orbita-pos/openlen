// @vitest-environment node
// Las llaves del teléfono contra la base LOCAL.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { exigirBaseLocal } from "@/lib/len-bench/entorno";
import { borrarLlave, canjearCodigo, correoDelUsuario, crearCodigo, usuarioDeLaLlave } from "./llaves";
import { huella } from "./secreto";

const USUARIO = "prueba-movil-user";
const ESTADO = "estado-de-prueba-0123456789";

beforeAll(async () => {
  await exigirBaseLocal();
  await db.insert(schema.users).values({ id: USUARIO, email: `${USUARIO}@ejemplo.invalido` }).onConflictDoNothing();
});

afterAll(async () => {
  // El ON DELETE CASCADE se lleva sus códigos y sus llaves.
  await db.delete(schema.users).where(eq(schema.users.id, USUARIO));
});

describe("las llaves del teléfono", () => {
  it("el código se canjea UNA vez por una llave que dice quién eres", async () => {
    const codigo = await crearCodigo(USUARIO, ESTADO);
    const r = await canjearCodigo(codigo, ESTADO, "Android de prueba");
    expect(r?.userId).toBe(USUARIO);
    expect(await usuarioDeLaLlave(r!.llave)).toBe(USUARIO);
    expect(await canjearCodigo(codigo, ESTADO, null)).toBeNull();
  });

  it("con otro estado no se canjea", async () => {
    const codigo = await crearCodigo(USUARIO, ESTADO);
    expect(await canjearCodigo(codigo, "otro-estado-0123456789", null)).toBeNull();
  });

  it("caduca a los 2 minutos", async () => {
    const codigo = await crearCodigo(USUARIO, ESTADO);
    expect(await canjearCodigo(codigo, ESTADO, null, new Date(Date.now() + 3 * 60_000))).toBeNull();
  });

  it("en la base sólo está la huella de la llave", async () => {
    const r = await canjearCodigo(await crearCodigo(USUARIO, ESTADO), ESTADO, null);
    const filas = await db.select().from(schema.movilLlaves).where(eq(schema.movilLlaves.userId, USUARIO));
    expect(filas.some((f) => f.huella === r!.llave)).toBe(false);
    expect(filas.some((f) => f.huella === huella(r!.llave))).toBe(true);
  });

  it("salir borra la llave y deja de valer", async () => {
    const r = await canjearCodigo(await crearCodigo(USUARIO, ESTADO), ESTADO, null);
    await borrarLlave(r!.llave);
    expect(await usuarioDeLaLlave(r!.llave)).toBeNull();
  });

  it("una llave inventada no es de nadie", async () => {
    expect(await usuarioDeLaLlave("x".repeat(43))).toBeNull();
  });

  it("el correo del usuario sale de la base (con la llave no hay sesión que lo traiga)", async () => {
    expect(await correoDelUsuario(USUARIO)).toBe(`${USUARIO}@ejemplo.invalido`);
    expect(await correoDelUsuario("nadie-con-este-id")).toBeNull();
  });
});
