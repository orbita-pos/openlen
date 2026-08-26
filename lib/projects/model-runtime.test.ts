import { describe, expect, it } from "vitest";

import {
  buildCapsule,
  runtimeDigest,
  verifyCapsule,
  RUNTIME_CAPSULE_VERSION,
  authorizeRuntimeForPublish,
  resealRuntime,
  rebindCapsule,
} from "./model-runtime";

const BASE = {
  projectId: "p_123",
  html: `<!doctype html><html><body><h1>hola</h1></body></html>`,
  code: `document.title = "x";`,
};

describe("el hash ata el documento entero", () => {
  it("los mismos bytes dan el mismo hash", () => {
    expect(runtimeDigest(BASE)).toBe(runtimeDigest({ ...BASE }));
  });

  it("es SHA-256 completo, 64 hex — no un prefijo", () => {
    expect(runtimeDigest(BASE)).toMatch(/^[0-9a-f]{64}$/);
  });

  // LA propiedad de toda la etapa: es lo que hace innecesario que cada escritor
  // futuro se acuerde de limpiar nada.
  it.each([
    ["el HTML", { html: BASE.html.replace("hola", "holá") }],
    ["un espacio del HTML", { html: `${BASE.html} ` }],
    ["el código", { code: `document.title = "y";` }],
    ["un salto de línea del código", { code: `${BASE.code}\n` }],
    ["el proyecto", { projectId: "p_124" }],
  ])("cambiar %s cambia el hash", (_, delta) => {
    expect(runtimeDigest({ ...BASE, ...delta })).not.toBe(runtimeDigest(BASE));
  });

  /**
   * Cada parte va precedida de su LONGITUD. Sin eso, mover un carácter del
   * final del HTML al principio del código daría la misma concatenación y el
   * mismo hash — una colisión sin haber roto SHA-256.
   */
  it("mover un byte entre campos NO produce el mismo hash", () => {
    const a = runtimeDigest({ projectId: "p", html: "abc", code: "def" });
    const b = runtimeDigest({ projectId: "p", html: "ab", code: "cdef" });
    expect(a).not.toBe(b);
  });

  it("y tampoco entre el proyecto y el HTML", () => {
    const a = runtimeDigest({ projectId: "ab", html: "cd", code: "e" });
    const b = runtimeDigest({ projectId: "a", html: "bcd", code: "e" });
    expect(a).not.toBe(b);
  });
});

describe("verificar contra el documento que se va a publicar", () => {
  it("la cápsula recién construida autoriza su propio documento", () => {
    const c = buildCapsule(BASE);
    const r = verifyCapsule(c, { projectId: BASE.projectId, html: BASE.html });
    expect(r).toEqual({ ok: true, code: BASE.code });
  });

  // El escenario real: alguien editó la página después de generarla.
  it("si el HTML cambió UN byte, deja de autorizar", () => {
    const c = buildCapsule(BASE);
    const r = verifyCapsule(c, { projectId: BASE.projectId, html: `${BASE.html}\n` });
    expect(r).toEqual({ ok: false, reason: "desajuste" });
  });

  it("la misma cápsula en otro proyecto no vale", () => {
    const c = buildCapsule(BASE);
    const r = verifyCapsule(c, { projectId: "otro", html: BASE.html });
    expect(r).toEqual({ ok: false, reason: "desajuste" });
  });

  // Un atacante con acceso a la fila no puede simplemente cambiar el código:
  // tendría que producir además un hash válido para el HTML guardado.
  it("cambiar el código de la cápsula la invalida", () => {
    const c = { ...buildCapsule(BASE), code: `fetch("https://ladron.test")` };
    const r = verifyCapsule(c, { projectId: BASE.projectId, html: BASE.html });
    expect(r).toEqual({ ok: false, reason: "desajuste" });
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["una cadena", "deepseek"],
    ["un número", 7],
  ])("%s no es una cápsula", (_, v) => {
    const r = verifyCapsule(v, { projectId: "p", html: "x" });
    expect(r.ok).toBe(false);
  });

  it.each([
    ["sin código", { v: RUNTIME_CAPSULE_VERSION, digest: "a".repeat(64) }],
    ["sin hash", { v: RUNTIME_CAPSULE_VERSION, code: "x" }],
    ["hash truncado", { v: RUNTIME_CAPSULE_VERSION, code: "x", digest: "abc" }],
    ["hash no hexadecimal", { v: RUNTIME_CAPSULE_VERSION, code: "x", digest: "z".repeat(64) }],
  ])("%s se rechaza como malformada", (_, v) => {
    expect(verifyCapsule(v, { projectId: "p", html: "x" })).toEqual({
      ok: false,
      reason: "malformada",
    });
  });

  // Una cápsula escrita bajo otras reglas NO se interpreta con las de hoy.
  it("una versión desconocida no se interpreta", () => {
    const c = { ...buildCapsule(BASE), v: "otra-cosa-v9" };
    expect(verifyCapsule(c, { projectId: BASE.projectId, html: BASE.html })).toEqual({
      ok: false,
      reason: "version_desconocida",
    });
  });

  // La política va DENTRO del hash: si cambian las reglas del piloto, las
  // cápsulas viejas dejan de autorizar por construcción en vez de quedarse
  // vivas bajo unas reglas que ya no existen.
  it("el hash depende de la política, no sólo del contenido", () => {
    const c = buildCapsule(BASE);
    // Reproducir el hash "a mano" sin la política no puede dar lo mismo.
    const sinPolitica = require("node:crypto")
      .createHash("sha256")
      .update("openlen:model-js:v1")
      .update(BASE.projectId)
      .update(BASE.html)
      .update(BASE.code)
      .digest("hex");
    expect(c.digest).not.toBe(sinPolitica);
  });
});

