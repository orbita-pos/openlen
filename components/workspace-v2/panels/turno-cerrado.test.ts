// Hallazgo 4B — «Chat y Len pueden mutar la página de forma durable y terminar
// como un fallo puro». Esta es la mitad del cliente: la decisión de pintar rojo
// o cerrar aplicado-con-aviso.
import { describe, expect, it } from "vitest";
import { cierreDeTurno, laPaginaNoCambio, lineaGuardadaDelCierre } from "./turno-cerrado";

describe("cierreDeTurno", () => {
  it("sin error, el turno cierra aplicado y sin aviso", () => {
    expect(
      cierreDeTurno({
        errorMessage: null,
        mutoDurable: true,
        hayDocumentoNuevo: true,
      }),
    ).toEqual({ kind: "aplicado" });
  });

  // ── El hallazgo ──────────────────────────────────────────────────────────
  it("un 503 DESPUÉS de guardar cierra aplicado, con el motivo a la vista", () => {
    expect(
      cierreDeTurno({
        errorMessage: "El agente se quedó sin espacio de respuesta.",
        mutoDurable: true,
        hayDocumentoNuevo: true,
      }),
    ).toEqual({
      kind: "aplicado-con-aviso",
      aviso: "El agente se quedó sin espacio de respuesta.",
      // Un error DESPUÉS de mutar es un corte de verdad (ver «un aviso no es un
      // corte», abajo).
      cortado: true,
    });
  });

  // Un cambio de AJUSTES (módulo, tema, motion, música, 3D, datos vivos) es
  // igual de durable y NO emite documento: el cliente sólo lo sabe porque el
  // servidor se lo dice.
  it("un cambio de AJUSTES cuenta aunque no haya documento nuevo", () => {
    const r = cierreDeTurno({
      errorMessage: "Gemini 503",
      mutoDurable: true,
      hayDocumentoNuevo: false,
    });
    expect(r.kind).toBe("aplicado-con-aviso");
  });

  // Y al revés: si el terminal nunca llegó (la ruta reventó tras pintar el
  // documento), el html que YA se pintó es prueba suficiente.
  it("un documento pintado basta aunque el servidor no llegue a decirlo", () => {
    const r = cierreDeTurno({
      errorMessage: "Unknown error",
      mutoDurable: false,
      hayDocumentoNuevo: true,
    });
    expect(r.kind).toBe("aplicado-con-aviso");
  });

  // ── CONTRA-PRUEBA ────────────────────────────────────────────────────────
  // El arreglo NO puede convertir cualquier fallo en «aplicado». Un turno que
  // no llegó a tocar nada sigue siendo un fallo puro y se pinta rojo, con su
  // botón de reintentar — que ahí sí es lo correcto.
  it("CONTRA-PRUEBA: un fallo SIN mutación sigue siendo rojo", () => {
    expect(
      cierreDeTurno({
        errorMessage: "El agente fue cancelado.",
        mutoDurable: false,
        hayDocumentoNuevo: false,
      }),
    ).toEqual({ kind: "error", texto: "El agente fue cancelado." });
  });
});

/**
 * SE QUEDÓ SIN CUERDA — el aviso que no salía de la ruta.
 *
 * `topeAlcanzado` existía en `AgentLoopResult` desde el 30/08, con un comentario
 * explicando que el caso del tope es «el MENOS visible: cuando closeOut redacta
 * el cierre elegante no se emite ningún evento error». Y no viajaba en el
 * terminal: lo leían las evals y nadie más. El usuario veía un turno verde y
 * limpio sobre una faena a medias.
 *
 * No es rojo: lo hecho está hecho y sigue siendo suyo. Es aviso.
 */
describe("el tope llega al usuario", () => {
  it("un turno limpio que agotó un tope cierra APLICADO CON AVISO", () => {
    expect(
      cierreDeTurno({
        errorMessage: null,
        avisoDeTope: "El agente llegó a su límite de pasos por turno.",
        mutoDurable: true,
        hayDocumentoNuevo: true,
      }),
    ).toEqual({
      kind: "aplicado-con-aviso",
      aviso: "El agente llegó a su límite de pasos por turno.",
    });
  });

  it("sin tope y sin error sigue siendo un aplicado limpio", () => {
    expect(
      cierreDeTurno({
        errorMessage: null,
        avisoDeTope: null,
        mutoDurable: true,
        hayDocumentoNuevo: true,
      }),
    ).toEqual({ kind: "aplicado" });
  });

  it("el campo es opcional: quien no lo pase se comporta como siempre", () => {
    expect(
      cierreDeTurno({ errorMessage: null, mutoDurable: false, hayDocumentoNuevo: false }),
    ).toEqual({ kind: "aplicado" });
  });

  // Un error de verdad gana: el tope no puede tapar un fallo.
  it("con error, manda el error", () => {
    expect(
      cierreDeTurno({
        errorMessage: "El modelo tuvo un problema.",
        avisoDeTope: "El agente llegó a su límite de pasos por turno.",
        mutoDurable: false,
        hayDocumentoNuevo: false,
      }),
    ).toEqual({ kind: "error", texto: "El modelo tuvo un problema." });
  });
});

