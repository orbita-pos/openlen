// @vitest-environment node
//
// EL JAVASCRIPT DEL MODELO, DE PUNTA A PUNTA — con base de datos y disco de
// verdad.
//
// Este fichero medía otra cosa hasta el 2026-08-26. Medía la CÁPSULA: el
// código vivía en una columna aparte, atado por un SHA-256 a los bytes exactos
// de un documento, y el publicador lo re-inyectaba si el hash cuadraba. Cada
// camino que tocaba el HTML tenía que acordarse de re-sellarla, y seis se
// olvidaron.
//
// Ahora el `<script>` vive DENTRO de `data.html`, como en cualquier página web.
// Lo que se comprueba sigue siendo lo mismo —que el código del modelo llegue
// vivo a la página del usuario y sobreviva a que la edite— pero fíjate en CÓMO
// han quedado las pruebas: casi todas preguntan si el documento conserva una
// parte de sí mismo. Ésa es la señal de que el diseño es el correcto.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Sólo la sesión se falsea; la base y el disco son los de verdad. El arnés que
// ya existía para la ruta de guardado mockea `@/lib/db` entero, y eso
// mockearía justo lo que hay que comprobar.
const sesion = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/auth", () => ({ auth: sesion.auth }));

const RAIZ = mkdtempSync(path.join(tmpdir(), "ol-modeljs-"));
process.env.PUBLISH_ROOT = RAIZ;
process.env.OPENLEN_IMAGE_BAKE = "0";
process.env.OPENLEN_FONT_BAKE = "0";
process.env.OPENLEN_LOCALIZE = "0";
process.env.OPENLEN_IMAGERY = "0";

import { db, schema } from "../db";
import { publishProject } from "../projects";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const PID = "test-model-js-e2e";
const UID = PID + "-u";
const SUB = "e2emodeljs";

/** Marca única de cada documento. NO usar `addEventListener` para detectar el
 *  script: la analítica y el envío de formularios son NUESTROS y también lo
 *  usan — esa trampa costó tres diagnósticos falsos. */
const HOME = "__JS_DE_LA_HOME__";
const PRECIOS = "__JS_DE_PRECIOS__";
const MENU = "__JS_DEL_MENU__";

const codigoDe = (marca: string) =>
  'document.getElementById("b").addEventListener("click",function(){window.' + marca + "=1});";

/** Un documento CON su script dentro, que es como el modelo lo escribe. */
const docDe = (titulo: string, marca: string) =>
  '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>' +
  titulo +
  "</title></head>\n<body><h1>" +
  titulo +
  '</h1><button id="b">pulsa</button><script>' +
  codigoDe(marca) +
  "</script></body></html>";

const DOC_HOME = docDe("Portada", HOME);
const DOC_PRECIOS = docDe("Precios", PRECIOS);
const DOC_MENU = docDe("Menu", MENU);

/** El fichero servido AHORA. `slug` nulo = la Home. */
function vivo(sub: string, slug: string | null = null): string {
  const base = path.join(RAIZ, sub);
  const rel = slug ? path.join(slug, "index.html") : "index.html";
  try {
    return readFileSync(path.join(base, "current", rel), "utf8");
  } catch {
    // En Windows el entorno de test escribe un marcador con el sha en vez de
    // un symlink navegable.
    const sha = readFileSync(path.join(base, "current"), "utf8").trim();
    return readFileSync(path.join(base, "releases", sha, rel), "utf8");
  }
}


const publicar = (sub: string, projectId = PID, userId = UID) =>
  publishProject({
    projectId,
    userId,
    subdomain: sub,
    skipFlightCheck: true,
    bypassSubdomainLimit: true,
  });

beforeAll(async () => {
  await db
    .insert(schema.users)
    .values({ id: UID, email: PID + "@test.invalid", name: "Test" })
    .onConflictDoNothing();
  await db
    .insert(schema.projects)
    .values({
      id: PID,
      userId: UID,
      title: "E2E JS del modelo",
      brief: "un sitio de tres páginas, cada una con su interacción",
      data: {
        html: DOC_HOME,
        pages: { precios: { html: DOC_PRECIOS }, menu: { html: DOC_MENU } },
      },
    })
    .onConflictDoNothing();
  sesion.auth.mockResolvedValue({ user: { id: UID } });
  await publicar(SUB);
});

