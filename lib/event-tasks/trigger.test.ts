// The trigger (spec local 2026-11-03-len-que-avisa, §7.4): code decides whether a change matters to a task —
// its conditions, matched in TypeScript — and merges what passes into one candidate. No model, no IO.
import { describe, expect, it } from "vitest";

import type { SourceChange } from "./sources/types";
import { evaluate } from "./trigger";

const reserva = (id: string, detail: Record<string, unknown>): SourceChange => ({
  subject: "reservas",
  summary: `reserva ${id}`,
  detail: { id, ...detail },
  at: "2026-11-03T20:00:00.000Z",
});

describe("evaluate", () => {
  it("no changes, no candidate and no records", () => {
    expect(evaluate({ changes: [], conditions: [] })).toEqual({ candidate: null, filtered: [] });
  });

  it("a change that fails a condition is filtered with the condition as reason", () => {
    const r = evaluate({ changes: [reserva("1", { estado: "pendiente" })], conditions: [{ field: "estado", op: "eq", value: "confirmada" }] });
    expect(r.candidate).toBeNull();
    expect(r.filtered).toEqual([{ change: reserva("1", { estado: "pendiente" }), reason: "estado ≠ confirmada" }]);
  });

  it("changes of one observation merge into one candidate", () => {
    const changes = ["1", "2", "3", "4", "5"].map((id) => reserva(id, { estado: "confirmada" }));
    const r = evaluate({ changes, conditions: [{ field: "estado", op: "eq", value: "confirmada" }] });
    expect(r.filtered).toEqual([]);
    expect(r.candidate).toEqual({ subject: "reservas", changes, summary: "reservas: 5" });
  });

  it("several subjects are one candidate, with the count of each", () => {
    const r = evaluate({ changes: [reserva("1", {}), { ...reserva("2", {}), subject: "pedidos" }], conditions: [] });
    expect(r.candidate?.summary).toBe("reservas: 1, pedidos: 1");
  });

  it("conditions match in TypeScript, so an injected value is just a string", () => {
    const r = evaluate({ changes: [reserva("1", { mesa: "4" })], conditions: [{ field: "mesa", op: "eq", value: "x' or 1=1" }] });
    expect(r.candidate).toBeNull();
    expect(r.filtered[0]!.reason).toBe("mesa ≠ x' or 1=1");
  });

  it("exists matches a non-empty field", () => {
    const conditions = [{ field: "nota", op: "exists" as const }];
    expect(evaluate({ changes: [reserva("1", { nota: "ventana" })], conditions }).candidate).not.toBeNull();
    expect(evaluate({ changes: [reserva("1", { nota: "" })], conditions }).filtered[0]!.reason).toBe("nota ∅");
    expect(evaluate({ changes: [reserva("1", {})], conditions }).candidate).toBeNull();
  });

  it("gt and lt compare numbers as numbers and the rest as text", () => {
    expect(evaluate({ changes: [reserva("1", { personas: 12 })], conditions: [{ field: "personas", op: "gt", value: 8 }] }).candidate).not.toBeNull();
    expect(evaluate({ changes: [reserva("1", { personas: "9" })], conditions: [{ field: "personas", op: "gt", value: "10" }] }).filtered[0]!.reason).toBe("personas ≤ 10");
    expect(evaluate({ changes: [reserva("1", { fecha: "2026-11-02" })], conditions: [{ field: "fecha", op: "lt", value: "2026-11-03" }] }).candidate).not.toBeNull();
  });

  it("contains is case-insensitive and neq refuses the equal value", () => {
    expect(evaluate({ changes: [reserva("1", { nota: "Cumpleaños de Ana" })], conditions: [{ field: "nota", op: "contains", value: "cumpleaños" }] }).candidate).not.toBeNull();
    expect(evaluate({ changes: [reserva("1", { estado: "cancelada" })], conditions: [{ field: "estado", op: "neq", value: "cancelada" }] }).filtered[0]!.reason).toBe("estado = cancelada");
  });
});
