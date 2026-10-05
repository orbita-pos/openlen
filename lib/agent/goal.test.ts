// EL ENCARGO, PURO (pieza 8 de Len 2.5): el goal de DeepSeek — sus reglas, sus
// errores y sus textos, literales — y el pliegue de la conversación.
import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_GOAL_ROUNDS,
  GOAL_GUIDANCE,
  GoalError,
  blockGoal,
  completeGoal,
  createGoal,
  editGoal,
  goalFromRows,
  goalRoundOf,
  goalRoundPrompt,
  goalValue,
  goalWrapup,
  pauseGoal,
  resumeGoal,
  startRound,
  type GoalSnapshot,
} from "./goal";

const nuevo = (o: Partial<GoalSnapshot> = {}): GoalSnapshot => ({
  id: "goal-1",
  revision: 1,
  objective: "la tienda entera",
  phase: "active",
  maxGoalRounds: DEFAULT_MAX_GOAL_ROUNDS,
  roundsStarted: 0,
  ...o,
});
const ref = (g: GoalSnapshot) => ({ id: g.id, revision: g.revision });

function lanza(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(GoalError);
    return (e as Error).message;
  }
  throw new Error("no lanzó");
}

describe("crear", () => {
  it("crea activo, con el objetivo recortado y 256 rondas", () => {
    expect(createGoal(null, { objective: "  la tienda entera  " }, "goal-1")).toEqual(nuevo());
    expect(DEFAULT_MAX_GOAL_ROUNDS).toBe(256);
  });

  it("con uno vivo no; con uno completo lo reemplaza", () => {
    expect(lanza(() => createGoal(nuevo(), { objective: "otra" }, "goal-2"))).toBe(
      'goal "goal-1" already exists with phase "active"',
    );
    expect(createGoal(nuevo({ phase: "complete" }), { objective: "otra" }, "goal-2").id).toBe("goal-2");
  });

  it("valida el objetivo y el tope como DeepSeek", () => {
    expect(lanza(() => createGoal(null, { objective: "   " }, "g"))).toBe("goal objective must be a non-empty string");
    expect(lanza(() => createGoal(null, { objective: "x", maxGoalRounds: 0 }, "g"))).toBe(
      "maxGoalRounds must be a positive safe integer",
    );
    expect(lanza(() => createGoal(null, { objective: "x", maxGoalRounds: 1.5 }, "g"))).toBe(
      "maxGoalRounds must be a positive safe integer",
    );
    expect(createGoal(null, { objective: "x", maxGoalRounds: 5 }, "g").maxGoalRounds).toBe(5);
  });
});

describe("las transiciones", () => {
  it("editar pide algo que cambiar y la revisión exacta", () => {
    const g = nuevo();
    expect(lanza(() => editGoal(g, ref(g), {}))).toBe("goal edit requires objective and/or maxGoalRounds");
    expect(lanza(() => editGoal(g, { id: "goal-1", revision: 7 }, { objective: "y" }))).toBe(
      'stale goal ref "goal-1" revision 7; current is "goal-1" revision 1',
    );
    expect(lanza(() => editGoal(null, ref(g), { objective: "y" }))).toBe("no current goal");
    expect(editGoal(g, ref(g), { objective: " y " })).toEqual({ ...g, revision: 2, objective: "y" });
  });

  it("pausar sólo uno activo", () => {
    const g = nuevo({ phase: "blocked", blockedReason: { code: "x", message: "y" } });
    expect(lanza(() => pauseGoal(g, ref(g)))).toBe('cannot pause goal "goal-1" from phase "blocked"; expected active');
    expect(pauseGoal(nuevo(), ref(nuevo()))).toMatchObject({ phase: "paused", revision: 2 });
  });

  it("reanudar: activo armado no, desarmado sí, sin rondas no", () => {
    const g = nuevo({ roundsStarted: 2 });
    expect(lanza(() => resumeGoal(g, ref(g), "armed"))).toBe('goal "goal-1" is already active and armed');
    expect(resumeGoal(g, ref(g), "disarmed")).toMatchObject({ phase: "active", revision: 2 });
    const pausado = nuevo({ phase: "paused" });
    expect(resumeGoal(pausado, ref(pausado), "disarmed").phase).toBe("active");
    const agotado = nuevo({ phase: "paused", roundsStarted: 256 });
    expect(lanza(() => resumeGoal(agotado, ref(agotado), "disarmed"))).toBe(
      'goal "goal-1" exhausted 256 goal rounds; increase maxGoalRounds before resuming',
    );
    const hecho = nuevo({ phase: "complete" });
    expect(lanza(() => resumeGoal(hecho, ref(hecho), "disarmed"))).toBe(
      'cannot resume goal "goal-1" from phase "complete"; expected active or paused or blocked',
    );
  });

  it("bloquear sólo activo y con un motivo kebab-case; reanudar lo limpia", () => {
    const g = nuevo();
    expect(lanza(() => blockGoal(g, ref(g), { code: "Round Limit", message: "x" }))).toBe(
      "goal block reason requires a lower-kebab-case code and a non-empty message",
    );
    const b = blockGoal(g, ref(g), { code: "round-limit", message: "Goal reached its configured limit of 256 rounds." });
    expect(b).toMatchObject({ phase: "blocked", revision: 2, blockedReason: { code: "round-limit" } });
    expect(resumeGoal(b, ref(b), "disarmed")).not.toHaveProperty("blockedReason");
  });

  it("completar desde activo, en pausa o bloqueado", () => {
    expect(completeGoal(nuevo(), ref(nuevo()))).toMatchObject({ phase: "complete", revision: 2 });
    const c = nuevo({ phase: "complete" });
    expect(lanza(() => completeGoal(c, ref(c)))).toBe(
      'cannot complete goal "goal-1" from phase "complete"; expected active or paused or blocked',
    );
  });

  it("empezar una ronda cuenta, no es una mutación", () => {
    expect(startRound(nuevo())).toEqual(nuevo({ roundsStarted: 1 }));
  });
});