afterAll(async () => {
  const { eq } = await import("drizzle-orm");
  await db.delete(schema.projects).where(eq(schema.projects.remixedFromId, PID));
  await db.delete(schema.projects).where(eq(schema.projects.id, PID));
  await db.delete(schema.users).where(eq(schema.users.id, UID));
  rmSync(RAIZ, { recursive: true, force: true });
});

describe("el script vive en el documento, y por eso llega", () => {
  it("el HTML guardado LLEVA el script — no hay columna aparte", async () => {
    const { eq } = await import("drizzle-orm");
    const [fila] = await db
      .select({ data: schema.projects.data })
      .from(schema.projects)
      .where(eq(schema.projects.id, PID));
    expect(fila?.data?.html).toContain(codigoDe(HOME));
  });

  it("y al publicar llega a los tres documentos", () => {
    expect(vivo(SUB)).toContain(HOME);
    expect(vivo(SUB, "precios")).toContain(PRECIOS);
    expect(vivo(SUB, "menu")).toContain(MENU);
  });

  /**
   * UNA SOLA VEZ. Cuando el script vivía fuera, el publicador lo inyectaba de
   * vuelta — y en cuanto el documento dejó de saneársele, el mismo código
   * quedaba dos veces. Dos veces significa dos `addEventListener` sobre el
   * mismo botón: un carrito que suma de dos en dos.
   */
  it("y UNA sola vez en cada documento", () => {
    const casos: Array<[string | null, string]> = [
      [null, HOME],
      ["precios", PRECIOS],
      ["menu", MENU],
    ];
    for (const [slug, marca] of casos) {
      const html = vivo(SUB, slug);
      expect(html.split(marca).length - 1, (slug ?? "/") + " lo lleva repetido").toBe(1);
    }
  });

  it("cada script SÓLO en su documento", () => {
    const home = vivo(SUB);
    expect(home).not.toContain(PRECIOS);
    expect(home).not.toContain(MENU);
    expect(vivo(SUB, "precios")).not.toContain(HOME);
    expect(vivo(SUB, "menu")).not.toContain(HOME);
  });

  // RETIRADA el 2026-08-26 con la CSP. Comprobaba que el hash del script
  // estuviera en `script-src` — porque un script presente que la política
  // bloquea es un script muerto, y eso sólo se ve en el documento final. Ya no
  // hay política que pueda bloquearlo: la página hace lo que hace cualquier
  // página web.
});

/**
 * LOS CAMINOS QUE ANTES LO MATABAN.
 *
 * Cada uno fue un fallo real: editar el titular, restaurar una versión,
 * duplicar el proyecto, remixarlo. Todos rompían el hash de la cápsula y la
 * página se publicaba muda. Ahora ninguno puede — preguntan si el documento
 * conserva una parte de sí mismo.
 */