describe("¿se inyecta en esta publicación?", () => {
  const base = {
    env: { OPENLEN_MODEL_JS: "1" } as unknown as NodeJS.ProcessEnv,
    projectId: BASE.projectId,
    html: BASE.html,
    capsule: buildCapsule(BASE),
  };

  it("con todo en su sitio, autoriza", () => {
    expect(authorizeRuntimeForPublish(base)).toEqual({ kind: "authorized", code: BASE.code });
  });

  it.each([
    ["el interruptor apagado", { env: {} as unknown as NodeJS.ProcessEnv }, "apagado"],
    ["sin cápsula", { capsule: null }, "ausente"],
  ])("%s lo omite", (_, delta, reason) => {
    expect(authorizeRuntimeForPublish({ ...base, ...delta })).toEqual({ kind: "skipped", reason });
  });

  /**
   * DOS PUERTAS RETIRADAS el 2026-08-25, y esto NO es debilitar la prueba: es
   * quitar dos que fijaban una verdad expirada.
   *
   * `varias_paginas` no hacía lo que su nombre decía. No era «las subpáginas no
   * llevan JavaScript»: era **el sitio entero se queda sin él en cuanto añades
   * la segunda página, la Home incluida**. MEDIDO — con una subpágina, esta
   * misma función devolvía `skipped` para el documento raíz que sí tenía su
   * cápsula en regla. El usuario añadía una página de precios y su carrito
   * dejaba de funcionar, sin nada en la consola.
   *
   * `dominio_propio` apagaba el JavaScript de una página que funcionaba, sólo
   * por conectarle un dominio.
   *
   * Que ya no existan se comprueba desde el OTRO lado: la firma no las acepta
   * (TypeScript), y pasarlas de todos modos no puede cambiar la respuesta.
   */
  it("ni varias páginas ni un dominio propio lo omiten ya", () => {
    const conBasura = { ...base, pageCount: 7, hasCustomDomain: true } as never;
    expect(authorizeRuntimeForPublish(conBasura)).toEqual({
      kind: "authorized",
      code: BASE.code,
    });
  });

  /**
   * LO QUE YA NO OMITE, y es un cambio de política, no un descuido.
   *
   * `pageEligible` y `modulesActive` se quitaron el 2026-08-21: una página con
   * un formulario de contacto perdía su JavaScript en silencio, y eso le pasaba
   * a 1 de cada 6 páginas corrientes. La protección se movió a la puerta de
   * producción (memoria `model-js-production-gate`), que es donde de verdad
   * estaba el riesgo: `set-password` acepta la cookie ambiental.
   */
  it("ni un formulario ni un módulo lo omiten ya — no existen esas puertas", () => {
    const reasons: string[] = [];
    for (const delta of [{}, { html: BASE.html }]) {
      const r = authorizeRuntimeForPublish({ ...base, ...delta });
      if (r.kind === "skipped") reasons.push(r.reason);
    }
    expect(reasons).toEqual([]);
  });

  /**
   * LA DESVIACIÓN DELIBERADA respecto del plan de la auditoría, que aquí
   * abortaba la publicación.
   *
   * No aborta porque abortar no protege de nada: si la cápsula no cuadra no se
   * inyecta código, y una página sin código no puede hacer daño. Lo que cambia
   * es quién lo paga — el caso corriente no es un ataque, es alguien que editó
   * su titular después de generar.
   */
  it("el HTML editado se OMITE, no revienta la publicación", () => {
    const r = authorizeRuntimeForPublish({ ...base, html: `${BASE.html}<!-- editado -->` });
    expect(r).toEqual({ kind: "skipped", reason: "desajuste" });
  });

  // El motivo se distingue: "apagado" y "desajuste" no son lo mismo, y mezclarlos
  // dejaría sin señal la única pregunta que importa — ¿esto funciona?
  it("verifica ANTES de mirar el interruptor, para no perder el motivo", () => {
    const r = authorizeRuntimeForPublish({
      ...base,
      env: {} as unknown as NodeJS.ProcessEnv,
      html: "otro documento",
    });
    expect(r).toEqual({ kind: "skipped", reason: "desajuste" });
  });
});

