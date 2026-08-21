import { describe, expect, it } from "vitest";

import {
  buildCapsule,
  runtimeDigest,
  verifyCapsule,
  RUNTIME_CAPSULE_VERSION,
  authorizeRuntimeForPublish,
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
    pageCount: 0,
    hasCustomDomain: false,
    pageEligible: true,
  };

  it("con todo en su sitio, autoriza", () => {
    expect(authorizeRuntimeForPublish(base)).toEqual({ kind: "authorized", code: BASE.code });
  });

  it.each([
    ["el interruptor apagado", { env: {} as unknown as NodeJS.ProcessEnv }, "apagado"],
    ["un dominio propio", { hasCustomDomain: true }, "dominio_propio"],
    ["varias páginas", { pageCount: 2 }, "varias_paginas"],
    ["formularios o módulos", { pageEligible: false }, "pagina_no_elegible"],
    ["sin cápsula", { capsule: null }, "ausente"],
  ])("%s lo omite", (_, delta, reason) => {
    expect(authorizeRuntimeForPublish({ ...base, ...delta })).toEqual({ kind: "skipped", reason });
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