describe("editar, restaurar, duplicar, remixar — el script no se cae", () => {
  it("guardar por la pestaña Contenido conserva el script de esa página", async () => {
    const { PATCH } = await import("../../app/api/projects/[id]/html/route");
    const res = await PATCH(
      new Request("http://localhost/api/projects/x/html", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          html: DOC_MENU.replace("<h1>Menu</h1>", "<h1>Menu nuevo</h1>"),
          page: "menu",
        }),
      }),
      { params: Promise.resolve({ id: PID }) },
    );
    expect(res.status, await res.text().catch(() => "")).toBe(200);

    await publicar(SUB);
    const html = vivo(SUB, "menu");
    expect(html).toContain("Menu nuevo");
    expect(html, "la edición se llevó el script").toContain(MENU);
  });

  /**
   * GUARDAR POR EDICIONES — el camino de v0, con base de datos de verdad.
   *
   * La prueba de arriba manda el DOCUMENTO ENTERO, que es como guardaba el
   * taller: una foto del DOM vivo. Funciona gracias a `conservarScripts`, que
   * le devuelve al documento los `<script>` que el saneador acababa de
   * quitarle — un remiendo necesario porque la página hace el viaje de ida y
   * vuelta por el navegador en CADA edición.
   *
   * Ésta manda QUÉ CAMBIÓ. El documento no sale de la base, así que no hay
   * nada que remendar: el script no puede perderse ni duplicarse porque nadie
   * lo ha tocado. Es la propiedad que permite que el JavaScript del modelo
   * corra también mientras se edita.
   */
  it("guardar por EDICIONES conserva el script sin necesitar empalme", async () => {
    const { PATCH } = await import("../../app/api/projects/[id]/html/route");
    const res = await PATCH(
      new Request("http://localhost/api/projects/x/html", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          page: "menu",
          edits: [
            {
              op: "replace",
              path: "h1:nth-of-type(1)",
              tag: "h1",
              hijos: [],
              html: "<h1>Menu por ediciones</h1>",
            },
          ],
        }),
      }),
      { params: Promise.resolve({ id: PID }) },
    );
    expect(res.status, await res.text().catch(() => "")).toBe(200);

    await publicar(SUB);
    const html = vivo(SUB, "menu");
    expect(html).toContain("Menu por ediciones");
    expect(html, "la edición por ops se llevó el script").toContain(MENU);
    expect(
      html.split(MENU).length - 1,
      "el script quedó duplicado",
    ).toBe(1);
  });

  /**
   * Y LO QUE NO SE PUDO RESOLVER NO SE ESCRIBE. Si el script del modelo movió
   * la estructura debajo, la ruta posicional lleva a otro elemento. Se
   * responde 409 y el documento se queda EXACTAMENTE como estaba — nunca una
   * edición aterrizando callada en el sitio equivocado.
   */
  it("una edición que ya no encaja devuelve 409 y no toca el documento", async () => {
    const { eq } = await import("drizzle-orm");
    const { PATCH } = await import("../../app/api/projects/[id]/html/route");
    const antes = await db
      .select({ data: schema.projects.data })
      .from(schema.projects)
      .where(eq(schema.projects.id, PID));

    const res = await PATCH(
      new Request("http://localhost/api/projects/x/html", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          page: "menu",
          edits: [
            {
              op: "replace",
              path: "aside:nth-of-type(7) > h1:nth-of-type(1)",
              tag: "h1",
              hijos: [],
              html: "<h1>no debería llegar</h1>",
            },
          ],
        }),
      }),
      { params: Promise.resolve({ id: PID }) },
    );
    expect(res.status).toBe(409);

    const despues = await db
      .select({ data: schema.projects.data })
      .from(schema.projects)
      .where(eq(schema.projects.id, PID));
    expect(despues[0]?.data?.pages?.menu?.html).toBe(antes[0]?.data?.pages?.menu?.html);
  });

  it("restaurar una versión de esa página también", async () => {
    const { createVersion, restoreVersion } = await import("../projects/versions");
    const v = await createVersion({
      projectId: PID,
      html: DOC_MENU.replace("<h1>Menu</h1>", "<h1>Menu viejo</h1>"),
      label: "una versión de /menu",
      source: "manual",
      page: "menu",
    });
    expect(v).toBeTruthy();
    const r = await restoreVersion({ projectId: PID, userId: UID, versionId: v as string });
    expect(r).toBeTruthy();

    await publicar(SUB);
    const html = vivo(SUB, "menu");
    expect(html).toContain("Menu viejo");
    expect(html, "restaurar se llevó el script").toContain(MENU);
  });

  it("duplicar el proyecto se lleva el script de la Home y de las subpáginas", async () => {
    const { eq } = await import("drizzle-orm");
    const { duplicateProject } = await import("../projects");
    const copiaId = await duplicateProject(PID, UID);
    expect(copiaId).toBeTruthy();
    try {
      await publicar("e2ecopiajs", copiaId as string, UID);
      expect(vivo("e2ecopiajs")).toContain(HOME);
      expect(vivo("e2ecopiajs", "menu")).toContain(MENU);
    } finally {
      await db.delete(schema.projects).where(eq(schema.projects.id, copiaId as string));
    }
  });

  it("y remixarlo desde otra cuenta, también", async () => {
    const { eq } = await import("drizzle-orm");
    const { remixProject } = await import("../community/store");
    const OTRO = PID + "-otro";
    await db
      .insert(schema.users)
      .values({ id: OTRO, email: OTRO + "@test.invalid", name: "Otro" })
      .onConflictDoNothing();
    await db
      .update(schema.projects)
      .set({ visibility: "public", status: "published" })
      .where(eq(schema.projects.id, PID));
    try {
      const res = await remixProject(PID, OTRO);
      expect(res, "el remix no se pudo hacer").toBeTruthy();
      const nuevo = (res as { newId: string }).newId;
      await publicar("e2eremixjs", nuevo, OTRO);
      expect(vivo("e2eremixjs"), "el remix salió mudo").toContain(HOME);
      expect(vivo("e2eremixjs", "menu"), "la subpágina del remix salió muda").toContain(MENU);
    } finally {
      await db.delete(schema.projects).where(eq(schema.projects.remixedFromId, PID));
      await db.delete(schema.users).where(eq(schema.users.id, OTRO));
    }
  });
});