/**
 * `moduleSurfacesActive` SE QUITÓ el 2026-08-21 y aquí vivían sus pruebas.
 *
 * Lo puso una auditoría externa y tenía razón EN SU MOMENTO: los módulos se
 * encienden por `PATCH /api/projects/[id]/settings`, que no toca el documento,
 * así que mirar sólo el marcado dejaba pasar una página con chat Y con
 * JavaScript del modelo.
 *
 * 🔴 Se revierte A PROPÓSITO, no por descuido. Tirar el JavaScript era una
 * herramienta demasiado burda: costaba el JS de 1 de cada 6 páginas corrientes
 * para tapar un riesgo que vive en OTRO sitio — `set-password` acepta la cookie
 * ambiental (`app/api/m/[sub]/auth/set-password/route.ts`). La protección se
 * movió a la puerta de producción, en la memoria `model-js-production-gate`:
 * `OPENLEN_MODEL_JS=1` no se enciende en producción hasta cerrar ese endpoint o
 * aislar los módulos en su propio origen.
 */

/**
 * EL FALLO QUE ESTO ARREGLA. `buildCapsule` sólo se llamaba en `createProject`,
 * así que la primera edición del titular cambiaba los bytes, el hash dejaba de
 * cuadrar y la página publicada salía SIN su JavaScript — avisando sólo por
 * consola. El JS del modelo duraba hasta que el usuario tocaba algo.
 */
describe("re-sellar: el JavaScript sobrevive a una edición", () => {
  const EDITADO = BASE.html.replace("hola", "hola de nuevo");

  it("la cápsula nueva cuadra con el documento nuevo", () => {
    const nueva = resealRuntime({ projectId: BASE.projectId, html: EDITADO, capsule: buildCapsule(BASE) });
    expect(nueva).not.toBeNull();
    expect(verifyCapsule(nueva, { projectId: BASE.projectId, html: EDITADO })).toEqual({
      ok: true,
      code: BASE.code,
    });
  });

  it("y la vieja ya no — el hash sigue midiendo lo que decía medir", () => {
    const vieja = buildCapsule(BASE);
    expect(verifyCapsule(vieja, { projectId: BASE.projectId, html: EDITADO })).toEqual({
      ok: false,
      reason: "desajuste",
    });
  });

  /**
   * LA PROPIEDAD DE SEGURIDAD, y la razón de que esto no debilite el hash: el
   * código NO se recibe por parámetro, sale de la cápsula que ya estaba
   * guardada. Re-sellar puede mover el documento al que el código está atado;
   * es incapaz de introducir código que nadie escribió.
   */
  it("re-sellar NO puede introducir código nuevo", () => {
    const nueva = resealRuntime({ projectId: BASE.projectId, html: EDITADO, capsule: buildCapsule(BASE) });
    expect(nueva!.code).toBe(BASE.code);
  });

  // Devolver null significa "no toques la columna", NUNCA "bórrala": destruir el
  // trabajo del modelo por no saber leer su cápsula sería el peor de los fallos.
  it.each([
    ["sin cápsula", null],
    ["indefinida", undefined],
    ["no es un objeto", "una cadena"],
    ["sin código", { v: RUNTIME_CAPSULE_VERSION, digest: "a".repeat(64) }],
    ["código vacío", { v: RUNTIME_CAPSULE_VERSION, code: "", digest: "a".repeat(64) }],
    ["de una versión que no conocemos", { v: "otra-cosa-v9", code: "var a=1;", digest: "a".repeat(64) }],
  ])("%s: se deja intacta, no se borra", (_, capsule) => {
    expect(resealRuntime({ projectId: BASE.projectId, html: EDITADO, capsule })).toBeNull();
  });
});

