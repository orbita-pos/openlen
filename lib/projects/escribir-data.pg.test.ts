// @vitest-environment node
//
// 🔴 LA PRUEBA QUE FALTABA, Y QUE COSTÓ UNA CAÍDA DE PRODUCCIÓN.
//
// `escribir-data.test.ts` dobla la base de datos, y por eso NO PODÍA cazar esto:
// pone un `Date` de JavaScript a los dos lados de la comparación, así que la
// precisión nunca se pierde ahí dentro. Salió verde, se desplegó, y en
// producción **toda** edición del Agente y del Chat empezó a fallar.
//
// LA CAUSA. Postgres guarda `timestamp` con MICROsegundos:
//
//     select "updatedAt" from projects        →  2026-09-15 02:47:24.388615
//
// El driver lo entrega como `Date` de JavaScript, que sólo tiene MILIsegundos
// (`.388`). Escribirlo de vuelta en el `WHERE` del compare-and-swap compara
// `.388` contra `.388615`: no casa NUNCA. El CAS perdía siempre, `actualizarData`
// reintentaba tres veces y lanzaba, y cada guardado devolvía error.
//
// UNA PRUEBA QUE NO PUEDE FALLAR POR UNA CAUSA NO CUBRE ESA CAUSA. Ésta corre
// contra Postgres, con una fila nacida de `defaultNow()` — que es justo la que
// trae microsegundos y la que rompía.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { actualizarData, escribirDataSiNoSeMovio } from "@/lib/projects/escribir-data";

const USUARIO = "prueba-escribir-data-user";
const PROYECTO = "prueba-escribir-data";

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
      title: "escribir-data",
      brief: "escribir-data",
      data: { html: "<!doctype html><html><body><h1>uno</h1></body></html>" },
      // `updatedAt` NO se pasa: lo pone `defaultNow()`, que es de donde salen
      // los microsegundos. Fijarlo a mano con un `Date` esconderia el fallo.
    })
    .onConflictDoNothing();
});

afterAll(async () => {
  await db.delete(schema.projects).where(eq(schema.projects.id, PROYECTO));
  await db.delete(schema.users).where(eq(schema.users.id, USUARIO));
});

/** El `updatedAt` de la fila, en texto y con toda su precisión. */
async function marcaDeLaFila(): Promise<string> {
  const filas = await db
    .select({ t: sql<string>`${schema.projects.updatedAt}::text` })
    .from(schema.projects)
    .where(eq(schema.projects.id, PROYECTO))
    .limit(1);
  return filas[0]!.t;
}

describe("escribir-data contra Postgres de verdad", () => {
  it("🔴 la fila nace con MICROsegundos — si no, esta prueba no prueba nada", async () => {
    const marca = await marcaDeLaFila();
    // Seis decimales, no tres. Es la premisa entera del fallo: si un dia la
    // columna pasara a milisegundos esta prueba dejaria de cubrir nada, y
    // quiero que eso se vea aqui y no en produccion.
    expect(marca).toMatch(/\.\d{4,6}$/);
  });

  it("el compare-and-swap GANA sobre una fila con microsegundos", async () => {
    const antes = await marcaDeLaFila();

    const r = await actualizarData({
      projectId: PROYECTO,
      userId: USUARIO,
      aplicar: (actual) => ({ ...actual, html: "<!doctype html><html><body><h1>dos</h1></body></html>" }),
    });

    expect(r.ok).toBe(true);
    // Y la escritura llego de verdad a la fila.
    const filas = await db
      .select({ data: schema.projects.data })
      .from(schema.projects)
      .where(eq(schema.projects.id, PROYECTO))
      .limit(1);
    expect(filas[0]!.data.html).toContain("dos");
    expect(await marcaDeLaFila()).not.toBe(antes);
  });

  it("y PIERDE cuando la fila se movio de verdad — la guarda sigue guardando", async () => {
    const viejo = await marcaDeLaFila();
    // Otro escritor entra: la marca cambia.
    await db
      .update(schema.projects)
      .set({ updatedAt: new Date() })
      .where(eq(schema.projects.id, PROYECTO));

    const r = await escribirDataSiNoSeMovio({
      projectId: PROYECTO,
      userId: USUARIO,
      data: { html: "<!doctype html><html><body><h1>no deberia entrar</h1></body></html>" },
      baseUpdatedAt: viejo,
    });

    expect(r).toEqual({ ok: false, motivo: "conflicto" });
    const filas = await db
      .select({ data: schema.projects.data })
      .from(schema.projects)
      .where(eq(schema.projects.id, PROYECTO))
      .limit(1);
    expect(filas[0]!.data.html).not.toContain("no deberia entrar");
  });

  it("un proyecto que no existe se distingue de un conflicto", async () => {
    const r = await escribirDataSiNoSeMovio({
      projectId: "no-existe-este-proyecto",
      userId: USUARIO,
      data: { html: "x" },
      baseUpdatedAt: await marcaDeLaFila(),
    });
    expect(r).toEqual({ ok: false, motivo: "no_encontrado" });
  });

  it("tocarUpdatedAt:false conserva la marca EXACTA, sin truncarla a milisegundos", async () => {
    // El enlace de vista previa no debe reordenar la lista de «editados hace
    // poco». Si al conservar se truncara, la fila se moveria igualmente — y
    // ademas el siguiente CAS compararia contra un valor que ya no existe.
    const antes = await marcaDeLaFila();
    const r = await escribirDataSiNoSeMovio({
      projectId: PROYECTO,
      userId: USUARIO,
      data: { html: "<!doctype html><html><body><h1>con preview</h1></body></html>" },
      baseUpdatedAt: antes,
      tocarUpdatedAt: false,
    });
    expect(r.ok).toBe(true);
    expect(await marcaDeLaFila()).toBe(antes);
  });
});
