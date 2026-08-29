// @vitest-environment node
//
// La ruta EJECUTADA, no leída. La prueba de contrato mira el texto del fichero;
// ésta llama a los handlers con una sesión falsa y comprueba que el guardia
// hace su trabajo — que es lo único que separa «mis datos» de «los de otro».
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";

const DUENO = "prueba-ruta-datos-dueno";
const AJENO = "prueba-ruta-datos-ajeno";
const PROYECTO = "prueba-ruta-datos";

const HTML = `<html lang="es"><head>
<script type="application/json" data-ol-stores>
{"menu":{"visitante":"lectura","campos":{"plato":"texto"}}}
</script></head><body></body></html>`;

/** Quién dice `auth()` que está mirando. `null` = nadie. */
let sesion: string | null = DUENO;

vi.mock("@/auth", () => ({
  auth: async () => (sesion ? { user: { id: sesion } } : null),
}));

beforeAll(async () => {
  for (const id of [DUENO, AJENO]) {
    await db
      .insert(schema.users)
      .values({ id, email: `${id}@ejemplo.invalido` })
      .onConflictDoNothing();
  }
  await db
    .insert(schema.projects)
    .values({
      id: PROYECTO,
      userId: DUENO,
      title: "ruta datos",
      brief: "ruta datos",
      data: {
        html: HTML,
        almacenes: {
          menu: { modo: "lectura", caducaDias: null, campos: { plato: "texto" } },
        },
      },
    })
    .onConflictDoNothing();
});

afterEach(async () => {
  sesion = DUENO;
  await db.delete(schema.pageData).where(eq(schema.pageData.projectId, PROYECTO));
});

afterAll(async () => {
  for (const id of [DUENO, AJENO]) {
    await db.delete(schema.users).where(eq(schema.users.id, id));
  }
});

const params = Promise.resolve({ id: PROYECTO });
const url = `http://localhost/api/projects/${PROYECTO}/datos`;

describe("el guardia", () => {
  it("sin sesión devuelve 401", async () => {
    sesion = null;
    const { GET } = await import("@/app/api/projects/[id]/datos/route");
    const res = await GET(new Request(url), { params });
    expect(res.status).toBe(401);
  });

  // 404 y no 403: un 403 confirmaría que ese proyecto existe.
  it("con sesión ajena devuelve 404, no 403", async () => {
    sesion = AJENO;
    const { GET } = await import("@/app/api/projects/[id]/datos/route");
    const res = await GET(new Request(url), { params });
    expect(res.status).toBe(404);
  });

  it("un extraño no puede escribir", async () => {
    sesion = AJENO;
    const { POST } = await import("@/app/api/projects/[id]/datos/route");
    const res = await POST(
      new Request(url, {
        method: "POST",
        body: JSON.stringify({ almacen: "menu", datos: { plato: "colado" } }),
      }),
      { params },
    );
    expect(res.status).toBe(404);

    const { leerDatos } = await import("@/lib/page-data/agente");
    expect(await leerDatos({ projectId: PROYECTO, almacen: "menu" })).toEqual([]);
  });
});

describe("el dueño", () => {
  it("lee sus almacenes con sus campos", async () => {
    const { GET } = await import("@/app/api/projects/[id]/datos/route");
    const res = await GET(new Request(url), { params });
    expect(res.status).toBe(200);

    const cuerpo = (await res.json()) as {
      almacenes: Record<string, { modo: string; campos: Record<string, string>; filas: unknown[] }>;
    };
    expect(cuerpo.almacenes.menu.modo).toBe("lectura");
    expect(cuerpo.almacenes.menu.campos).toEqual({ plato: "texto" });
    expect(cuerpo.almacenes.menu.filas).toEqual([]);
  });

  it("escribe y lo ve al releer", async () => {
    const { GET, POST } = await import("@/app/api/projects/[id]/datos/route");
    const post = await POST(
      new Request(url, {
        method: "POST",
        body: JSON.stringify({ almacen: "menu", datos: { plato: "Tacos" } }),
      }),
      { params },
    );
    expect(post.status).toBe(200);

    const res = await GET(new Request(url), { params });
    const cuerpo = (await res.json()) as {
      almacenes: Record<string, { filas: { doc: Record<string, unknown> }[] }>;
    };
    expect(cuerpo.almacenes.menu.filas).toHaveLength(1);
    expect(cuerpo.almacenes.menu.filas[0].doc).toEqual({ plato: "Tacos" });
  });

  it("un almacén que la página no declara devuelve 422", async () => {
    const { POST } = await import("@/app/api/projects/[id]/datos/route");
    const res = await POST(
      new Request(url, {
        method: "POST",
        body: JSON.stringify({ almacen: "pedidos", datos: { x: "y" } }),
      }),
      { params },
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "almacen_no_declarado" });
  });
});
