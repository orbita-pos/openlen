import { describe, expect, it } from "vitest";

import {
  columnaRuntime,
  persistPage,
  type PersistPageDeps,
  paginaGuardaRuntime,
} from "./persist";
import { buildCapsule, verifyCapsule } from "@/lib/projects/model-runtime";
import type { ProjectData } from "@/lib/projects/types";

const PID = "p_persist";
const HTML_VIEJO = `<!doctype html><html><body><h1>antes</h1></body></html>`;
const HTML_NUEVO = `<!doctype html><html><body><h1>después</h1></body></html>`;
const CODIGO = `document.title = "vivo";`;

/** Recoge lo que `persistPage` le pasa a la capa de datos. */
function espia(data: ProjectData, capsule: unknown) {
  // `guardados` existe para distinguir «pasó undefined» de «no se llamó». Sin
  // eso, `visto.runtime` sale undefined en los dos casos y la prueba de la
  // subpágina —la que impide que un borrado desde /menu vacíe la Home— no
  // vigilaría nada.
  const visto: {
    data?: ProjectData;
    runtime?: unknown;
    /** A QUÉ PÁGINA dijo el motor que pertenecía la cápsula. Sin esto no se
     *  puede distinguir «guardó el script de /menu» de «se lo guardó a la
     *  Home», que es exactamente el fallo que hay que impedir. */
    page?: string | null;
    guardados: number;
    snapshots: number;
  } = { guardados: 0, snapshots: 0 };
  const deps: PersistPageDeps = {
    loadProject: async () => ({ data, generatedRuntime: capsule }),
    saveProjectData: async (_id, _uid, d, runtime, page) => {
      visto.data = d;
      visto.runtime = runtime;
      visto.page = page;
      visto.guardados += 1;
    },
    snapshotVersion: async () => { visto.snapshots += 1; },
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
  it.each([
    ["reemplazar", { kind: "reemplazar", code: 'document.title="no";' }],
    ["borrar", { kind: "borrar" }],
  ] as const)("capacidad falsa + %s rechaza antes de escribir", async (_nombre, runtimeIntent) => {
    const viejo = buildCapsule({ projectId: PID, html: HTML_VIEJO, code: CODIGO });
    const { deps, visto } = espia({ html: HTML_VIEJO }, viejo);

    const r = await persistPage(
      {
        ...entrada(null, HTML_NUEVO),
        runtimeIntent,
        runtimeCapability: { allowed: false, reason: "off" },
      } as any,
      deps,
    );

    expect(r.ok).toBe(false);
    expect(visto.guardados).toBe(0);
    expect(visto.snapshots).toBe(0);
  });


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

    await persistPage(
      {
        ...entrada(null, HTML_NUEVO),
        runtimeIntent: { kind: "reemplazar", code: NUEVO },
        runtimeCapability: { allowed: true },
      },
      deps,
    );

    expect(verifyCapsule(visto.runtime, { projectId: PID, html: HTML_NUEVO })).toEqual({
      ok: true,
      code: NUEVO,
    });
  });

  /**
   * INVERTIDA el 2026-08-25. Esta prueba fijaba «en una SUBPÁGINA el script se
   * rechaza antes de guardar», y era cierto — pero describía una limitación de
   * ALMACENAMIENTO vendida como regla de producto: la cápsula ata el código a un
   * documento y sólo había UNA columna, así que sólo la Home podía llevarlo.
   *
   * Ahora cada página guarda la suya. Lo que hay que clavar ya no es que se
   * rechace, sino que se guarde EN SU SITIO: un script de /menu que acabara en
   * la columna de la Home se llevaría por delante el de la portada.
   */
  it("una SUBPÁGINA guarda su script, y lo guarda como suyo", async () => {
    const viejo = buildCapsule({ projectId: PID, html: HTML_VIEJO, code: CODIGO });
    const { deps, visto } = espia({ html: HTML_VIEJO }, viejo);

    const r = await persistPage(
      {
        ...entrada("menu", HTML_NUEVO),
        runtimeIntent: { kind: "reemplazar", code: `document.title = "sub";` },
        runtimeCapability: { allowed: true },
      },
      deps,
    );

    expect(r.ok).toBe(true);
    expect(visto.guardados).toBe(1);
    expect(visto.page, "el script se guardó sin decir de quién era").toBe("menu");
    // Y la cápsula ata el código al HTML de ESA página, no al de la Home.
    const guardada = visto.runtime as { code: string };
    expect(guardada.code).toBe(`document.title = "sub";`);
    expect(
      verifyCapsule(guardada, { projectId: PID, html: HTML_NUEVO }).ok,
      "la cápsula no cuadra con el documento de su propia página",
    ).toBe(true);
  });

  it("paginaGuardaRuntime: sólo la Home", () => {
    expect(paginaGuardaRuntime(null)).toBe(true);
    expect(paginaGuardaRuntime(undefined)).toBe(true);
    expect(paginaGuardaRuntime("menu")).toBe(false);
  });

  // Y lo contrario: una edición por ops no trae script, y lo que corresponde es
  // RE-SELLAR el que ya había. Tirarlo sería borrar el trabajo del modelo porque
  // este turno concreto no produjo uno.
  it("sin script en el turno, se conserva el anterior re-sellado", async () => {
    const viejo = buildCapsule({ projectId: PID, html: HTML_VIEJO, code: CODIGO });
    const { deps, visto } = espia({ html: HTML_VIEJO }, viejo);

    await persistPage({ ...entrada(null, HTML_NUEVO) }, deps);

    expect((visto.runtime as { code: string }).code).toBe(CODIGO);
  });

  // Y lo mismo dicho a la cara: `preservar` explícito hace exactamente lo que
  // la ausencia. Son el mismo estado, no dos parecidos.
  it("`preservar` explícito conserva igual que no decir nada", async () => {
    const viejo = buildCapsule({ projectId: PID, html: HTML_VIEJO, code: CODIGO });
    const { deps, visto } = espia({ html: HTML_VIEJO }, viejo);

    await persistPage(
      { ...entrada(null, HTML_NUEVO), runtimeIntent: { kind: "preservar" } },
      deps,
    );

    expect((visto.runtime as { code: string }).code).toBe(CODIGO);
  });

  // ── EL HALLAZGO 3 ────────────────────────────────────────────────────────
  // «Un runtime se puede reemplazar, pero no borrar». Hasta hoy `null` y
  // `undefined` significaban los dos «preservar», y preservar RE-SELLA: a una
  // página con JavaScript del modelo no había NINGUNA forma de quitárselo.
  it("`borrar` vacía la columna de verdad", async () => {
    const viejo = buildCapsule({ projectId: PID, html: HTML_VIEJO, code: CODIGO });
    const { deps, visto } = espia({ html: HTML_VIEJO }, viejo);

    const r = await persistPage(
      {
        ...entrada(null, HTML_NUEVO),
        runtimeIntent: { kind: "borrar" },
        runtimeCapability: { allowed: true },
      },
      deps,
    );

    expect(r.ok).toBe(true);
    // `null` EXACTO: es lo único que el escritor traduce a un UPDATE que pone
    // la columna a NULL. `undefined` dejaría el script donde estaba.
    expect(visto.runtime).toBeNull();
  });

  // El borrado también es POR PÁGINA. Lo que este `null` tiene que vaciar es la
  // entrada de /menu, y nada más — el reparto lo decide `columnasDeRuntime`, y
  // aquí se comprueba que la intención llega con el nombre de su página.
  it("un `borrar` desde una SUBPÁGINA vacía la suya, no la de la Home", async () => {
    const data: ProjectData = { html: HTML_VIEJO, pages: { menu: { html: HTML_VIEJO } } };
    const viejo = buildCapsule({ projectId: PID, html: HTML_VIEJO, code: CODIGO });
    const { deps, visto } = espia(data, viejo);

    const r = await persistPage(
      {
        ...entrada("menu", HTML_NUEVO),
        runtimeIntent: { kind: "borrar" },
        runtimeCapability: { allowed: true },
      },
      deps,
    );

    expect(r.ok).toBe(true);
    expect(visto.guardados).toBe(1);
    expect(visto.page).toBe("menu");
    // `null` EXACTO, igual que en la Home: es lo único que el escritor traduce a
    // «vacía esta entrada». `undefined` dejaría el script donde estaba.
    expect(visto.runtime).toBeNull();
  });

  // CONTRA-PRUEBA del tercer estado: sin cápsula y sin intención, lo que viaja
  // es `undefined` — nunca `null`. Con `null` aquí, CADA edición de CADA
  // proyecto sin JavaScript escribiría un NULL sobre la columna. Inofensivo
  // hoy, pero es exactamente el descuido que el arreglo introduce si se hace
  // mal, así que queda clavado.
  it("CONTRA-PRUEBA: sin cápsula y sin intención viaja undefined, no null", async () => {
    const { deps, visto } = espia({ html: HTML_VIEJO }, null);
    await persistPage(entrada(null, HTML_NUEVO), deps);
    expect(visto.guardados).toBe(1);
    expect(visto.runtime).toBeUndefined();
  });

  it("`borrar` retira el aviso de runtime desfasado", async () => {
    const viejo = buildCapsule({ projectId: PID, html: HTML_VIEJO, code: CODIGO });
    const data: ProjectData = {
      html: HTML_VIEJO,
      degradations: [
        { surface: "generate", stage: "publish", code: "runtime_stale", count: 2 },
      ],
    } as ProjectData;
    const { deps, visto } = espia(data, viejo);

    await persistPage(
      {
        ...entrada(null, HTML_NUEVO),
        runtimeIntent: { kind: "borrar" },
        runtimeCapability: { allowed: true },
      },
      deps,
    );

    // Quitar el JavaScript arregla, por definición, todas sus referencias
    // muertas: dejar el aviso sería enseñar un problema que ya no existe.
    const quedan = (visto.data?.degradations ?? []).filter((d) => d.code === "runtime_stale");
    expect(quedan).toHaveLength(0);
  });
});

