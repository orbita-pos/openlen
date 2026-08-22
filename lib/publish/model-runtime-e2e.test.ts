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
            .select({ data: schema.projects.data, generatedRuntime: schema.projects.generatedRuntime })
            .from(schema.projects)
            .where(eq(schema.projects.id, id))
            .limit(1);
          return rows[0]
            ? { data: rows[0].data as never, generatedRuntime: rows[0].generatedRuntime }
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
