// @vitest-environment node
// Los formularios: cuentas en la hora del usuario, lista y uno entero. Base LOCAL.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { exigirBaseLocal } from "@/lib/len-bench/entorno";
import { abrirFormulario, resumirFormularios } from "./formularios";

const USUARIO = "prueba-formularios-user";
const PROYECTO = "prueba-formularios-proyecto";
const AHORA = new Date("2026-10-01T01:00:00Z"); // 30/09 19:00 en México
const MX = "America/Mexico_City";

beforeAll(async () => {
  await exigirBaseLocal();
  await db.insert(schema.users).values({ id: USUARIO, email: `${USUARIO}@ejemplo.invalido`, lastSeenLeadsAt: new Date("2026-09-28T00:00:00Z") }).onConflictDoNothing();
  await db.insert(schema.projects).values({ id: PROYECTO, userId: USUARIO, title: "formularios", brief: "formularios", data: { html: "<!doctype html><html><body></body></html>" } }).onConflictDoNothing();
  await db.insert(schema.formSubmissions).values([
    { id: "f-viejo", projectId: PROYECTO, data: { nombre: "Ana", mensaje: "viejo" }, createdAt: new Date("2026-09-25T18:00:00Z") },
    { id: "f-maria", projectId: PROYECTO, data: { nombre: "María López", correo: "maria@ejemplo.com", mensaje: "¿Abren el domingo?" }, meta: { ip: "1.2.3.4", ua: "x", page: null }, createdAt: new Date("2026-09-30T16:00:00Z") },
    { id: "f-pedro", projectId: PROYECTO, data: { nombre: "Pedro Ruiz", "teléfono": "+52 33 1234 5678", mensaje: "Pedido de 20 conchas" }, createdAt: new Date("2026-09-29T18:00:00Z") },
  ]).onConflictDoNothing();
});

afterAll(async () => {
  await db.delete(schema.projects).where(eq(schema.projects.id, PROYECTO));
  await db.delete(schema.users).where(eq(schema.users.id, USUARIO));
});

describe("resumirFormularios", () => {
  it("cuenta sin ver, hoy, ayer y total en la hora del usuario", async () => {
    const r = await resumirFormularios(PROYECTO, USUARIO, MX, { cuales: "nuevos" }, AHORA);
    expect(r).toMatchObject({ sinVer: 2, hoy: 1, ayer: 1, total: 3 });
    expect(r.lista.map((f) => f.id)).toEqual(["f-maria", "f-pedro"]);
    expect(r.lista[0]).toMatchObject({ de: "María López", linea: "¿Abren el domingo?", visto: false, fecha: "2026-09-30 10:00" });
  });
  it("la lista por fecha incluye los vistos", async () => {
    const r = await resumirFormularios(PROYECTO, USUARIO, MX, { cuales: "fecha", desde: "2026-09-25", hasta: "2026-09-30" }, AHORA);
    expect(r.lista.map((f) => f.id)).toEqual(["f-maria", "f-pedro", "f-viejo"]);
    expect(r.lista[2]!.visto).toBe(true);
  });
  it("nunca devuelve la IP ni el navegador", async () => {
    const r = await resumirFormularios(PROYECTO, USUARIO, MX, { cuales: "nuevos" }, AHORA);
    expect(JSON.stringify(r)).not.toContain("1.2.3.4");
  });
});

describe("abrirFormulario", () => {
  it("abrir sin marcar no cambia el visto", async () => {
    const f = await abrirFormulario(PROYECTO, MX, "f-pedro", { marcarVisto: false });
    expect(f?.contacto.telefono).toBe("+52 33 1234 5678");
    const r = await resumirFormularios(PROYECTO, USUARIO, MX, { cuales: "nuevos" }, AHORA);
    expect(r.sinVer).toBe(2);
  });
  it("abrir marcando lo quita de los nuevos", async () => {
    const f = await abrirFormulario(PROYECTO, MX, "f-maria", { marcarVisto: true });
    expect(f?.datos.mensaje).toBe("¿Abren el domingo?");
    expect(JSON.stringify(f)).not.toContain("1.2.3.4");
    const r = await resumirFormularios(PROYECTO, USUARIO, MX, { cuales: "nuevos" }, AHORA);
    expect(r.sinVer).toBe(1);
  });
  it("un id de otro proyecto no existe", async () => {
    expect(await abrirFormulario("otro-proyecto", MX, "f-maria", { marcarVisto: true })).toBeNull();
  });
});
