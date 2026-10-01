// @vitest-environment node
// La zona del usuario, guardada donde ya la leen los avisos
// (`notificationPreferences.timezone`). Sólo contra la base LOCAL.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { exigirBaseLocal } from "@/lib/len-bench/entorno";
import { guardarZona, leerZona } from "./zona-guardada";

const USUARIO = "prueba-zona-guardada-user";

beforeAll(async () => {
  await exigirBaseLocal();
  await db.insert(schema.users).values({ id: USUARIO, email: `${USUARIO}@ejemplo.invalido` }).onConflictDoNothing();
});

afterAll(async () => {
  await db.delete(schema.notificationPreferences).where(eq(schema.notificationPreferences.userId, USUARIO));
  await db.delete(schema.users).where(eq(schema.users.id, USUARIO));
});

describe("la zona guardada", () => {
  it("sin fila, no hay zona", async () => {
    expect(await leerZona(USUARIO)).toBeNull();
  });
  it("se guarda y se sobrescribe", async () => {
    await guardarZona(USUARIO, "America/Mexico_City");
    expect(await leerZona(USUARIO)).toBe("America/Mexico_City");
    await guardarZona(USUARIO, "Europe/Madrid");
    expect(await leerZona(USUARIO)).toBe("Europe/Madrid");
  });
});