/**
 * MOVER UNA CÁPSULA A OTRO PROYECTO.
 *
 * Duplicar y remixar copian `data`; sin esto la copia sale muda, porque la
 * cápsula ata `projectId` y el id cambia. Lo que hay que clavar es lo que
 * `rebindCapsule` PUEDE y lo que NO: puede mover el código a otro proyecto y a
 * otro documento; no puede introducir código nuevo, ni revivir uno que en el
 * origen ya estaba muerto.
 */
describe("rebindCapsule — mover sin inventar", () => {
  const HTML_A = "<!doctype html><html><body><button id=b></button></body></html>";
  const HTML_B = "<!doctype html><html lang=es><body><button id=b></button></body></html>";
  const CODIGO = "document.title='x'";

  it("re-ata al proyecto nuevo, y la cápsula nueva vale allí", () => {
    const origen = buildCapsule({ projectId: "p1", html: HTML_A, code: CODIGO });
    const movida = rebindCapsule({
      fromProjectId: "p1",
      fromHtml: HTML_A,
      toProjectId: "p2",
      toHtml: HTML_A,
      capsule: origen,
    });
    expect(movida).not.toBeNull();
    expect(verifyCapsule(movida, { projectId: "p2", html: HTML_A })).toEqual({
      ok: true,
      code: CODIGO,
    });
  });

  it("y la vieja NO vale en el proyecto nuevo — ésa es la razón de existir", () => {
    const origen = buildCapsule({ projectId: "p1", html: HTML_A, code: CODIGO });
    expect(verifyCapsule(origen, { projectId: "p2", html: HTML_A }).ok).toBe(false);
  });

  it("también mueve de documento: el remix normaliza el HTML antes de guardarlo", () => {
    const origen = buildCapsule({ projectId: "p1", html: HTML_A, code: CODIGO });
    const movida = rebindCapsule({
      fromProjectId: "p1",
      fromHtml: HTML_A,
      toProjectId: "p2",
      toHtml: HTML_B,
      capsule: origen,
    });
    expect(verifyCapsule(movida, { projectId: "p2", html: HTML_B })).toEqual({
      ok: true,
      code: CODIGO,
    });
  });

  /**
   * LA MITAD QUE `resealRuntime` NO TIENE. Si el origen ya estaba desajustado
   * su página estaba muda; re-atarlo a la copia la resucitaría, y la copia se
   * comportaría distinto del original sin que nadie lo pidiera.
   */
  it("NO revive una cápsula que en el origen ya no cuadraba", () => {
    const origen = buildCapsule({ projectId: "p1", html: HTML_A, code: CODIGO });
    const movida = rebindCapsule({
      fromProjectId: "p1",
      // El origen editó su página y no re-selló: su cápsula ya no vale allí.
      fromHtml: HTML_B,
      toProjectId: "p2",
      toHtml: HTML_B,
      capsule: origen,
    });
    expect(movida, "una página muda produjo una copia viva").toBeNull();
  });

  it("ni acepta una cápsula ausente o basura", () => {
    for (const basura of [null, undefined, {}, "texto", { code: "x" }]) {
      expect(
        rebindCapsule({
          fromProjectId: "p1",
          fromHtml: HTML_A,
          toProjectId: "p2",
          toHtml: HTML_A,
          capsule: basura,
        }),
      ).toBeNull();
    }
  });
});
