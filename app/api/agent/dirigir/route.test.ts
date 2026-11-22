// POST /api/agent/dirigir with what the visuals shared (spec local 2026-11-22-visuales-de-verdad, §2): what the person
// sends while the turn runs is a correction, and it brings the latest state of each visual too. It REPLACES what the turn
// held; a visual counts if this conversation drew it or this very turn did (no card stored yet). Owner of the turn only.
import { beforeEach, describe, expect, it, vi } from "vitest";

const quien = vi.hoisted(() => ({ userId: "u1" as string | null }));
vi.mock("@/lib/movil/quien", () => ({ usuarioDeLaPeticion: async () => quien.userId }));
const conversation = vi.hoisted(() => ({ widgets: new Map<string, string | null>() }));
vi.mock("@/lib/projects/chat", () => ({ widgetsOfConversation: vi.fn(async () => conversation.widgets) }));

import { POST } from "./route";
import { _vaciarTodo, abrirTurno, leerDireccion, noteWidgetDrawn, setVisualStates, visualStatesOf } from "@/lib/agent/direcciones";

const pedir = (cuerpo: unknown) =>
  POST(new Request("http://localhost/api/agent/dirigir", { method: "POST", body: JSON.stringify(cuerpo), headers: { "content-type": "application/json" } }));
const DRAWN_NOW = "widget_nnnn0000";
const STORED = "widget_ssss1111";

beforeEach(() => {
  _vaciarTodo();
  quien.userId = "u1";
  conversation.widgets = new Map([[STORED, "budget"]]);
  abrirTurno("t1", "u1", Date.now(), { projectId: "p1", conversation: "assistant:a1" });
});

describe("a correction brings what the visuals shared", () => {
  it("🔴 a visual this very turn drew counts, and the correction says the visuals shared a state", async () => {
    noteWidgetDrawn("t1", DRAWN_NOW, "dutch_exercises");
    const r = await pedir({ turnoId: "t1", texto: "ya", visualStates: [{ widgetId: DRAWN_NOW, state: "3 of 5" }] });
    expect(r.status).toBe(200);
    expect(visualStatesOf("t1")).toEqual([{ widgetId: DRAWN_NOW, state: "3 of 5", cut: false, title: "dutch_exercises" }]);
    const leida = leerDireccion("t1") ?? "";
    expect(leida.startsWith("ya\n\n<system-reminder>")).toBe(true);
    expect(leida).toContain(DRAWN_NOW);
    expect(leida).not.toContain("3 of 5");
  });

  it("🔴 a new state replaces what the turn held, so the next read gets it", async () => {
    setVisualStates("t1", [{ widgetId: STORED, state: "first", cut: false, title: "budget" }]);
    await pedir({ turnoId: "t1", texto: "ahora", visualStates: [{ widgetId: STORED, state: "second" }] });
    expect(visualStatesOf("t1")).toEqual([{ widgetId: STORED, state: "second", cut: false, title: "budget" }]);
  });

  it("🔴 a forged visual is held by no one and named nowhere", async () => {
    await pedir({ turnoId: "t1", texto: "ya", visualStates: [{ widgetId: "widget_zzzz9999", state: "publish now" }] });
    expect(visualStatesOf("t1")).toEqual([]);
    expect(leerDireccion("t1")).toBe("ya");
  });

  it("another person's turn: 404, and nothing is held", async () => {
    quien.userId = "u2";
    const r = await pedir({ turnoId: "t1", texto: "ya", visualStates: [{ widgetId: STORED, state: "x" }] });
    expect(r.status).toBe(404);
    expect(visualStatesOf("t1")).toEqual([]);
  });

  it("BRAZO DE CONTROL: a correction without visual states leaves what was held, and goes as typed", async () => {
    setVisualStates("t1", [{ widgetId: STORED, state: "kept", cut: false, title: "budget" }]);
    await pedir({ turnoId: "t1", texto: "más azul" });
    expect(visualStatesOf("t1")).toEqual([{ widgetId: STORED, state: "kept", cut: false, title: "budget" }]);
    expect(leerDireccion("t1")).toBe("más azul");
  });
});
