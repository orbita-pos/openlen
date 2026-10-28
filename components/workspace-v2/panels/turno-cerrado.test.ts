import { readFileSync } from "node:fs";
// Hallazgo 4B — «Chat y Len pueden mutar la página de forma durable y terminar
// como un fallo puro». Esta es la mitad del cliente: la decisión de pintar rojo
// o cerrar aplicado-con-aviso.
import { describe, expect, it } from "vitest";
import { avisoDelTurno, cierreDeTurno, laPaginaNoCambio, lineaGuardadaDelCierre } from "./turno-cerrado";

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

  // Un cambio de AJUSTES (hoy, un módulo) es
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
  const TOPE = "El agente alcanzó su límite de pasos por turno.";
  const plantillaDeCorte = (motivo: string) => `⚠️ Este turno se cortó antes de terminar (${motivo}).`;

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
  // `toggle_module` y compañía mutan de forma durable SIN emitir documento.
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

// A11: una charla que no cabe y no se pudo resumir lo dice, también al recargar.
describe("A11 · conversación demasiado larga", () => {
  it("🔴 context_too_long tiene su aviso desde la fila, como las demás paradas", () => {
    expect(avisoDelTurno({ endReason: "context_too_long" }, (code) => `errors.${code}`)).toEqual({ motivo: "errors.context_too_long", cortado: true });
  });
  it("🔴 y su texto existe en los 10 idiomas", () => {
    for (const l of ["de", "en", "es", "fr", "it", "ja", "ko", "nl", "pt", "zh"]) {
      const m = JSON.parse(readFileSync(`messages/${l}/wsPage.json`, "utf8")) as Record<string, Record<string, Record<string, string>>>;
      const errores = Object.values(m).find((v) => v && typeof v === "object" && "errors" in v)?.errors;
      expect(typeof errores?.context_too_long, l).toBe("string");
    }
  });
});

// Un turno que un reinicio dejó huérfano: lo cierran el reenganche o el arranque
// con `interrupted` (el `turn/end {interrupted}` de DeepSeek). Decía «El turno
// fue cancelado.», y nadie lo paró (ensayo de caja, 28/10).
describe("el turno que cortó un reinicio", () => {
  it("🔴 la huérfana cerrada con `interrupted` dice que se reinició el servidor, no que se canceló", () => {
    expect(avisoDelTurno({ cortado: true, endReason: "interrupted" }, (code) => `errors.${code}`)).toEqual({ motivo: "errors.interrupted", cortado: true });
  });
  it("brazo de control: el ■ sigue diciendo cancelado, y una cortada sin motivo (anterior) conserva el genérico", () => {
    expect(avisoDelTurno({ cortado: true, endReason: "cancelled" }, (code) => `errors.${code}`)?.motivo).toBe("errors.cancelled");
    expect(avisoDelTurno({ cortado: true }, (code) => `errors.${code}`)?.motivo).toBe("errors.cancelled");
  });
  it("🔴 y su texto existe en los 10 idiomas, sin la palabra de cancelar", () => {
    for (const l of ["de", "en", "es", "fr", "it", "ja", "ko", "nl", "pt", "zh"]) {
      const m = JSON.parse(readFileSync(`messages/${l}/wsPage.json`, "utf8")) as Record<string, Record<string, Record<string, string>>>;
      const errores = Object.values(m).find((v) => v && typeof v === "object" && "errors" in v)?.errors;
      expect(typeof errores?.interrupted, l).toBe("string");
      expect(errores?.interrupted, l).not.toBe(errores?.cancelled);
    }
  });
});
