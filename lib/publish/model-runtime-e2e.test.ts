// @vitest-environment node
//
// LA CADENA ENTERA, contra la base de datos REAL y el disco real:
//
//   createProject (con runtime) → cápsula en Postgres → publishProject
//   → el script vive en el release → interruptor a 0 + republicar → ya no está
//
// Los tests anteriores prueban cada pieza por separado y todos podrían pasar
// con la cadena rota en las juntas: la cápsula podría no sobrevivir al viaje a
// Postgres, o el rollback podría "funcionar" sin quitar nada. Esto es el ensayo
// del apagado, que es lo único que hace seguro encenderlo.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// SÓLO la sesión se falsea. La base de datos y el disco son los de verdad: el
// arnés que ya existía para esta ruta mockea `@/lib/db` entero, y eso habría
// mockeado justo lo que falló — una columna que faltaba en un `select`.
const sesion = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/auth", () => ({ auth: sesion.auth }));
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";

// `vi.hoisted` se eleva POR ENCIMA de los imports del fichero, así que aquí
// dentro no se puede usar nada importado arriba — hay que pedirlo con require.
const { PID, UID, SUB, RAIZ } = vi.hoisted(() => {
  const nfs = require("node:fs") as typeof import("node:fs");
  const nos = require("node:os") as typeof import("node:os");
  const np = require("node:path") as typeof import("node:path");
  const PID = "test-model-runtime-e2e";
  return {
    PID,
    UID: `${PID}-u`,
    SUB: "e2emodeljs",
    RAIZ: nfs.mkdtempSync(np.join(nos.tmpdir(), "ole2e-")),
  };
});

process.env.PUBLISH_ROOT = RAIZ;
process.env.OPENLEN_IMAGE_BAKE = "0";
process.env.OPENLEN_FONT_BAKE = "0";
process.env.OPENLEN_LOCALIZE = "0";
process.env.OPENLEN_IMAGERY = "0";

import { db, schema } from "../db";
import { createProject, publishProject } from "../projects";

