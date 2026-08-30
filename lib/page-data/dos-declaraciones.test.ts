// @vitest-environment node
//
// DOS DECLARACIONES, Y QUIÉN LEE CUÁL — 2026-08-30.
//
// El visitante se rige por lo PUBLICADO: si el bloque `data-ol-stores` ya no
// está en la página servida, sus escrituras paran. Eso estaba bien y se queda.
//
// El dueño se rige por lo que ESTÁ EDITANDO. Y hasta hoy pasaba por la misma
// puerta que el visitante, así que llenar el menú de una página sin publicar
// era imposible: `data.almacenes` se rellena AL PUBLICAR, de modo que el Agente
// declaraba el almacén con `editar_pagina`, llamaba a `guardar_dato`, y recibía
// `almacen_no_declarado` sobre un almacén que acababa de escribir él mismo.
//
// MEDIDO en la batería: reintentaba hasta agotar `turn_limit` —174k tokens de
// entrada en un turno— y los TRES casos de datos fallaban por esto.
//
// 🔴 POR QUÉ NINGUNA PRUEBA LO VIO. El fixture de `agente.test.ts` rellena
// `html` Y `almacenes` a la vez, así que pasaba leyera de donde leyera. Es un
// estado en el que un borrador real NUNCA está: en producción sólo hay `html`
// hasta la primera publicación. Un fixture demasiado completo esconde
// exactamente esta clase de fallo, y por eso el de aquí abajo deja
// `almacenes` FUERA a propósito.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { declaracionDelBorrador, declaracionPublicada } from "./publicada";
import { agregarDato, leerDatos } from "./agente";

const USUARIO = "prueba-dos-declaraciones-user";
const PROYECTO = "prueba-dos-declaraciones";

// Lo que hay en un proyecto REAL sin publicar: la declaración en el documento
// y nada en `data.almacenes`.
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
      title: "dos declaraciones",
      brief: "dos declaraciones",
      data: { html: HTML }, // ← SIN `almacenes`, a propósito
    })
    .onConflictDoNothing();
});

afterAll(async () => {
  await db.delete(schema.pageData).where(eq(schema.pageData.projectId, PROYECTO));
  await db.delete(schema.users).where(eq(schema.users.id, USUARIO));
});

describe("un proyecto sin publicar", () => {
  it("🔴 el DUEÑO ve el almacén que acaba de declarar", async () => {
    const d = await declaracionDelBorrador(PROYECTO);
    expect(Object.keys(d)).toEqual(["menu"]);
    expect(d.menu?.modo).toBe("lectura");
  });

  // BRAZO DE CONTROL, y la mitad que NO se toca. Si esto empieza a devolver el
  // almacén, un visitante podría escribir en algo que la página servida no
  // declara — el fallo contrario, y peor.
  it("y el VISITANTE no ve nada, porque no hay nada publicado", async () => {
    expect(await declaracionPublicada(PROYECTO)).toEqual({});
  });

  it("🔴 y guardar un plato FUNCIONA antes de publicar", async () => {
    const r = await agregarDato({
      projectId: PROYECTO,
      userId: USUARIO,
      almacen: "menu",
      doc: { plato: "tacos al pastor", precio: 45 },
    });
    expect(r.ok).toBe(true);
    const filas = await leerDatos({ projectId: PROYECTO, almacen: "menu" });
    expect(filas).toHaveLength(1);
    expect(filas[0]!.doc.plato).toBe("tacos al pastor");
    // El id es lo que `leer_estado` le da al Agente para poder CORREGIR en vez
    // de duplicar. Sin declaración no había filas, y sin filas no había ids.
    expect(filas[0]!.id).toBeTruthy();
  });

  it("pero un almacén que la página NO declara se sigue rechazando", async () => {
    const r = await agregarDato({
      projectId: PROYECTO,
      userId: USUARIO,
      almacen: "inventado",
      doc: { x: 1 },
    });
    expect(r).toMatchObject({ ok: false, error: "almacen_no_declarado" });
  });
});
