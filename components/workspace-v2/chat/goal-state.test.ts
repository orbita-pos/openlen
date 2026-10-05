// EL ENCARGO EN EL CHAT (pieza 8), puro: qué se ve según lo que dijo el servidor.
import { describe, expect, it } from "vitest";
import { goalRoundPrompt, type GoalSnapshot } from "@/lib/agent/goal";
import type { StoredChatTurn } from "@/lib/projects/types";
import { canCreateGoal, goalCard, goalOrder, goalViewOf, lastGoal, roundAfterDone, roundOfTurn, roundTextFor, type GoalView } from "./goal-state";

const encargo = (o: Partial<GoalView> = {}): GoalView => ({
  id: "goal-1",
  revision: 2,
  objective: "la tienda entera",
  phase: "active",
  maxGoalRounds: 256,
  roundsStarted: 3,
  activation: "armed",
  ...o,
});
const turno = (o: Partial<StoredChatTurn> = {}): StoredChatTurn => ({
  id: "t",
  userText: "hola",
  assistantReasoning: "",
  status: "applied",
  appliedAt: 1,
  ...o,
});

describe("lastGoal", () => {
  it("el del último turno cerrado; uno en curso no cuenta", () => {
    expect(lastGoal([])).toBeNull();
    expect(lastGoal([turno({ goal: encargo() }), turno({ id: "t2", enCurso: true })])).toEqual(encargo());
    expect(lastGoal([turno({ goal: encargo() }), turno({ id: "t2" })])).toBeNull();
  });
});

describe("goalViewOf", () => {
  it("lo que llega por el cable, validado", () => {
    const { activation: _a, ...foto } = encargo();
    expect(goalViewOf(foto as GoalSnapshot, "armed")).toEqual(encargo());
    expect(goalViewOf(foto as GoalSnapshot, "otra cosa")).toEqual(encargo({ activation: "disarmed" }));
    expect(goalViewOf({ roto: true }, "armed")).toBeNull();
    expect(goalViewOf(null, "armed")).toBeNull();
  });
});

describe("goalCard", () => {
  it("sin encargo o completo, no se ve", () => {
    expect(goalCard(null).kind).toBe("hidden");
    expect(goalCard(encargo({ phase: "complete" })).kind).toBe("hidden");
  });

  it("activo y armado: en marcha, sin reanudar", () => {
    expect(goalCard(encargo())).toMatchObject({ kind: "running", round: 3, maxGoalRounds: 256, canResume: false });
  });

  it("en pausa, o activo y desarmado (tras un reinicio): en pausa, se reanuda", () => {
    expect(goalCard(encargo({ phase: "paused", activation: "disarmed" }))).toMatchObject({ kind: "paused", canResume: true });
    expect(goalCard(encargo({ activation: "disarmed" }))).toMatchObject({ kind: "paused", canResume: true });
  });

  it("atascado, con su motivo; al tope de rondas no se reanuda", () => {
    const b = encargo({ phase: "blocked", activation: "disarmed", blockedReason: { code: "model-reported", message: "faltan las fotos" } });
    expect(goalCard(b)).toMatchObject({ kind: "blocked", reason: "faltan las fotos", roundLimit: false, canResume: true });
    const tope = encargo({
      phase: "blocked",
      activation: "disarmed",
      roundsStarted: 256,
      blockedReason: { code: "round-limit", message: "Goal reached its configured limit of 256 rounds." },
    });
    expect(goalCard(tope)).toMatchObject({ kind: "blocked", roundLimit: true, canResume: false });
  });
});

describe("canCreateGoal", () => {
  it("sólo sin encargo vivo", () => {
    expect(canCreateGoal(null)).toBe(true);
    expect(canCreateGoal(encargo({ phase: "complete" }))).toBe(true);
    expect(canCreateGoal(encargo({ phase: "paused" }))).toBe(false);
  });
});

describe("roundOfTurn", () => {
  it("el turno de una ronda se reconoce por su mensaje (con o sin correcciones)", () => {
    const texto = goalRoundPrompt({ objective: "la tienda entera", maxGoalRounds: 256 }, 2);
    expect(roundOfTurn(texto)).toEqual({ objective: "la tienda entera", round: 2, maxGoalRounds: 256 });
    expect(roundOfTurn(`${texto}\n↳ para el encargo`)).toEqual({ objective: "la tienda entera", round: 2, maxGoalRounds: 256 });
    expect(roundOfTurn("hazme la tienda")).toBeNull();
  });
});

describe("lo que decide el chat al mandar y al cerrar un turno", () => {
  it("la orden del dueño: crear sólo con la ficha puesta y sin encargo vivo", () => {
    expect(goalOrder(true, null)).toBe("create");
    expect(goalOrder(true, encargo({ phase: "complete" }))).toBe("create");
    expect(goalOrder(true, encargo())).toBeNull();
    expect(goalOrder(false, null)).toBeNull();
  });

  it("el texto que se pinta ya: el de la ronda que va a abrir, el mismo que compondrá el servidor", () => {
    expect(roundTextFor("create", "la tienda entera", null)).toBe(goalRoundPrompt({ objective: "la tienda entera", maxGoalRounds: 256 }, 1));
    expect(roundTextFor("resume", "", encargo({ phase: "paused", roundsStarted: 3 }))).toBe(
      goalRoundPrompt({ objective: "la tienda entera", maxGoalRounds: 256 }, 4),
    );
    expect(roundTextFor(null, "hola", null)).toBe("hola");
  });

  it("lo que sigue a un `done`: la ronda siguiente, o la parada por saldo", () => {
    expect(roundAfterDone({ round: { next: "f2" } })).toEqual({ next: "f2" });
    expect(roundAfterDone({ round: { stopped: "credits" } })).toEqual({ stopped: "credits" });
    expect(roundAfterDone({})).toBeNull();
    expect(roundAfterDone({ round: { next: 3 } })).toBeNull();
    expect(roundAfterDone(null)).toBeNull();
  });
});
