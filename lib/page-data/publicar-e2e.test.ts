// @vitest-environment node
//
// Publicar de verdad y comprobar que la declaración llegó a la base. Es el paso
// 4 de la Tarea 8 del plan, automatizado en vez de a mano: el cableado vive
// dentro de `publishProject`, entre un `ensurePageMeta` y un `update`, y la
// única forma de saber que ese camino corre entero es correrlo.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { db, schema } from "@/lib/db";
import { publishProject } from "@/lib/projects";

const USUARIO = "prueba-publicar-e2e-user";
const PROYECTO = "prueba-publicar-e2e";
const SUB = "prueba-publicar-e2e";

const HTML = `<!doctype html><html lang="es"><head>
<script type="application/json" data-ol-stores>
{"carrito":{"visitante":"propio","caduca":"30d","campos":{"total":"numero"}}}
</script>
</head><body><h1>hola</h1></body></html>`;

// El árbol de release va a un tmp, no a /var/www: sin esto, en Windows la
// escritura falla y `publishProject` hace rollback. El rollback NO toca `data`
// —restaura subdominio y estado publicado, nada más— así que la prueba pasaría
// igual y no distinguiría «publicó bien» de «falló el disco y quedó el dato».
const RAIZ = join(tmpdir(), "openlen-prueba-publicar-e2e");

beforeAll(async () => {
  process.env.PUBLISH_ROOT = RAIZ;
  await db
    .insert(schema.users)
    .values({ id: USUARIO, email: `${USUARIO}@ejemplo.invalido` })
    .onConflictDoNothing();
  await db
    .insert(schema.projects)
    .values({
      id: PROYECTO,
      userId: USUARIO,
      title: "publicar e2e",
      brief: "publicar e2e",
      data: { html: HTML },
    })
    .onConflictDoNothing();
});

afterAll(async () => {
  await db.delete(schema.users).where(eq(schema.users.id, USUARIO));
  await rm(RAIZ, { recursive: true, force: true });
});

describe("publicar extrae la declaración", () => {
  it("la deja en projects.data.almacenes", async () => {
    await publishProject({ projectId: PROYECTO, userId: USUARIO, subdomain: SUB });

    const [fila] = await db
      .select({ data: schema.projects.data })
      .from(schema.projects)
      .where(eq(schema.projects.id, PROYECTO))
      .limit(1);

    expect(fila.data.almacenes).toEqual({
      carrito: { modo: "propio", caducaDias: 30, campos: { total: "numero" } },
    });
    // Y sin perder lo que ya había: el spread no puede comerse el html.
    expect(fila.data.html).toContain("data-ol-stores");
    // Un publish REAL hornea Tailwind, migra assets y escribe el árbol de
    // release: ~4s en solitario, más con la suite entera compitiendo por el
    // disco. El defecto de 5s de vitest no da, y no es flaky — es que el
    // límite está mal puesto para lo que esta prueba hace a propósito.
  }, 30_000);

  // La propiedad de la que cuelga todo el modelo de permisos: si la página deja
  // de declarar, la declaración guardada se vacía, y la ruta responde 404 a ese
  // almacén. Los documentos siguen en la tabla — nadie los borra.
  it("republicar sin el bloque deja la declaración vacía", async () => {
    await db
      .update(schema.projects)
      .set({ data: { html: "<!doctype html><html lang='es'><body>ya no</body></html>" } })
      .where(eq(schema.projects.id, PROYECTO));

    await publishProject({ projectId: PROYECTO, userId: USUARIO, subdomain: SUB });

    const [fila] = await db
      .select({ data: schema.projects.data })
      .from(schema.projects)
      .where(eq(schema.projects.id, PROYECTO))
      .limit(1);

    expect(fila.data.almacenes).toEqual({});
  }, 30_000);
});

describe("publicar hornea los almacenes de lectura", () => {
  // El camino entero: declarar en el HTML → publicar (para que la declaración
  // exista) → guardar un plato → publicar otra vez, que ya hornea.
  it("los platos quedan DENTRO del HTML publicado", async () => {
    const HTML_MENU = `<!doctype html><html lang="es"><head>
<script type="application/json" data-ol-stores>
{"menu":{"visitante":"lectura","campos":{"plato":"texto"}}}
</script>
</head><body><div data-ol-datos="menu"></div></body></html>`;

    await db
      .update(schema.projects)
      .set({ data: { html: HTML_MENU } })
      .where(eq(schema.projects.id, PROYECTO));
    await publishProject({ projectId: PROYECTO, userId: USUARIO, subdomain: SUB });

    const { agregarDato } = await import("@/lib/page-data/agente");
    const r = await agregarDato({
      projectId: PROYECTO,
      userId: USUARIO,
      almacen: "menu",
      doc: { plato: "Tacos al pastor" },
    });
    expect(r.ok, "el plato no se guardó").toBe(true);

    await publishProject({ projectId: PROYECTO, userId: USUARIO, subdomain: SUB });

    const [fila] = await db
      .select({ publicado: schema.projects.publishedHtml })
      .from(schema.projects)
      .where(eq(schema.projects.id, PROYECTO))
      .limit(1);

    // Y en el HTML, no dentro de un <script>: es lo que hace que Google lo vea.
    const sinScripts = (fila.publicado ?? "").replace(/<script[\s\S]*?<\/script>/g, "");
    expect(sinScripts).toContain("Tacos al pastor");
  }, 60_000);
});
