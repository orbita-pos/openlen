import { describe, expect, it, vi } from "vitest";

// Hallazgo 4 (revisión final 2026-09-11): `ESFUERZOS.find((e) => e === v) ?? null`
// es la FRONTERA donde un string sin tipar entra al sistema desde la base de
// datos — la cabecera del propio módulo lo llama así — y nada la ejercitaba:
// `route.test.ts` mockea el módulo entero y `con-plazo.test.ts` sólo cubre el
// `race`. Sin esta prueba, alguien podría "simplificarla" a
// `rows[0]?.agentEffort as EsfuerzoAgente | null` y una fila con basura
// llegaría colada a `presupuestoDeEsfuerzo`.

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  selectLimit: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
  eq: (left: unknown, right: unknown) => ({ op: "eq", left, right }),
}));

vi.mock("@/lib/db", () => {
  const users = { id: "users.id", agentEffort: "users.agentEffort" };
  mocks.select.mockImplementation(() => ({
    from: () => ({
      where: () => ({ limit: mocks.selectLimit }),
    }),
  }));
  return { db: { select: mocks.select }, schema: { users } };
});

import { getEsfuerzoGuardado } from "./esfuerzo-guardado";

describe("getEsfuerzoGuardado — la frontera valida antes de dejar pasar", () => {
  it("un nivel válido de ESFUERZOS pasa tal cual", async () => {
    mocks.selectLimit.mockResolvedValue([{ agentEffort: "high" }]);
    await expect(getEsfuerzoGuardado("u1")).resolves.toBe("high");
  });

  it("una cadena basura (fila tocada a mano o heredada) degrada a null, no pasa colada", async () => {
    mocks.selectLimit.mockResolvedValue([{ agentEffort: "ultracode" }]);
    await expect(getEsfuerzoGuardado("u1")).resolves.toBeNull();
  });

  it("sin preferencia guardada (agentEffort null) también degrada a null", async () => {
    mocks.selectLimit.mockResolvedValue([{ agentEffort: null }]);
    await expect(getEsfuerzoGuardado("u1")).resolves.toBeNull();
  });
});