// La marca tiene que ser ÚNICA de este script. Buscar "addEventListener" hacía
// pasar por presente el runtime del modelo cuando lo que había era la analítica
// y el envío de formularios, que son NUESTROS y también lo usan: el test daba
// rojo con el rollback funcionando perfectamente.
const MARCA = "__PILOTO_MODEL_JS__";
const CODIGO = `document.getElementById("b").addEventListener("click",function(){window.${MARCA}=1});`;
const DOC = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>e2e</title></head>
<body><h1>Página del piloto</h1><button id="b">pulsa</button></body></html>`;

/** El index.html que se está sirviendo AHORA para ese subdominio. */
function documentoVivo(): string {
  const sub = path.join(RAIZ, SUB);
  for (const p of [path.join(sub, "current", "index.html")]) {
    try {
      return readFileSync(p, "utf8");
    } catch {
      /* symlink no legible como fichero: resolver por el marcador */
    }
  }
  // En Windows el entorno de test escribe un fichero marcador con el sha.
  const sha = readFileSync(path.join(sub, "current"), "utf8").trim();
  return readFileSync(path.join(sub, "releases", sha, "index.html"), "utf8");
}

/** Publicar de verdad —base de datos, bakes, disco— no cabe en los 5 s por
 *  defecto de vitest cuando compite con los otros 3.800 tests de la suite. No
 *  es inestabilidad: es hambre de CPU, y ya nos pasó con la puerta de paridad. */
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

let projectId = "";

beforeAll(async () => {
  await db
    .insert(schema.users)
    .values({ id: UID, email: `${PID}@test.invalid`, name: "Test" })
    .onConflictDoNothing();
  process.env.OPENLEN_MODEL_JS = "1";
  projectId = await createProject(UID, {
    html: DOC,
    brief: "una página con un botón",
    title: "E2E model js",
    modelRuntime: CODIGO,
  });
});

afterAll(async () => {
  delete process.env.OPENLEN_MODEL_JS;
  await db.delete(schema.projects).where(eqId(projectId));
  await db.delete(schema.users).where(eqUser());
  rmSync(RAIZ, { recursive: true, force: true });
});

// Helpers minúsculos para no arrastrar drizzle-orm entero al fichero.
function eqId(id: string) {
  const { eq } = require("drizzle-orm") as typeof import("drizzle-orm");
  return eq(schema.projects.id, id);
}
function eqUser() {
  const { eq } = require("drizzle-orm") as typeof import("drizzle-orm");
  return eq(schema.users.id, UID);
}

describe("la cadena completa, con base de datos y disco de verdad", () => {
  it("la cápsula sobrevive el viaje a Postgres", async () => {
    const { eq } = await import("drizzle-orm");
    const [fila] = await db
      .select({ runtime: schema.projects.generatedRuntime })
      .from(schema.projects)
      .where(eq(schema.projects.id, projectId));
    expect(fila?.runtime?.code, "el código no llegó a la fila").toBe(CODIGO);
    expect(fila?.runtime?.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("y el HTML guardado sigue SIN el script", async () => {
    const { eq } = await import("drizzle-orm");
    const [fila] = await db
      .select({ data: schema.projects.data })
      .from(schema.projects)
      .where(eq(schema.projects.id, projectId));
    expect(fila?.data?.html).not.toContain(MARCA);
  });

  it("al publicar con el interruptor en 1, el script llega a la página viva", async () => {
    process.env.OPENLEN_MODEL_JS = "1";
    await publishProject({ projectId, userId: UID, subdomain: SUB, skipFlightCheck: true });
    expect(documentoVivo()).toContain(MARCA);
  });

  /**
   * EL ENSAYO DEL APAGADO.
   *
   * Apagar el interruptor NO toca las páginas ya servidas — viven en disco con
   * su script dentro. Lo que las limpia es republicar, y esto comprueba que
   * republicar limpia DE VERDAD en lugar de devolver sin error.
   */
  it("con el interruptor en 0 y republicando, el script DESAPARECE", async () => {
    process.env.OPENLEN_MODEL_JS = "0";
    await publishProject({ projectId, userId: UID, subdomain: SUB, skipFlightCheck: true });
    const vivo = documentoVivo();
    expect(vivo).not.toContain(MARCA);
    // Y la página sigue siendo la página: no se ha entregado un documento roto
    // ni se ha perdido el contenido por el camino.
    expect(vivo).toContain("Página del piloto");
    expect(vivo).toContain("id=\"b\"");
  });

  it("y volviendo a encenderlo, vuelve — la cápsula seguía válida", async () => {
    process.env.OPENLEN_MODEL_JS = "1";
    await publishProject({ projectId, userId: UID, subdomain: SUB, skipFlightCheck: true });
    expect(documentoVivo()).toContain(MARCA);
  });

  /**
   * LA EDICIÓN QUE DE VERDAD OCURRE — por el embudo compartido.
   *
   * Antes del 2026-08-21 esto fallaba: `buildCapsule` sólo se llamaba al CREAR,
   * así que la primera edición del titular rompía el hash y la página publicada
   * salía sin su script, avisando sólo por consola. Con el Chat y el Agente
   * dentro del alcance —que son superficies de edición— ése habría sido el modo
   * de fallo principal.
   */
  it("editando por persistPage, el runtime SOBREVIVE", async () => {
    const { eq } = await import("drizzle-orm");
    const { persistPage } = await import("../page-engine/persist");
    process.env.OPENLEN_MODEL_JS = "1";
    const editado = DOC.replace("Página del piloto", "Título que el usuario cambió");

    const r = await persistPage(
      { projectId, userId: UID, page: null, html: editado, label: "edición de prueba" },
      {
        loadProject: async (id) => {
          const rows = await db
            .select({
              data: schema.projects.data,
              generatedRuntime: schema.projects.generatedRuntime,
              pageRuntimes: schema.projects.pageRuntimes,
            })
            .from(schema.projects)
            .where(eq(schema.projects.id, id))
            .limit(1);
          return rows[0]
            ? {
                data: rows[0].data as never,
                generatedRuntime: rows[0].generatedRuntime,
                pageRuntimes: rows[0].pageRuntimes,
              }
            : null;
        },
        saveProjectData: async (id, _uid, data, runtime) => {
          await db
            .update(schema.projects)
            .set({ data, ...(runtime ? { generatedRuntime: runtime } : {}) })
            .where(eq(schema.projects.id, id));
        },
        snapshotVersion: async () => {},
      },
    );
    expect(r.ok).toBe(true);

    await publishProject({ projectId, userId: UID, subdomain: SUB, skipFlightCheck: true });
    const vivo = documentoVivo();
    expect(vivo).toContain("Título que el usuario cambió");
    expect(vivo, "el runtime NO sobrevivió a una edición por el embudo").toContain(MARCA);
  });

  /**
   * Y LA RED SIGUE PUESTA: un escritor que NO re-sella —aquí, un UPDATE crudo
   * contra la base de datos— deja la cápsula apuntando a otro documento, y el
   * publicador lo detecta solo. Es lo que protege del escritor olvidado, que es
   * justo lo que ningún test puede enumerar.
   */
  it("un escritor que NO re-sella pierde el runtime, y eso está bien", async () => {
    const { eq } = await import("drizzle-orm");
    process.env.OPENLEN_MODEL_JS = "1";
    await db
      .update(schema.projects)
      .set({ data: { html: DOC.replace("Página del piloto", "Página editada") } })
      .where(eq(schema.projects.id, projectId));

    await publishProject({ projectId, userId: UID, subdomain: SUB, skipFlightCheck: true });
    const vivo = documentoVivo();
    expect(vivo).toContain("Página editada");
    expect(vivo, "el runtime sobrevivió a una edición del HTML").not.toContain(MARCA);
  });

  /**
   * Y AHORA SE VE. Antes, un proyecto con cápsula que se publicaba sin ella
   * dejaba sólo un `console.log`: el usuario veía una página que no hacía nada
   * y no tenía forma de saber por qué. Un registro que nadie lee no es una
   * solución — es la doctrina de degradación de esta casa.
   *
   * Depende del test anterior a propósito: ése es el que provoca la pérdida.
   */
  it("y la pérdida queda ANOTADA en el proyecto, no sólo en la consola", async () => {
    const { eq } = await import("drizzle-orm");
    const [fila] = await db
      .select({ data: schema.projects.data })
      .from(schema.projects)
      .where(eq(schema.projects.id, projectId));

    const aviso = fila?.data?.degradations?.find((d) => d.code === "interactivity_lost");
    expect(aviso, "la página perdió su JavaScript y nadie se lo dijo al usuario").toBeTruthy();
    expect(aviso?.surface).toBe("publish");
    expect(aviso?.detail).toEqual(["desajuste"]);
    // Un aviso nuevo tiene que verse aunque el usuario hubiera descartado otro.
    expect(fila?.data?.degradationsDismissed ?? false).toBe(false);
  });
});

/**
 * LA CADENA ENTERA, PERO MULTIPÁGINA — el bloque de arriba sólo mira la Home.
 *
 * Hasta el 2026-08-25 esto no se podía escribir: la puerta `varias_paginas`
 * apagaba el runtime del sitio ENTERO en cuanto existía una subpágina, la Home
 * incluida. No era «las subpáginas no llevan JavaScript»: era «añade una página
 * de precios y tu carrito de la portada deja de funcionar», sin nada en la
 * consola del dueño.
 *
 * Lo que hay que clavar aquí no es «hay un script». Es TRES cosas que las
 * pruebas unitarias no pueden ver juntas:
 *
 *   1. cada script acaba en SU fichero y en ningún otro,
 *   2. la CSP de cada documento lo autoriza POR HASH — un script presente que
 *      la política bloquea es un script muerto, y eso sólo se ve en el
 *      documento final, después del sellado,
 *   3. la Home conserva el suyo TENIENDO subpáginas, que es exactamente el
 *      caso que antes fallaba.
 */
const SUB_MP = "e2emodeljsmp";
const PID_MP = "test-model-runtime-e2e-mp";
const UID_MP = `${PID_MP}-u`;
const MARCA_HOME = "__JS_DE_LA_HOME__";
const MARCA_PRECIOS = "__JS_DE_PRECIOS__";
const MARCA_MENU = "__JS_DEL_MENU__";

const docDe = (titulo: string) =>
  `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${titulo}</title></head>\n<body><h1>${titulo}</h1><button id="b">pulsa</button></body></html>`;
const codigoDe = (marca: string) =>
  `document.getElementById("b").addEventListener("click",function(){window.${marca}=1});`;

const HOME_MP = docDe("Portada");
const PRECIOS_MP = docDe("Precios");
const MENU_MP = docDe("Menu");

/** El fichero servido AHORA para un documento del sitio. `null` = la Home. */
function documentoVivoMP(slug: string | null): string {
  const sub = path.join(RAIZ, SUB_MP);
  const rel = slug ? path.join(slug, "index.html") : "index.html";
  try {
    return readFileSync(path.join(sub, "current", rel), "utf8");
  } catch {
    const sha = readFileSync(path.join(sub, "current"), "utf8").trim();
    return readFileSync(path.join(sub, "releases", sha, rel), "utf8");
  }
}

/**
 * ¿La CSP de ESTE documento autoriza ESTE script?
 *
 * Se recalcula el sha256 del cuerpo exacto y se busca en `script-src`. Mirar
 * sólo si el `<script>` está presente daría por bueno el orden equivocado
 * —injertar DESPUÉS de sellar— que produce una página con su propio script
 * bloqueado: viva en el disco, muerta en el navegador.
 */
function cspAutoriza(html: string, codigo: string): boolean {
  const { createHash } = require("node:crypto") as typeof import("node:crypto");
  const b64 = createHash("sha256").update(codigo, "utf8").digest("base64");
  const csp = /content="([^"]*script-src[^"]*)"/i.exec(html)?.[1] ?? "";
  return csp.includes(`'sha256-${b64}'`);
}

async function publicarMP() {
  const { publishProject } = await import("../projects");
  await publishProject({
    projectId: PID_MP,
    userId: UID_MP,
    subdomain: SUB_MP,
    skipFlightCheck: true,
  });
}

describe("multipágina: cada documento lleva SU JavaScript", () => {
  beforeAll(async () => {
    const { buildCapsule } = await import("../projects/model-runtime");
    process.env.OPENLEN_MODEL_JS = "1";
    await db
      .insert(schema.users)
      .values({ id: UID_MP, email: `${PID_MP}@test.invalid`, name: "Test MP" })
      .onConflictDoNothing();
    await db
      .insert(schema.projects)
      .values({
        id: PID_MP,
        userId: UID_MP,
        title: "E2E multipágina",
        brief: "un sitio de tres páginas, cada una con su interacción",
        data: {
          html: HOME_MP,
          pages: { precios: { html: PRECIOS_MP }, menu: { html: MENU_MP } },
        },
        generatedRuntime: buildCapsule({
          projectId: PID_MP,
          html: HOME_MP,
          code: codigoDe(MARCA_HOME),
        }),
        pageRuntimes: {
          precios: buildCapsule({
            projectId: PID_MP,
            html: PRECIOS_MP,
            code: codigoDe(MARCA_PRECIOS),
          }),
          menu: buildCapsule({
            projectId: PID_MP,
            html: MENU_MP,
            code: codigoDe(MARCA_MENU),
          }),
        },
      })
      .onConflictDoNothing();
    await publicarMP();
  });

  afterAll(async () => {
    const { eq } = await import("drizzle-orm");
    await db.delete(schema.projects).where(eq(schema.projects.id, PID_MP));
    await db.delete(schema.users).where(eq(schema.users.id, UID_MP));
  });

  it("la Home conserva el suyo AUNQUE el sitio tenga subpáginas", () => {
    // El caso exacto que `varias_paginas` rompía. No es un extra del cambio: es
    // la regresión que el cambio arregla.
    expect(documentoVivoMP(null)).toContain(MARCA_HOME);
  });

  it.each([
    ["precios", MARCA_PRECIOS],
    ["menu", MARCA_MENU],
  ])("y /%s lleva el suyo", (slug, marca) => {
    expect(documentoVivoMP(slug)).toContain(marca);
  });

  it("cada script está SÓLO en su documento", () => {
    // El fallo que esto caza es el del envoltorio que se comía el argumento:
    // todo «funcionaba» y los tres scripts eran el mismo, el de la última
    // escritura. Con marcas distintas, mirar cruzado lo delata.
    const home = documentoVivoMP(null);
    const precios = documentoVivoMP("precios");
    const menu = documentoVivoMP("menu");
    expect(home).not.toContain(MARCA_PRECIOS);
    expect(home).not.toContain(MARCA_MENU);
    expect(precios).not.toContain(MARCA_HOME);
    expect(precios).not.toContain(MARCA_MENU);
    expect(menu).not.toContain(MARCA_HOME);
    expect(menu).not.toContain(MARCA_PRECIOS);
  });

  it.each([
    [null, MARCA_HOME],
    ["precios", MARCA_PRECIOS],
    ["menu", MARCA_MENU],
  ])("y la CSP de %s lo autoriza por hash — no es un script muerto", (slug, marca) => {
    const html = documentoVivoMP(slug as string | null);
    expect(
      cspAutoriza(html, codigoDe(marca)),
      "el script está en el fichero pero su propia CSP lo bloquea",
    ).toBe(true);
  });

  /**
   * BRAZO DE CONTROL, y además la red de seguridad: un escritor que edita una
   * subpágina SIN re-sellar su cápsula deja el hash apuntando a otro documento.
   * Esa página tiene que perder su script — y SÓLO esa. Si el fallo se
   * extendiera a las hermanas estaríamos repitiendo `varias_paginas` con otro
   * nombre.
   */
  it("editar /precios sin re-sellar apaga SÓLO /precios", async () => {
    const { eq } = await import("drizzle-orm");
    await db
      .update(schema.projects)
      .set({
        data: {
          html: HOME_MP,
          pages: {
            precios: { html: PRECIOS_MP.replace("Precios", "Precios nuevos") },
            menu: { html: MENU_MP },
          },
        },
      })
      .where(eq(schema.projects.id, PID_MP));
    await publicarMP();

    expect(documentoVivoMP("precios")).toContain("Precios nuevos");
    expect(documentoVivoMP("precios"), "la cápsula desajustada se coló").not.toContain(
      MARCA_PRECIOS,
    );
    expect(documentoVivoMP(null), "la Home perdió el suyo por un vecino").toContain(MARCA_HOME);
    expect(documentoVivoMP("menu"), "/menu perdió el suyo por un vecino").toContain(MARCA_MENU);
  });

  /**
   * Y SE LE DICE AL USUARIO, con el slug delante. La pérdida de una subpágina
   * sólo dejaba un `console.log` — la misma «solución» que la doctrina de
   * degradación prohíbe expresamente, porque una página que perdió su
   * interactividad se ve idéntica a una que nunca la tuvo. Sin el slug, el
   * aviso obliga a abrir las páginas una por una para encontrar cuál fue.
   *
   * Depende del test anterior: ése es el que provoca la pérdida.
   */
  it("y la pérdida de /precios queda anotada CON su slug", async () => {
    const { eq } = await import("drizzle-orm");
    const [fila] = await db
      .select({ data: schema.projects.data })
      .from(schema.projects)
      .where(eq(schema.projects.id, PID_MP));
    const aviso = fila?.data?.degradations?.find((d) => d.code === "interactivity_lost");
    expect(aviso, "una subpágina perdió su JavaScript y sólo lo supo la consola").toBeTruthy();
    expect(aviso?.detail).toContain("precios: desajuste");
  });
});

/**
 * LOS CAMINOS DE EDICIÓN, que son los que BORRAN en silencio.
 *
 * Publicar mal se nota: la página sale muerta. Estos otros dos son peores —
 * dejan la cápsula apuntando a un documento que ya no existe, y el usuario se
 * entera la próxima vez que publica, sin relación de causa. Los dos tenían
 * escrito `page ? null : reseal(...)`: la subpágina no se re-sellaba nunca.
 */
describe("editar una subpágina NO le quita su JavaScript", () => {
  const MARCA_A = "__JS_SUB_A__";
  const HOME_A = docDe("Portada A");
  const SUB_A = docDe("Sub A");
  const PID_A = "test-model-runtime-e2e-edit";
  const UID_A = `${PID_A}-u`;

  beforeAll(async () => {
    const { buildCapsule } = await import("../projects/model-runtime");
    process.env.OPENLEN_MODEL_JS = "1";
    await db
      .insert(schema.users)
      .values({ id: UID_A, email: `${PID_A}@test.invalid`, name: "Test Edit" })
      .onConflictDoNothing();
    await db
      .insert(schema.projects)
      .values({
        id: PID_A,
        userId: UID_A,
        title: "E2E edición de subpágina",
        brief: "una subpágina con su interacción",
        data: { html: HOME_A, pages: { menu: { html: SUB_A } } },
        generatedRuntime: null,
        pageRuntimes: {
          menu: buildCapsule({ projectId: PID_A, html: SUB_A, code: codigoDe(MARCA_A) }),
        },
      })
      .onConflictDoNothing();
    sesion.auth.mockResolvedValue({ user: { id: UID_A } });
  });

  afterAll(async () => {
    const { eq } = await import("drizzle-orm");
    await db.delete(schema.projects).where(eq(schema.projects.id, PID_A));
    await db.delete(schema.users).where(eq(schema.users.id, UID_A));
  });

  /** La cápsula de /menu, ¿sigue cuadrando con el HTML de /menu que hay ahora? */
  async function menuSigueVivo(): Promise<boolean> {
    const { eq } = await import("drizzle-orm");
    const { authorizeRuntimeForPublish } = await import("../projects/model-runtime");
    const { capsulaDePagina } = await import("../projects/page-runtimes");
    const [fila] = await db
      .select({
        data: schema.projects.data,
        generatedRuntime: schema.projects.generatedRuntime,
        pageRuntimes: schema.projects.pageRuntimes,
      })
      .from(schema.projects)
      .where(eq(schema.projects.id, PID_A));
    const permiso = authorizeRuntimeForPublish({
      env: process.env,
      projectId: PID_A,
      html: fila?.data?.pages?.menu?.html ?? "",
      capsule: capsulaDePagina(fila!, "menu"),
    });
    return permiso.kind === "authorized" && permiso.code.includes(MARCA_A);
  }

  it("guardarla por la pestaña Contenido (PATCH /html) re-sella SU cápsula", async () => {
    const { PATCH } = await import("../../app/api/projects/[id]/html/route");
    const res = await PATCH(
      new Request("http://localhost/api/projects/x/html", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          html: SUB_A.replace("Sub A", "Sub A con el titular cambiado"),
          page: "menu",
        }),
      }),
      { params: Promise.resolve({ id: PID_A }) },
    );
    expect(res.status, await res.text().catch(() => "")).toBe(200);
    expect(await menuSigueVivo(), "la edición dejó /menu sin su JavaScript").toBe(true);
  });

  it("y restaurar una versión suya también", async () => {
    const { createVersion, restoreVersion } = await import("../projects/versions");
    const anterior = SUB_A.replace("Sub A", "Sub A, versión vieja");
    const v = await createVersion({
      projectId: PID_A,
      html: anterior,
      label: "una versión de /menu",
      source: "manual",
      page: "menu",
    });
    expect(v, "no se pudo crear la versión de prueba").toBeTruthy();

    const r = await restoreVersion({
      projectId: PID_A,
      userId: UID_A,
      versionId: v as string,
    });
    expect(r, "restoreVersion devolvió null").toBeTruthy();
    expect(await menuSigueVivo(), "restaurar dejó /menu sin su JavaScript").toBe(true);
  });

  /**
   * Y EL TALLER. `getProject` devolvía UN `modelRuntime` —el de la Home— y el
   * editor lo injertaba en el documento que tuvieras abierto: en /menu te
   * ejecutaba encima el JavaScript de la portada. Aquí la Home no tiene
   * ninguno, así que si `modelRuntimes` no trajera el de /menu por su slug, el
   * taller enseñaría la subpágina muerta.
   */
  /**
   * Y EL ENLACE DE VISTA PREVIA, que es lo que el usuario manda a otra persona
   * ANTES de publicar. Este bloque estaba escrito `if (!pageSlug && …)`: la
   * subpágina se enseñaba muerta aunque tuviera su JavaScript. Un preview que
   * no ejecuta la página miente sobre lo que el usuario acaba de hacer, que es
   * exactamente lo que ese código existe para no hacer.
   */
  it("y el enlace /p/[id]?page=… la sirve VIVA", async () => {
    const { eq } = await import("drizzle-orm");
    const { GET } = await import("../../app/p/[id]/route");
    const token = "t".repeat(43);
    const [fila] = await db
      .select({ data: schema.projects.data })
      .from(schema.projects)
      .where(eq(schema.projects.id, PID_A));
    await db
      .update(schema.projects)
      .set({ data: { ...fila!.data!, preview: { token } } })
      .where(eq(schema.projects.id, PID_A));

    const res = await GET(
      new Request(`http://localhost/p/${PID_A}?t=${token}&page=menu`),
      { params: Promise.resolve({ id: PID_A }) },
    );
    expect(res.status).toBe(200);
    expect(await res.text(), "la vista previa de /menu salió muerta").toContain(MARCA_A);
  });

  it("y getProject entrega el de CADA página, por su slug", async () => {
    const { getProject } = await import("../projects");
    const detalle = await getProject(PID_A, UID_A);
    expect(detalle?.modelRuntime, "la Home no tiene, y aquí aparecía el de /menu").toBeNull();
    expect(detalle?.modelRuntimes.menu ?? "").toContain(MARCA_A);
  });
});
