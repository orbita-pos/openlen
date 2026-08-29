// @vitest-environment node
//
// El camino del carrito, de punta a punta, en el MISMO orden que la ruta:
// declaración → identidad → permiso → validación → cuota → escritura.
//
// No levanta HTTP a propósito. La ruta ya tiene su prueba de contrato y el
// `next build` confirma que Next la reconoce; lo que aquí importa es que las
// seis piezas encajen — que es donde un sistema hecho de módulos puros se
// rompe: cada uno correcto, y la cadena mal montada.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { leerDeclaracion, validaDocumento } from "./declaracion";
import { permite } from "./permisos";
import { bytesDe, cabe } from "./cuota";
import { nuevoVisitante, verificaVisitante } from "./visitante";
import { bytesUsados, escribir, listar } from "./store";

const USUARIO = "prueba-e2e-page-data-user";
const PROYECTO = "prueba-e2e-page-data";
const CLAVE = "clave-de-prueba-suficientemente-larga";

const HTML = `<!doctype html><html lang="es"><head>
<script type="application/json" data-ol-stores>
{"carrito":{"visitante":"propio","campos":{"total":"numero"}},
 "menu":{"visitante":"lectura","campos":{"plato":"texto"}},
 "resenas":{"visitante":"añadir","campos":{"texto":"texto"}}}
</script>
</head><body></body></html>`;

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
      title: "e2e",
      brief: "e2e",
      data: { html: HTML },
    })
    .onConflictDoNothing();
});

afterEach(async () => {
  await db.delete(schema.pageData).where(eq(schema.pageData.projectId, PROYECTO));
});

afterAll(async () => {
  await db.delete(schema.users).where(eq(schema.users.id, USUARIO));
});

/** Un visitante como el que fabrica la ruta: cookie firmada, id verificado. */
function visitante(): string {
  return verificaVisitante(nuevoVisitante(CLAVE), CLAVE)!;
}

describe("el carrito, de punta a punta", () => {
  it("dos visitantes tienen carritos distintos y no se ven", async () => {
    const almacen = leerDeclaracion(HTML).carrito;
    const v1 = visitante();
    const v2 = visitante();

    for (const [quien, total] of [
      [v1, 10],
      [v2, 20],
    ] as const) {
      const validado = validaDocumento(almacen, { total });
      expect(validado.ok).toBe(true);
      if (!validado.ok) return;

      expect(permite(almacen.modo, { tipo: "visitante", id: quien }, "crear")).toBe("propios");
      expect(
        cabe({
          plan: "free",
          usados: await bytesUsados(PROYECTO),
          entrantes: bytesDe(validado.doc),
        }),
      ).toEqual({ ok: true });

      await escribir({
        projectId: PROYECTO,
        store: "carrito",
        visitorId: quien,
        doc: validado.doc,
        caducaDias: almacen.caducaDias,
      });
    }

    // Cada visitante ve el suyo…
    const deV1 = await listar({
      projectId: PROYECTO,
      store: "carrito",
      alcance: permite(almacen.modo, { tipo: "visitante", id: v1 }, "leer"),
      visitorId: v1,
    });
    expect(deV1).toHaveLength(1);
    expect(deV1[0].doc).toEqual({ total: 10 });

    // …y el dueño los ve todos.
    const delDueño = await listar({
      projectId: PROYECTO,
      store: "carrito",
      alcance: permite(almacen.modo, { tipo: "dueño" }, "leer"),
      visitorId: null,
    });
    expect(delDueño).toHaveLength(2);
  }, 20_000);

  it("un almacén que la página no declara no existe", () => {
    // Es lo que hace que la ruta responda 404 `almacen_no_declarado`.
    expect(leerDeclaracion(HTML).pedidos).toBeUndefined();
  });
});

describe("los otros dos modos, extremo a extremo", () => {
  it("en `lectura` el visitante lee el menú y no puede escribirlo", async () => {
    const almacen = leerDeclaracion(HTML).menu;
    const v = visitante();

    // Lo escribe el dueño…
    await escribir({
      projectId: PROYECTO,
      store: "menu",
      visitorId: null,
      doc: { plato: "tacos" },
      caducaDias: almacen.caducaDias,
    });

    expect(permite(almacen.modo, { tipo: "visitante", id: v }, "crear")).toBe("ninguno");

    const visto = await listar({
      projectId: PROYECTO,
      store: "menu",
      alcance: permite(almacen.modo, { tipo: "visitante", id: v }, "leer"),
      visitorId: v,
    });
    expect(visto).toHaveLength(1);
    expect(visto[0].doc).toEqual({ plato: "tacos" });
  }, 20_000);

  // La propiedad que define `añadir`, y la que convertiría una página de reseñas
  // en la lista de correos de cualquiera si se rompiera.
  it("en `añadir` el visitante deja su reseña y NO puede leer las de otros", async () => {
    const almacen = leerDeclaracion(HTML).resenas;
    const v1 = visitante();
    const v2 = visitante();

    for (const quien of [v1, v2]) {
      await escribir({
        projectId: PROYECTO,
        store: "resenas",
        visitorId: quien,
        doc: { texto: `soy ${quien.slice(0, 4)}` },
        caducaDias: almacen.caducaDias,
      });
    }

    expect(permite(almacen.modo, { tipo: "visitante", id: v1 }, "crear")).toBe("propios");

    const loQueVe = await listar({
      projectId: PROYECTO,
      store: "resenas",
      alcance: permite(almacen.modo, { tipo: "visitante", id: v1 }, "leer"),
      visitorId: v1,
    });
    expect(loQueVe).toEqual([]);

    // El dueño sí las ve todas: son suyas.
    const delDueño = await listar({
      projectId: PROYECTO,
      store: "resenas",
      alcance: permite(almacen.modo, { tipo: "dueño" }, "leer"),
      visitorId: null,
    });
    expect(delDueño).toHaveLength(2);
  }, 20_000);
});

describe("la cuota corta antes de escribir", () => {
  it("con el proyecto lleno, la escritura no llega a la base", async () => {
    const almacen = leerDeclaracion(HTML).carrito;
    const validado = validaDocumento(almacen, { total: 1 });
    expect(validado.ok).toBe(true);
    if (!validado.ok) return;

    const veredicto = cabe({
      plan: "free",
      usados: 1 * 1024 * 1024, // la cuota entera de free
      entrantes: bytesDe(validado.doc),
    });
    expect(veredicto).toEqual({ ok: false, razon: "cuota_llena" });

    // Y nada se escribió: la ruta corta AQUÍ, antes de tocar el store.
    expect(await bytesUsados(PROYECTO)).toBe(0);
  }, 20_000);
});
