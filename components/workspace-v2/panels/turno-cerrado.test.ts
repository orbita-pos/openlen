// Hallazgo 4B — «Chat y Len pueden mutar la página de forma durable y terminar
// como un fallo puro». Esta es la mitad del cliente: la decisión de pintar rojo
// o cerrar aplicado-con-aviso.
import { describe, expect, it } from "vitest";
import { cierreDeTurno } from "./turno-cerrado";

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
