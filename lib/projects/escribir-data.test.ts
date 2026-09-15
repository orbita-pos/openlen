// I4 · TODOS LOS ESCRITORES DE `project.data`, CON CONCURRENCIA OPTIMISTA.
//
// Dos pruebas y un guardia:
//   1. El compare-and-swap va en el WHERE — no en un `if` de JavaScript, que
//      dejaría un hueco entre comprobar y escribir.
//   2. Perder el CAS NO pierde el trabajo: se vuelve a leer y se vuelve a
//      aplicar SOBRE lo que escribió el otro.
// El guardia (que ningún escritor se salte el primitivo) vive en
// `escritores-de-data.test.ts`, que lee el fuente.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  update: vi.fn(),
  set: vi.fn(),
  where: vi.fn(),
  returning: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: { select: mocks.select, update: mocks.update },
  schema: { projects: { id: "id", userId: "userId", data: "data", updatedAt: "updatedAt" } },
}));

vi.mock("drizzle-orm", () => ({
  and: (...xs: unknown[]) => ({ and: xs }),
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
}));

import { actualizarData, escribirDataSiNoSeMovio } from "@/lib/projects/escribir-data";

const BASE = new Date("2026-09-14T10:00:00Z");
const MOVIDA = new Date("2026-09-14T10:00:05Z");

/** La fila, con su versión. `leer` devuelve lo que haya en el momento. */
function baseDeDatos(inicial: { data: Record<string, unknown>; updatedAt: Date }) {
  const fila = { ...inicial };
  const escrituras: { data: Record<string, unknown>; base: unknown }[] = [];

  mocks.select.mockImplementation(() => ({
    from: () => ({
      where: () => ({
        limit: async () => [{ data: fila.data, updatedAt: fila.updatedAt, id: "p1" }],
      }),
    }),
  }));
  mocks.update.mockImplementation(() => ({
    set: (valores: { data: Record<string, unknown>; updatedAt: Date }) => ({
      where: (w: { and: { eq: [string, unknown] }[] }) => ({
        returning: async () => {
          // El CAS: la cláusula lleva el updatedAt que leyó quien escribe.
          const clausulas = JSON.stringify(w);
          const pin = clausulas.includes(fila.updatedAt.toISOString());
          escrituras.push({ data: valores.data, base: clausulas });
          if (!pin) return [];
          fila.data = valores.data;
          fila.updatedAt = valores.updatedAt;
          return [{ id: "p1" }];
        },
      }),
    }),
  }));
  return { fila, escrituras };
}

describe("I4 · escribirDataSiNoSeMovio", () => {
  beforeEach(() => vi.clearAllMocks());

  it("escribe cuando la fila sigue donde se leyó", async () => {
    const bd = baseDeDatos({ data: { html: "<p>uno</p>" }, updatedAt: BASE });

    const r = await escribirDataSiNoSeMovio({
      projectId: "p1",
      userId: "u1",
      data: { html: "<p>dos</p>" },
      baseUpdatedAt: BASE,
    });

    expect(r.ok).toBe(true);
    expect(bd.fila.data).toEqual({ html: "<p>dos</p>" });
  });

  it("🔴 NO escribe si alguien movió la fila — y lo dice", async () => {
    const bd = baseDeDatos({ data: { html: "<p>del otro</p>" }, updatedAt: MOVIDA });

    const r = await escribirDataSiNoSeMovio({
      projectId: "p1",
      userId: "u1",
      data: { html: "<p>mío</p>" },
      baseUpdatedAt: BASE,
    });

    expect(r).toEqual({ ok: false, motivo: "conflicto" });
    // Y lo del otro sigue ahí, byte a byte.
    expect(bd.fila.data).toEqual({ html: "<p>del otro</p>" });
  });

  it("distingue «no existe» de «conflicto»", async () => {
    mocks.update.mockReturnValue({
      set: () => ({ where: () => ({ returning: async () => [] }) }),
    });
    mocks.select.mockReturnValue({
      from: () => ({ where: () => ({ limit: async () => [] }) }),
    });

    const r = await escribirDataSiNoSeMovio({
      projectId: "p1",
      userId: "u1",
      data: { html: "x" },
      baseUpdatedAt: BASE,
    });
    expect(r).toEqual({ ok: false, motivo: "no_encontrado" });
  });
});

describe("I4 · actualizarData reaplica sobre lo del otro", () => {
  beforeEach(() => vi.clearAllMocks());

  it("perder el CAS no pierde el trabajo: se reaplica encima", async () => {
    const bd = baseDeDatos({
      data: { html: "<p>original</p>", settings: { forms: { f1: { email: "a@b.c" } } } },
      updatedAt: BASE,
    });

    // El OTRO escritor entra entre la lectura y la escritura de la primera
    // vuelta: cambia los AJUSTES, que es la clave que el nuestro no toca.
    let vueltas = 0;
    const leerOriginal = mocks.select.getMockImplementation()!;
    mocks.select.mockImplementation((...a: unknown[]) => {
      const r = (leerOriginal as (...x: unknown[]) => { from: () => { where: () => { limit: () => Promise<unknown[]> } } })(...a);
      return {
        from: () => ({
          where: () => ({
            limit: async () => {
              const filas = await r.from().where().limit();
              if (vueltas++ === 0) {
                bd.fila.data = { ...bd.fila.data, settings: { forms: { f1: { email: "nuevo@b.c" } } } };
                bd.fila.updatedAt = MOVIDA;
              }
              return filas;
            },
          }),
        }),
      };
    });

    const r = await actualizarData({
      projectId: "p1",
      userId: "u1",
      aplicar: (actual) => ({ ...actual, html: "<p>de Len</p>" }),
    });

    expect(r.ok).toBe(true);
    // Lo nuestro llegó…
    expect(bd.fila.data.html).toBe("<p>de Len</p>");
    // …y lo del otro NO se revirtió, que es el fallo que esto existe para cerrar.
    expect(bd.fila.data.settings).toEqual({ forms: { f1: { email: "nuevo@b.c" } } });
  });

  it("un `aplicar` que rechaza no escribe nada", async () => {
    const bd = baseDeDatos({ data: { html: "<p>uno</p>" }, updatedAt: BASE });

    const r = await actualizarData({
      projectId: "p1",
      userId: "u1",
      aplicar: () => ({ error: "slug repetido" }),
    });

    expect(r).toEqual({ ok: false, motivo: "rechazado", error: "slug repetido" });
    expect(bd.fila.data).toEqual({ html: "<p>uno</p>" });
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
