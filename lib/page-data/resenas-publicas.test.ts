// @vitest-environment node
//
// RESEÑAS PÚBLICAS: el visitante deja la suya y LA VE — 2026-08-31.
//
// EL FALLO QUE LO PIDIÓ: Jesús escribió una reseña en su página publicada,
// recargó, y no estaba. No era un bug del guardado: el Agente había declarado
// el almacén como `añadir`, que es el único modo que permitía escribir a un
// visitante… y prohíbe leer a propósito. Su reseña se guardaba y era invisible
// hasta para él.
//
// El Agente diagnosticó bien —«no existe un modo donde cualquiera escriba y
// todos lean»— y entonces hizo lo que no debía: cambiarle el formulario a
// WhatsApp por su cuenta, sin preguntar. La decisión de producto la tomó Jesús:
// se añade el modo, con el comportamiento de Mercado Libre (se publica al
// momento, sin moderación previa).
//
// Y CON EL MODO VIENE EL TOPE, que es la otra mitad: `listar` no tenía `limit`.
// Con un carrito daba igual —son las filas de una persona— pero un almacén
// público es de TODO EL MUNDO, y sin tope una página con miles de reseñas se
// las manda enteras a cada visitante en cada carga.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { leerDeclaracion } from "./declaracion";
import { permite } from "./permisos";
import { listar, MAX_FILAS_VISITANTE } from "./store";

const USUARIO = "prueba-resenas-publicas-user";
const PROYECTO = "prueba-resenas-publicas";
const VISITANTE_A = "visitante-a";
const VISITANTE_B = "visitante-b";

const HTML = `<html lang="es"><head>
<script type="application/json" data-ol-stores>
{"resenas":{"visitante":"publico","campos":{"nombre":"texto","estrellas":"numero","texto":"texto"}}}
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
      title: "reseñas",
      brief: "reseñas",
      data: { html: HTML },
    })
    .onConflictDoNothing();
});

afterAll(async () => {
  await db.delete(schema.pageData).where(eq(schema.pageData.projectId, PROYECTO));
  await db.delete(schema.users).where(eq(schema.users.id, USUARIO));
});

describe("un almacén público", () => {
  it("se declara desde la página", () => {
    const d = leerDeclaracion(HTML);
    expect(d.resenas?.modo).toBe("publico");
  });

  // 🔴 Lo que Jesús pidió con sus palabras: «si yo comento quiero ver mi
  // reseña, como en Mercado Libre».
  it("y el visitante VE lo que escribió otro", async () => {
    for (const [visitante, nombre] of [
      [VISITANTE_A, "Ana"],
      [VISITANTE_B, "Beto"],
    ] as const) {
      await db.insert(schema.pageData).values({
        projectId: PROYECTO,
        store: "resenas",
        visitorId: visitante,
        doc: { nombre, estrellas: 5, texto: "muy bueno" },
        bytes: 40,
      });
    }
    const alcance = permite("publico", { tipo: "visitante", id: VISITANTE_A }, "leer");
    const filas = await listar({
      projectId: PROYECTO,
      store: "resenas",
      alcance,
      visitorId: VISITANTE_A,
      limite: MAX_FILAS_VISITANTE,
    });
    expect(filas).toHaveLength(2);
    expect(filas.map((f) => f.doc.nombre).sort()).toEqual(["Ana", "Beto"]);
  });

  // 🔴 BRAZO DE CONTROL, y es la mitad que protege: el mismo mecanismo con
  // `añadir` sigue siendo privado. Son dos modos parecidos en el código y
  // opuestos en la intención — un formulario de inscripción NO puede volverse
  // la lista de teléfonos de cualquiera que sepa la URL.
  it("pero con `añadir` un visitante no ve nada", async () => {
    const alcance = permite("añadir", { tipo: "visitante", id: VISITANTE_A }, "leer");
    expect(alcance).toBe("ninguno");
    const filas = await listar({
      projectId: PROYECTO,
      store: "resenas",
      alcance,
      visitorId: VISITANTE_A,
      limite: MAX_FILAS_VISITANTE,
    });
    expect(filas).toHaveLength(0);
  });

  it("no caduca: unas reseñas son contenido de la página, no un carrito", () => {
    // Con los 90 días por defecto de lo que escribe un visitante, la sección de
    // reseñas de un negocio se vaciaría sola y nadie se enteraría.
    expect(leerDeclaracion(HTML).resenas?.caducaDias).toBeNull();
  });
});

describe("y ESCALA: el visitante no se descarga la tabla entera", () => {
  it("🔴 con más filas que el tope, sólo llegan las del tope", async () => {
    const extra = MAX_FILAS_VISITANTE + 20;
    await db.insert(schema.pageData).values(
      Array.from({ length: extra }, (_, i) => ({
        projectId: PROYECTO,
        store: "muchas",
        visitorId: `v-${i}`,
        doc: { n: i },
        bytes: 10,
      })),
    );
    const filas = await listar({
      projectId: PROYECTO,
      store: "muchas",
      alcance: "todos",
      visitorId: null,
      limite: MAX_FILAS_VISITANTE,
    });
    expect(filas).toHaveLength(MAX_FILAS_VISITANTE);
  }, 30_000);

  // BRAZO DE CONTROL: el DUEÑO sí las ve todas. El tope es para la lectura del
  // visitante —200 personas descargando lo mismo— no para el panel de Datos,
  // donde el dueño gestiona lo suyo y necesita verlo entero.
  it("pero el dueño las sigue viendo todas desde su panel", async () => {
    const filas = await listar({
      projectId: PROYECTO,
      store: "muchas",
      alcance: "todos",
      visitorId: null,
    });
    expect(filas.length).toBeGreaterThan(MAX_FILAS_VISITANTE);
  }, 30_000);
});