/**
 * LA NUMERACIÓN DE LOS FORMULARIOS.
 *
 * `settings.forms` se resuelve por la POSICIÓN del `<form>` en el documento
 * (`formConfigKey`), igual que el correo de aviso del endpoint de envío. Una
 * edición que inserta o quita un formulario corre esa numeración, así que lo
 * que el dueño configuró para "contacto" pasa a aplicarse a otro formulario.
 *
 * Nadie lo notaba: los mensajes seguían llegando, a la bandeja equivocada. Esto
 * vigila que deje de ser silencioso.
 */
describe("deriva de la numeración de formularios", () => {
  const conFormularios = (n: number) =>
    `<!doctype html><html><body>${"<form action=\"/api/f/x\"></form>".repeat(n)}</body></html>`;
  const CONFIGURADO: ProjectData = {
    html: conFormularios(1),
    settings: { forms: { "0": { notifyEmail: "ventas@negocio.mx" } } },
  } as ProjectData;

  it("avisa cuando una edición cambia CUÁNTOS formularios hay", async () => {
    const { deps, visto } = espia(CONFIGURADO, null);
    await persistPage(entrada(null, conFormularios(2)), deps);
    const d = visto.data?.degradations ?? [];
    expect(d.map((x) => x.code)).toContain("form_routing_stale");
  });

  it("el aviso reaparece aunque el usuario ya hubiera cerrado otro", async () => {
    const { deps, visto } = espia({ ...CONFIGURADO, degradationsDismissed: true }, null);
    await persistPage(entrada(null, conFormularios(0)), deps);
    expect(visto.data?.degradationsDismissed).toBe(false);
  });

  // Editar el texto de la página no puede encender un aviso sobre formularios:
  // un aviso que sale siempre es ruido, y el ruido es como se vuelve al silencio
  // por otra puerta.
  it("NO avisa cuando el número de formularios no cambió", async () => {
    const { deps, visto } = espia(CONFIGURADO, null);
    await persistPage(entrada(null, conFormularios(1).replace("<body>", "<body><h1>hola</h1>")), deps);
    expect((visto.data?.degradations ?? []).map((x) => x.code)).not.toContain("form_routing_stale");
  });

  // Sin nada configurado no hay nada que se pueda desalinear: el endpoint cae al
  // correo de la cuenta, que es el mismo pase lo que pase con el orden.
  it("NO avisa cuando el dueño no configuró ningún formulario", async () => {
    const sinConfig = { html: conFormularios(1) } as ProjectData;
    const { deps, visto } = espia(sinConfig, null);
    await persistPage(entrada(null, conFormularios(3)), deps);
    expect((visto.data?.degradations ?? []).map((x) => x.code)).not.toContain("form_routing_stale");
  });

  it("no duplica el aviso al repetirse la edición", async () => {
    const yaAvisado: ProjectData = {
      ...CONFIGURADO,
      degradations: [{ surface: "generate", stage: "publish", code: "form_routing_stale", count: 1 }],
    } as ProjectData;
    const { deps, visto } = espia(yaAvisado, null);
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
    const { deps, visto } = espia(data, null);
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
    const { deps } = espia({ html: HTML_VIEJO }, null);
    const r = await persistPage(entrada(null, HTML_VIEJO), deps);
    expect(r.ok && r.sinCambios).toBe(true);
  });

  it("NO lo marca cuando el documento cambió", async () => {
    const { deps } = espia({ html: HTML_VIEJO }, null);
    const r = await persistPage(entrada(null, HTML_NUEVO), deps);
    expect(r.ok && r.sinCambios).toBe(false);
  });

  // El caso que el arreglo de hoy hace posible: sólo cambia el comportamiento.
  // El html es idéntico A PROPÓSITO y el turno NO está vacío.
  it("NO lo marca cuando el turno trae JavaScript nuevo aunque el html no cambie", async () => {
    const { deps } = espia({ html: HTML_VIEJO }, null);
    const r = await persistPage(
      {
        ...entrada(null, HTML_VIEJO),
        runtimeIntent: { kind: "reemplazar", code: `const nuevo = 1;` },
        runtimeCapability: { allowed: true },
      },
      deps,
    );
    expect(r.ok && r.sinCambios).toBe(false);
  });

  // Un borrado tampoco es un turno vacío: el html sale idéntico y lo que cambió
  // vive en `generatedRuntime`. Marcarlo `sinCambios` haría que el Agente le
  // dijera al usuario «no cambié nada» justo después de quitarle el carrito.
  it("NO lo marca cuando el turno RETIRA el JavaScript, aunque el html no cambie", async () => {
    const viejo = buildCapsule({ projectId: PID, html: HTML_VIEJO, code: CODIGO });
    const { deps } = espia({ html: HTML_VIEJO }, viejo);
    const r = await persistPage(
      {
        ...entrada(null, HTML_VIEJO),
        runtimeIntent: { kind: "borrar" },
        runtimeCapability: { allowed: true },
      },
      deps,
    );
    expect(r.ok && r.sinCambios).toBe(false);
  });

  it("también vigila las subpáginas", async () => {
    const data: ProjectData = { html: HTML_VIEJO, pages: { menu: { html: HTML_VIEJO } } };
    const { deps } = espia(data, null);
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
    const { deps, visto } = espia(data, null);
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
    const { deps, visto } = espia(data, null);
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
    const { deps, visto } = espia(data, null);
    const dos = SIN_ID.replace("<form>", "<form><input name=a></form><form>");
    await persistPage(entrada(null, dos), deps);
    expect((visto.data?.degradations ?? []).some((x) => x.code === "form_routing_stale")).toBe(true);
  });
});

