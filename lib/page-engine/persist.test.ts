import { describe, expect, it } from "vitest";

import { persistPage, type PersistPageDeps } from "./persist";
import { buildCapsule, verifyCapsule } from "@/lib/projects/model-runtime";
import type { ProjectData } from "@/lib/projects/types";

const PID = "p_persist";
const HTML_VIEJO = `<!doctype html><html><body><h1>antes</h1></body></html>`;
const HTML_NUEVO = `<!doctype html><html><body><h1>después</h1></body></html>`;
const CODIGO = `document.title = "vivo";`;

/** Recoge lo que `persistPage` le pasa a la capa de datos. */
function espia(data: ProjectData, capsule: unknown) {
  const visto: { data?: ProjectData; runtime?: unknown } = {};
  const deps: PersistPageDeps = {
    loadProject: async () => ({ data, generatedRuntime: capsule }),
    saveProjectData: async (_id, _uid, d, runtime) => {
      visto.data = d;
      visto.runtime = runtime;
    },
    snapshotVersion: async () => {},
  };
  return { deps, visto };
}

const entrada = (page: string | null, html: string) => ({
  projectId: PID,
  userId: "u_1",
  page,
  html,
  label: "prueba",
});

/**
 * EL FALLO QUE ESTO VIGILA. El hash de la cápsula ata `projectId + html + code`
 * y `buildCapsule` sólo se llamaba al CREAR el proyecto, así que la primera
 * edición del titular lo rompía y la página publicada salía sin su JavaScript.
 * Con el Chat y el Agente compartiendo este embudo, ése habría sido el modo de
 * fallo principal — los dos son superficies de edición.
 */
describe("re-sellado del JavaScript del modelo al guardar", () => {
  it("editando INICIO, la cápsula se re-ata al documento nuevo", async () => {
    const capsule = buildCapsule({ projectId: PID, html: HTML_VIEJO, code: CODIGO });
    const { deps, visto } = espia({ html: HTML_VIEJO }, capsule);

    const r = await persistPage(entrada(null, HTML_NUEVO), deps);

    expect(r.ok).toBe(true);
    expect(visto.runtime, "no se re-selló nada").toBeTruthy();
    expect(verifyCapsule(visto.runtime, { projectId: PID, html: HTML_NUEVO })).toEqual({
      ok: true,
      code: CODIGO,
    });
  });

  // La cápsula ata `data.html`. Una subpágina no entra en el piloto, y
  // re-sellar contra SU html dejaría el runtime del inicio apuntando al
  // documento equivocado — peor que no tocarlo.
  it("editando una SUBPÁGINA no se re-sella nada", async () => {
    const capsule = buildCapsule({ projectId: PID, html: HTML_VIEJO, code: CODIGO });
    const { deps, visto } = espia({ html: HTML_VIEJO }, capsule);

    await persistPage(entrada("menu", HTML_NUEVO), deps);

    expect(visto.runtime ?? null).toBeNull();
    // Y el spread inmutable sigue en pie: escribir una subpágina no toca inicio.
    expect(visto.data?.html).toBe(HTML_VIEJO);
  });

  it("sin cápsula no hay nada que re-sellar", async () => {
    const { deps, visto } = espia({ html: HTML_VIEJO }, null);
    await persistPage(entrada(null, HTML_NUEVO), deps);
    expect(visto.runtime ?? null).toBeNull();
  });

  /** El código sale de la cápsula guardada, nunca del llamador: re-sellar puede
   *  mover el documento al que apunta, jamás introducir código nuevo. */
  it("el código re-sellado es EL MISMO, byte a byte", async () => {
    const capsule = buildCapsule({ projectId: PID, html: HTML_VIEJO, code: CODIGO });
    const { deps, visto } = espia({ html: HTML_VIEJO }, capsule);
    await persistPage(entrada(null, HTML_NUEVO), deps);
    expect((visto.runtime as { code: string }).code).toBe(CODIGO);
  });

  /**
   * UN SCRIPT NUEVO manda sobre el viejo: es lo que hace una REESCRITURA del
   * Chat, que produce un documento entero y con él su propio JavaScript.
   */
  it("si el turno trae un script nuevo, ése es el que se sella", async () => {
    const viejo = buildCapsule({ projectId: PID, html: HTML_VIEJO, code: CODIGO });
    const { deps, visto } = espia({ html: HTML_VIEJO }, viejo);
    const NUEVO = `document.title = "reescrito";`;

    await persistPage({ ...entrada(null, HTML_NUEVO), modelRuntime: NUEVO }, deps);

    expect(verifyCapsule(visto.runtime, { projectId: PID, html: HTML_NUEVO })).toEqual({
      ok: true,
      code: NUEVO,
    });
  });

  // Y lo contrario: una edición por ops no trae script, y lo que corresponde es
  // RE-SELLAR el que ya había. Tirarlo sería borrar el trabajo del modelo porque
  // este turno concreto no produjo uno.
  it("sin script en el turno, se conserva el anterior re-sellado", async () => {
    const viejo = buildCapsule({ projectId: PID, html: HTML_VIEJO, code: CODIGO });
    const { deps, visto } = espia({ html: HTML_VIEJO }, viejo);

    await persistPage({ ...entrada(null, HTML_NUEVO), modelRuntime: null }, deps);

    expect((visto.runtime as { code: string }).code).toBe(CODIGO);
  });
});