describe("el pliegue de la conversación", () => {
  it("la última fila con transcripción manda; una caída no lo borra", () => {
    const g = nuevo({ roundsStarted: 3 });
    expect(goalFromRows([])).toBeNull();
    expect(goalFromRows([{ transcript: { goal: nuevo() } }, { transcript: { goal: g } }, { transcript: null }])).toEqual(g);
    expect(goalFromRows([{ transcript: { goal: g } }, { transcript: {} }])).toBeNull();
    expect(goalFromRows([{ transcript: { goal: g } }, { transcript: { goal: null } }])).toBeNull();
  });
});

describe("los textos de DeepSeek", () => {
  it("el mensaje de ronda, con «project»", () => {
    const texto = goalRoundPrompt(nuevo(), 3);
    expect(texto.startsWith('<goal_round>\nObjective: "la tienda entera"\nRound: 3/256\n\n')).toBe(true);
    expect(texto).toContain("Treat the current project, tool results, and durable session state as authoritative");
    expect(texto).toContain("Before claiming completion, gather evidence that the whole objective is achieved");
    expect(texto.endsWith("</goal_round>")).toBe(true);
  });

  it("se lee de vuelta, también con comillas y saltos de línea", () => {
    const g = nuevo({ objective: 'Una tienda "bonita"\ncon carrito' });
    expect(goalRoundOf(goalRoundPrompt(g, 3))).toEqual({ objective: g.objective, round: 3, maxGoalRounds: 256 });
    expect(goalRoundOf("hazme la tienda")).toBeNull();
    expect(goalRoundOf("<goal_round>\nObjective: roto\nRound: x/y\n</goal_round>")).toBeNull();
  });

  it("los dos cierres", () => {
    const hecho = goalWrapup("la tienda entera");
    expect(hecho.startsWith('<goal_complete>\nObjective: "la tienda entera"\n')).toBe(true);
    expect(hecho).toContain("summarize what was done and how it was verified");
    expect(hecho).toContain("(pages, files, or other artifacts)");
    expect(hecho).toContain("Report only what earlier rounds and tool results in this session actually establish");
    const atascado = goalWrapup("la tienda entera", "sin fotos");
    expect(atascado.startsWith('<goal_blocked>\nObjective: "la tienda entera"\nBlocked: "sin fotos"\n')).toBe(true);
    expect(atascado).toContain("say exactly what you need from the user to continue");
  });

  it("la política, con el umbral de 3 y el reinicio", () => {
    expect(GOAL_GUIDANCE).toContain("create_goal may infer goal intent from a direct human request in any language.");
    expect(GOAL_GUIDANCE).toContain("After a service restart, an active goal is disarmed");
    expect(GOAL_GUIDANCE).toContain("persists for at least 3 consecutive goal rounds");
  });

  it("la salida de las herramientas, con su forma", () => {
    expect(goalValue(null, "disarmed")).toEqual({ goal: null });
    const b = nuevo({ phase: "blocked", blockedReason: { code: "model-reported", message: "sin fotos" }, roundsStarted: 4 });
    expect(goalValue(b, "disarmed")).toEqual({
      goal: {
        id: "goal-1",
        revision: 1,
        objective: "la tienda entera",
        phase: "blocked",
        roundsStarted: 4,
        maxGoalRounds: 256,
        blockedReason: { code: "model-reported", message: "sin fotos" },
      },
      activation: "disarmed",
    });
  });
});