/** El runtime que quedó hablando de una página que ya no existe. */
describe("runtime obsoleto", () => {
  const CODIGO_ROTO = `document.getElementById('carrito').addEventListener('click', f);`;

  it("avisa cuando la edición quitó el elemento que el script busca", async () => {
    const capsule = buildCapsule({ projectId: PID, html: HTML_VIEJO, code: CODIGO_ROTO });
    const { deps, visto } = espia({ html: HTML_VIEJO }, capsule);
    await persistPage(entrada(null, HTML_NUEVO), deps);
    const d = (visto.data?.degradations ?? []).find((x) => x.code === "runtime_stale");
    expect(d, "no avisó del runtime obsoleto").toBeTruthy();
    expect(d?.detail?.[0]).toContain("carrito");
    expect(visto.data?.degradationsDismissed).toBe(false);
  });

  it("RETIRA el aviso cuando el elemento vuelve — uno que no sabe irse enseña a ignorarlos", async () => {
    const capsule = buildCapsule({ projectId: PID, html: HTML_VIEJO, code: CODIGO_ROTO });
    const data: ProjectData = {
      html: HTML_VIEJO,
      degradations: [{ surface: "generate", stage: "publish", code: "runtime_stale", count: 1 }],
    };
    const { deps, visto } = espia(data, capsule);
    const arreglado = `<!doctype html><html><body><div id="carrito"></div></body></html>`;
    await persistPage(entrada(null, arreglado), deps);
    expect((visto.data?.degradations ?? []).some((x) => x.code === "runtime_stale")).toBe(false);
  });

  it("no dice nada cuando no hay cápsula", async () => {
    const { deps, visto } = espia({ html: HTML_VIEJO }, null);
    await persistPage(entrada(null, HTML_NUEVO), deps);
    expect((visto.data?.degradations ?? []).some((x) => x.code === "runtime_stale")).toBe(false);
  });
});

// La regla que los DOS escritores comparten. Vive probada aquí y no duplicada
// en cada ruta porque el defecto del hallazgo 3 era exactamente eso: las dos
// hacían `runtime ? { … } : {}` y un borrado —que viaja como `null`— se perdía
// en silencio en las dos a la vez.
describe("columnaRuntime: qué le pasa a generatedRuntime", () => {
  it("undefined = no toques la columna", () => {
    expect(columnaRuntime(undefined)).toEqual({});
    expect("generatedRuntime" in columnaRuntime(undefined)).toBe(false);
  });

  it("null = VACÍALA (y la clave tiene que estar presente)", () => {
    const set = columnaRuntime(null);
    expect("generatedRuntime" in set).toBe(true);
    expect(set.generatedRuntime).toBeNull();
  });

  it("una cápsula = escríbela", () => {
    const c = buildCapsule({ projectId: PID, html: HTML_NUEVO, code: CODIGO });
    expect(columnaRuntime(c)).toEqual({ generatedRuntime: c });
  });
});
