import { describe, expect, it } from "vitest";

import {
  persistPage,
  type PersistPageDeps,
  paginaGuardaRuntime,
} from "./persist";
import type { ProjectData } from "@/lib/projects/types";

const PID = "p_persist";
const HTML_VIEJO = `<!doctype html><html><body><h1>antes</h1></body></html>`;
const HTML_NUEVO = `<!doctype html><html><body><h1>después</h1></body></html>`;
const CODIGO = `document.title = "vivo";`;

/** Recoge lo que `persistPage` le pasa a la capa de datos. */
function espia(data: ProjectData) {
  const visto: { data?: ProjectData; guardados: number; snapshots: number } = {
    guardados: 0,
    snapshots: 0,
  };
  const deps: PersistPageDeps = {
    loadProject: async () => ({ data }),
    saveProjectData: async (_id, _uid, d) => {
      visto.data = d;
      visto.guardados += 1;
    },
    snapshotVersion: async () => {
      visto.snapshots += 1;
    },
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
// RETIRADO el 2026-08-26 con la cápsula. Este bloque fijaba el re-sellado:
// cada guardado tenía que volver a atar el código a los bytes nuevos, y
// olvidarlo dejaba la página muda al publicar. Con el `<script>` dentro del
// documento no hay nada que re-atar — sobrevive a la edición porque ES la
// edición. Lo que lo demuestra de punta a punta vive en
// lib/publish/model-runtime-e2e.test.ts.

describe("deriva de la numeración de formularios", () => {
  const conFormularios = (n: number) =>
    `<!doctype html><html><body>${"<form action=\"/api/f/x\"></form>".repeat(n)}</body></html>`;
  const CONFIGURADO: ProjectData = {
    html: conFormularios(1),
    settings: { forms: { "0": { notifyEmail: "ventas@negocio.mx" } } },
  } as ProjectData;

  it("avisa cuando una edición cambia CUÁNTOS formularios hay", async () => {
    const { deps, visto } = espia(CONFIGURADO);
    await persistPage(entrada(null, conFormularios(2)), deps);
    const d = visto.data?.degradations ?? [];
    expect(d.map((x) => x.code)).toContain("form_routing_stale");
  });

  it("el aviso reaparece aunque el usuario ya hubiera cerrado otro", async () => {
    const { deps, visto } = espia({ ...CONFIGURADO, degradationsDismissed: true });
    await persistPage(entrada(null, conFormularios(0)), deps);
    expect(visto.data?.degradationsDismissed).toBe(false);
  });

  // Editar el texto de la página no puede encender un aviso sobre formularios:
  // un aviso que sale siempre es ruido, y el ruido es como se vuelve al silencio
  // por otra puerta.
  it("NO avisa cuando el número de formularios no cambió", async () => {
    const { deps, visto } = espia(CONFIGURADO);
    await persistPage(entrada(null, conFormularios(1).replace("<body>", "<body><h1>hola</h1>")), deps);
    expect((visto.data?.degradations ?? []).map((x) => x.code)).not.toContain("form_routing_stale");
  });

  // Sin nada configurado no hay nada que se pueda desalinear: el endpoint cae al
  // correo de la cuenta, que es el mismo pase lo que pase con el orden.
  it("NO avisa cuando el dueño no configuró ningún formulario", async () => {
    const sinConfig = { html: conFormularios(1) } as ProjectData;
    const { deps, visto } = espia(sinConfig);
    await persistPage(entrada(null, conFormularios(3)), deps);
    expect((visto.data?.degradations ?? []).map((x) => x.code)).not.toContain("form_routing_stale");
  });

  it("no duplica el aviso al repetirse la edición", async () => {
    const yaAvisado: ProjectData = {
      ...CONFIGURADO,
      degradations: [{ surface: "generate", stage: "publish", code: "form_routing_stale", count: 1 }],
    } as ProjectData;
    const { deps, visto } = espia(yaAvisado);
    await persistPage(entrada(null, conFormularios(4)), deps);
    const marcas = (visto.data?.degradations ?? []).filter((x) => x.code === "form_routing_stale");
    expect(marcas).toHaveLength(1);
  });
});

// La trampa que esto cierra: `settings` se REEMPLAZABA entero. Los llamadores
// de hoy fusionan por su cuenta, así que no perdía nada — pero un tercero con
// un patch parcial habría borrado formularios, idiomas y música sin aviso.
describe("los settings se fusionan, no se reemplazan", () => {
  it("un patch parcial conserva lo que no menciona", async () => {
    const data = {
      html: "<html><body><p>x</p></body></html>",
      settings: { forms: { "0": { notifyEmail: "a@b.mx" } }, music: { enabled: true } },
    } as unknown as ProjectData;
    const { deps, visto } = espia(data);
    await persistPage(
      { ...entrada(null, "<html><body><p>y</p></body></html>"), settings: { music: { enabled: false } } as never },
      deps,
    );
    expect(visto.data?.settings?.forms).toEqual({ "0": { notifyEmail: "a@b.mx" } });
    expect(visto.data?.settings?.music).toEqual({ enabled: false });
  });
});

/**
 * TURNO VACÍO. MEDIDO el 2026-08-22 contra el modelo de verdad: diagnosticó un
 * bug de comportamiento con precisión, escribió «I'll fix the runtime script»,
 * y emitió una op de Modo A que reproducía el marcado ORIGINAL carácter por
 * carácter. Se guardó sin una queja y el usuario leyó «ya lo arreglé» sobre una
 * página que seguía rota — sin un solo error en consola.
 *
 * No se juzga la prosa del modelo: eso sería adivinar. Se cuenta el hecho del
 * que no se discute — no hay diferencia que guardar.
 */
describe("turno sin cambios", () => {
  it("lo marca cuando el documento sale idéntico y no vino script", async () => {
    const { deps } = espia({ html: HTML_VIEJO });
    const r = await persistPage(entrada(null, HTML_VIEJO), deps);
    expect(r.ok && r.sinCambios).toBe(true);
  });

  it("NO lo marca cuando el documento cambió", async () => {
    const { deps } = espia({ html: HTML_VIEJO });
    const r = await persistPage(entrada(null, HTML_NUEVO), deps);
    expect(r.ok && r.sinCambios).toBe(false);
  });

  // El caso que el arreglo de hoy hace posible: sólo cambia el comportamiento.
  // El html es idéntico A PROPÓSITO y el turno NO está vacío.
  it("NO lo marca cuando el turno trae JavaScript nuevo aunque el html no cambie", async () => {
    const { deps } = espia({ html: HTML_VIEJO });
    const r = await persistPage(
      {
        ...entrada(null, HTML_VIEJO),
        runtimeIntent: { kind: "reemplazar", code: `const nuevo = 1;` },
      },
      deps,
    );
    expect(r.ok && r.sinCambios).toBe(false);
  });

  // Un borrado tampoco es un turno vacío. Antes había que decirlo aparte —el
  // html salía idéntico porque el cambio vivía en otra columna—; ahora quitar
  // el script quita bytes del documento y `sinCambios` lo ve solo.
  it("NO lo marca cuando el turno RETIRA el JavaScript", async () => {
    const CON_JS = HTML_VIEJO.replace("</body>", `<script>${CODIGO}</script></body>`);
    const { deps } = espia({ html: CON_JS });
    const r = await persistPage(
      {
        ...entrada(null, HTML_VIEJO.replace("</body>", `<script>${CODIGO}</script></body>`)),
        runtimeIntent: { kind: "borrar" },
      },
      deps,
    );
    expect(r.ok && r.sinCambios).toBe(false);
  });

  it("también vigila las subpáginas", async () => {
    const data: ProjectData = { html: HTML_VIEJO, pages: { menu: { html: HTML_VIEJO } } };
    const { deps } = espia(data);
    const r = await persistPage(entrada("menu", HTML_VIEJO), deps);
    expect(r.ok && r.sinCambios).toBe(true);
  });
});

/**
 * AJUSTES DE FORMULARIO HUÉRFANOS. La identidad estable
 * (`lib/publish/form-identity.ts`) impide que un lead se vaya al correo de OTRO
 * formulario. Lo que no impide: que una reescritura completa borre el
 * `data-ol-form-id` y el ajuste del dueño deje de aplicarse — los mensajes caen
 * al correo de la cuenta, en silencio. Eso se avisa.
 */
describe("deriva de la configuración de formularios", () => {
  const CON_ID = `<!doctype html><html><body><form data-ol-form-id="fabc000000001"><input name="e"></form></body></html>`;
  const SIN_ID = `<!doctype html><html><body><form><input name="e"></form></body></html>`;

  it("avisa cuando la identidad configurada ya no está en la página", async () => {
    const data: ProjectData = {
      html: CON_ID,
      settings: { forms: { fabc000000001: { notifyEmail: "ventas@x.com" } } },
    };
    const { deps, visto } = espia(data);
    await persistPage({ ...entrada(null, SIN_ID), label: "reescritura" }, deps);
    const d = (visto.data?.degradations ?? []).find((x) => x.code === "form_routing_stale");
    expect(d, "no avisó del ajuste huérfano").toBeTruthy();
    expect(visto.data?.degradationsDismissed).toBe(false);
  });

  it("NO avisa cuando la identidad sobrevive, aunque cambie el número de formularios", async () => {
    // Éste es el caso que ANTES disparaba la alarma y ya no debe: insertar un
    // formulario delante ya no reenruta nada.
    const data: ProjectData = {
      html: CON_ID,
      settings: { forms: { fabc000000001: { notifyEmail: "ventas@x.com" } } },
    };
    const dosFormularios = CON_ID.replace(
      "<form data-ol-form-id",
      `<form data-ol-form-id="fnew000000002"><input name="n"></form><form data-ol-form-id`,
    );
    const { deps, visto } = espia(data);
    await persistPage(entrada(null, dosFormularios), deps);
    expect((visto.data?.degradations ?? []).some((x) => x.code === "form_routing_stale")).toBe(false);
  });

  // Una página anterior al estampado sigue con claves por índice: ahí la
  // ambigüedad es real y el aviso tiene que seguir saliendo.
  it("sigue avisando en una página LEGADA cuando cambia el número de formularios", async () => {
    const data: ProjectData = {
      html: SIN_ID,
      settings: { forms: { "0": { notifyEmail: "ventas@x.com" } } },
    };
    const { deps, visto } = espia(data);
    const dos = SIN_ID.replace("<form>", "<form><input name=a></form><form>");
    await persistPage(entrada(null, dos), deps);
    expect((visto.data?.degradations ?? []).some((x) => x.code === "form_routing_stale")).toBe(true);
  });
});

/** El runtime que quedó hablando de una página que ya no existe. */
describe("runtime obsoleto", () => {
  const CODIGO_ROTO = `document.getElementById('carrito').addEventListener('click', f);`;

  it("avisa cuando la edición quitó el elemento que el script busca", async () => {
    const { deps, visto } = espia({ html: HTML_VIEJO });
    // El script viaja en el HTML que se guarda; el aviso lo lee de ahí.
    const conRoto = HTML_NUEVO.replace("</body>", `<script>${CODIGO_ROTO}</script></body>`);
    await persistPage(entrada(null, conRoto), deps);
    const d = (visto.data?.degradations ?? []).find((x) => x.code === "runtime_stale");
    expect(d, "no avisó del runtime obsoleto").toBeTruthy();
    expect(d?.detail?.[0]).toContain("carrito");
    expect(visto.data?.degradationsDismissed).toBe(false);
  });

  it("RETIRA el aviso cuando el elemento vuelve — uno que no sabe irse enseña a ignorarlos", async () => {
    const data: ProjectData = {
      html: HTML_VIEJO,
      degradations: [{ surface: "generate", stage: "publish", code: "runtime_stale", count: 1 }],
    };
    const { deps, visto } = espia(data);
    const arreglado = `<!doctype html><html><body><div id="carrito"></div><script>${CODIGO_ROTO}</script></body></html>`;
    await persistPage(entrada(null, arreglado), deps);
    expect((visto.data?.degradations ?? []).some((x) => x.code === "runtime_stale")).toBe(false);
  });

  it("no dice nada cuando no hay cápsula", async () => {
    const { deps, visto } = espia({ html: HTML_VIEJO });
    await persistPage(entrada(null, HTML_NUEVO), deps);
    expect((visto.data?.degradations ?? []).some((x) => x.code === "runtime_stale")).toBe(false);
  });
});

// La regla que los DOS escritores comparten. Vive probada aquí y no duplicada
// en cada ruta porque el defecto del hallazgo 3 era exactamente eso: las dos
// hacían `runtime ? { … } : {}` y un borrado —que viaja como `null`— se perdía
// en silencio en las dos a la vez.
// RETIRADO con la columna. `columnaRuntime` existía para distinguir «no
// toques `generatedRuntime`» de «vacíala», y confundirlas hacía imposible
// «quítame el carrito». Ya no hay columna: quitar el JavaScript es quitar
// bytes del documento, y eso no admite ambigüedad.