/**
 * LA CONVERSACIÓN NO CABE ENTERA, y el usuario tiene derecho a saberlo.
 *
 * 🔴 Al MODELO ya se le decía —la nota de `buildAgentContext`, para que pueda
 * contestar «de eso ya no me acuerdo» en vez de nombrar el turno más viejo que
 * tenga a mano—. Al usuario no: veía a Len olvidar y no tenía forma de saber por
 * qué, ni de saber que seguir alargando la misma charla empeora la memoria en
 * vez de mejorarla.
 */
describe("el corte de la ventana llega al usuario", () => {
  const VENTANA = "Len ve los últimos 12 mensajes de esta conversación, de 20.";
  const TOPE = "El agente llegó a su límite de pasos por turno.";

  it("un turno limpio con la charla recortada cierra APLICADO CON AVISO", () => {
    expect(
      cierreDeTurno({
        errorMessage: null,
        avisoDeVentana: VENTANA,
        mutoDurable: true,
        hayDocumentoNuevo: true,
      }),
    ).toEqual({ kind: "aplicado-con-aviso", aviso: VENTANA });
  });

  // 🔴 LOS AVISOS SE SUMAN, NO SE PISAN. Quedarse sin pasos y estar hablando con
  // media conversación fuera de la ventana son DOS hechos distintos: quedarse
  // con uno le esconde el otro al usuario. Es la misma lección que los cuatro
  // `aviso_critico` sueltos en el mismo objeto de `editar_pagina`, donde ganaba
  // la última EN SILENCIO.
  it("y si además agotó un tope, se dicen LOS DOS", () => {
    const r = cierreDeTurno({
      errorMessage: null,
      avisoDeTope: TOPE,
      avisoDeVentana: VENTANA,
      mutoDurable: true,
      hayDocumentoNuevo: true,
    });
    expect(r.kind).toBe("aplicado-con-aviso");
    if (r.kind !== "aplicado-con-aviso") return;
    expect(r.aviso).toContain(TOPE);
    expect(r.aviso).toContain(VENTANA);
  });

  it("con error Y mutación, el error va delante y el aviso no se pierde", () => {
    const r = cierreDeTurno({
      errorMessage: "El modelo tuvo un problema.",
      avisoDeVentana: VENTANA,
      mutoDurable: true,
      hayDocumentoNuevo: true,
    });
    expect(r).toEqual({
      kind: "aplicado-con-aviso",
      aviso: `El modelo tuvo un problema. ${VENTANA}`,
      cortado: true,
    });
  });

  it("la charla que cabe entera no dice nada", () => {
    expect(
      cierreDeTurno({
        errorMessage: null,
        avisoDeVentana: null,
        mutoDurable: true,
        hayDocumentoNuevo: true,
      }),
    ).toEqual({ kind: "aplicado" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 UN AVISO NO ES UN CORTE (revisión pre-deploy del 2026-09-22).
//
// El panel marcaba `cortado` en TODO `aplicado-con-aviso`, y ese tipo sale
// también de un turno que terminó bien con el aviso de ventana o de tope. Con
// la marca puesta, el historial le decía al modelo que su turno anterior «se
// CORTÓ… y lo demás NO llegó a hacerse» — de un turno completo, en cada turno de
// una charla de más de doce. El servidor ya lo decide así (`corteDelTurno`: un
// tope no es un corte); el panel tiene que decir lo mismo.
// ─────────────────────────────────────────────────────────────────────────────
describe("un aviso no es un corte", () => {
  const VENTANA = "Len ve los últimos 12 mensajes de esta conversación, de 14.";
  const TOPE = "El agente alcanzó su límite de pasos por turno.";
  const plantillaDeCorte = (motivo: string) => `⚠️ Este turno se cortó antes de terminar (${motivo}).`;

  it("🔴 un turno limpio con el aviso de ventana NO está cortado, ni se guarda nada", () => {
    const cierre = cierreDeTurno({ errorMessage: null, avisoDeVentana: VENTANA, mutoDurable: true, hayDocumentoNuevo: true });
    expect(cierre.kind).toBe("aplicado-con-aviso");
    expect(cierre.kind === "aplicado-con-aviso" && cierre.cortado).toBeFalsy();
    // La ventana se recalcula en cada turno: guardarla en el texto la dejaría
    // dentro de lo que dijo Len, reenviada al modelo como si fuera suya.
    expect(lineaGuardadaDelCierre(cierre, { avisoDeTope: null, plantillaDeCorte })).toBeNull();
  });

  it("🔴 un turno que agotó el tope NO está cortado: se guarda el aviso del tope, no «se cortó»", () => {
    const cierre = cierreDeTurno({ errorMessage: null, avisoDeTope: TOPE, mutoDurable: true, hayDocumentoNuevo: true });
    expect(cierre.kind === "aplicado-con-aviso" && cierre.cortado).toBeFalsy();
    expect(lineaGuardadaDelCierre(cierre, { avisoDeTope: TOPE, plantillaDeCorte })).toBe(`⚠️ ${TOPE}`);
  });

  it("BRAZO DE CONTROL: un error DESPUÉS de mutar sí es un corte, y se guarda como tal", () => {
    const cierre = cierreDeTurno({ errorMessage: "El turno fue cancelado.", mutoDurable: true, hayDocumentoNuevo: true });
    expect(cierre.kind === "aplicado-con-aviso" && cierre.cortado).toBe(true);
    expect(lineaGuardadaDelCierre(cierre, { avisoDeTope: null, plantillaDeCorte })).toBe(
      plantillaDeCorte("El turno fue cancelado."),
    );
  });

  it("un turno aplicado sin aviso no guarda línea", () => {
    const cierre = cierreDeTurno({ errorMessage: null, mutoDurable: true, hayDocumentoNuevo: true });
    expect(lineaGuardadaDelCierre(cierre, { avisoDeTope: null, plantillaDeCorte })).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// «¿CAMBIÓ ALGO DE VERDAD?» — LA MISMA DECISIÓN, UNA SOLA VEZ.
//
// Vivía DOS veces en chat-panel.tsx, con condiciones distintas y 46 líneas de
// separación: la de la UI (la buena, con sus dos correcciones escritas) y la de
// `persistTurn`, que se quedó en la forma vieja de una sola condición. O sea que
// lo que el usuario veía en vivo y lo que veía al RECARGAR podían discrepar, y
// discrepaban en las dos direcciones.
//
// Es la forma exacta del segundo patrón de `reporta-exito-sin-haberlo-hecho`:
// la misma decisión escrita en N sitios y una se queda atrás.
// ─────────────────────────────────────────────────────────────────────────────
describe("laPaginaNoCambio", () => {
  // ── LA DIVERGENCIA (a) ───────────────────────────────────────────────────
  // `editar_pagina` que devuelve `sin_cambio` emite su evento `html` igual
  // —`updatedHtml` viaja siempre que la herramienta va bien—, así que el sitio
  // viejo lo guardaba como turno CON cambio. Al recargar aparecía un
  // «Aplicado · Deshacer» sobre un turno que no movió un byte.
  it("el servidor dijo sin_cambio: no cambió, AUNQUE llegara documento nuevo", () => {
    expect(
      laPaginaNoCambio({ huboCambioReal: false, hayDocumentoNuevo: true, mutoDurable: false }),
    ).toBe(true);
  });

  // ── LA DIVERGENCIA (b), al revés ─────────────────────────────────────────
  // `activar_modulo` y compañía mutan de forma durable SIN emitir documento.
  // El sitio viejo miraba sólo el documento, así que al recargar el turno
  // perdía el pie de Aplicado/Deshacer que sí tenía en vivo.
  it("un cambio de AJUSTES cuenta como cambio aunque no haya documento", () => {
    expect(
      laPaginaNoCambio({ huboCambioReal: null, hayDocumentoNuevo: false, mutoDurable: true }),
    ).toBe(false);
  });

  it("la charla pura no cambió nada", () => {
    expect(
      laPaginaNoCambio({ huboCambioReal: null, hayDocumentoNuevo: false, mutoDurable: false }),
    ).toBe(true);
  });

  it("una edición normal sí cambió", () => {
    expect(
      laPaginaNoCambio({ huboCambioReal: true, hayDocumentoNuevo: true, mutoDurable: true }),
    ).toBe(false);
  });

  // 🔴 BRAZO DE CONTROL. `huboCambioReal` es `boolean | null`, y `null` significa
  // «el servidor no lo dijo», NO «no cambió». Escribir `!args.huboCambioReal` en
  // vez de `=== false` pone esto rojo, que es exactamente lo que tiene que pasar:
  // un turno del que no sabemos nada pero que trajo documento nuevo SÍ cambió.
  it("null NO es «sin cambio»: sin dato del servidor manda el documento", () => {
    expect(
      laPaginaNoCambio({ huboCambioReal: null, hayDocumentoNuevo: true, mutoDurable: false }),
    ).toBe(false);
  });
});
