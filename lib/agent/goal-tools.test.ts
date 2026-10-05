// LAS TRES HERRAMIENTAS DEL ENCARGO (pieza 8): `get_goal`, `create_goal` y
// `update_goal` de DeepSeek, con su autoridad (turno del dueño o la ronda del
// encargo) y sus errores literales. Con el encargo en memoria.
import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_GOAL_ROUNDS, GOAL_GUIDANCE, type GoalActivation, type GoalSnapshot } from "./goal";
import { GOAL_DECLARATIONS, GOAL_PROMPT, toolCreateGoal, toolGetGoal, toolUpdateGoal } from "./goal-tools";
import type { AgentDeps, AgentSession } from "./tools";

const session = { projectId: "p1", userId: "u1" } as AgentSession;
type Autoridad = { kind: "direct-human" } | { kind: "goal-round"; goalId: string; revision: number; round: number } | null;

function encargo(o: { goal?: GoalSnapshot | null; activation?: GoalActivation; authority?: Autoridad } = {}) {
  const estado = { goal: o.goal ?? null, activation: o.activation ?? ("disarmed" as GoalActivation) };
  const commits: { goal: GoalSnapshot | null; activation: GoalActivation }[] = [];
  const deps = {
    goal: {
      get: () => estado.goal,
      activation: () => estado.activation,
      commit: (goal: GoalSnapshot | null, activation: GoalActivation) => {
        estado.goal = goal;
        estado.activation = activation;
        commits.push({ goal, activation });
      },
      authority: () => (o.authority === undefined ? { kind: "direct-human" } : o.authority),
      newId: () => "goal-1",
    },
  } as unknown as AgentDeps;
  return { deps, estado, commits };
}

const activo = (o: Partial<GoalSnapshot> = {}): GoalSnapshot => ({
  id: "goal-1",
  revision: 2,
  objective: "la tienda entera",
  phase: "active",
  maxGoalRounds: DEFAULT_MAX_GOAL_ROUNDS,
  roundsStarted: 2,
  ...o,
});
const ronda = (g: GoalSnapshot, round = g.roundsStarted): Autoridad => ({
  kind: "goal-round",
  goalId: g.id,
  revision: g.revision,
  round,
});
const update = (g: GoalSnapshot, extra: Record<string, unknown>) => ({ goal_id: g.id, revision: g.revision, ...extra });

describe("create_goal", () => {
  it("en un turno del dueño crea, arma y devuelve la forma de DeepSeek", async () => {
    const e = encargo();
    const out = await toolCreateGoal(session, e.deps, { objective: "  la tienda entera " });
    expect(out.response).toEqual({
      ok: true,
      goal: {
        id: "goal-1",
        revision: 1,
        objective: "la tienda entera",
        phase: "active",
        roundsStarted: 0,
        maxGoalRounds: 256,
      },
      activation: "armed",
    });
    expect(e.commits).toHaveLength(1);
    expect(e.estado.activation).toBe("armed");
  });

  it("en una ronda, no: hace falta el dueño", async () => {
    const g = activo({ phase: "complete" });
    const e = encargo({ goal: g, authority: ronda(g) });
    const out = await toolCreateGoal(session, e.deps, { objective: "otra" });
    expect(out.response).toEqual({
      ok: false,
      error: "this goal operation requires a direct human turn on a top-level agent",
    });
    expect(e.commits).toHaveLength(0);
  });

  it("con uno vivo, el error del dominio", async () => {
    const e = encargo({ goal: activo() });
    const out = await toolCreateGoal(session, e.deps, { objective: "otra" });
    expect(out.response).toEqual({ ok: false, error: 'goal "goal-1" already exists with phase "active"' });
  });

  it("sin turno abierto (sin `deps.goal`), lo dice", async () => {
    const out = await toolCreateGoal(session, {} as AgentDeps, { objective: "x" });
    expect(out.response).toEqual({ ok: false, error: "goal tools require an open model turn" });
  });
});

describe("get_goal", () => {
  it("sin encargo, `goal: null`; con uno, su foto y la activación", async () => {
    expect((await toolGetGoal(session, encargo().deps, {})).response).toEqual({ ok: true, goal: null });
    const out = await toolGetGoal(session, encargo({ goal: activo(), activation: "armed" }).deps, {});
    expect(out.response).toMatchObject({ ok: true, goal: { id: "goal-1", revision: 2, phase: "active" }, activation: "armed" });
  });
});

describe("update_goal", () => {
  it("valida la referencia", async () => {
    const out = await toolUpdateGoal(session, encargo({ goal: activo() }).deps, { goal_id: " ", revision: 0, action: "complete" });
    expect(out.response).toEqual({
      ok: false,
      error: "goal_id must be non-empty and revision must be a positive safe integer",
    });
  });

  it("complete en la ronda exacta: completo, desarmado y el cierre de DeepSeek", async () => {
    const g = activo();
    const e = encargo({ goal: g, activation: "armed", authority: ronda(g) });
    const out = await toolUpdateGoal(session, e.deps, update(g, { action: "complete" }));
    expect(out.response).toMatchObject({ ok: true, goal: { phase: "complete", revision: 3 }, activation: "disarmed" });
    expect(out.notice?.startsWith('<goal_complete>\nObjective: "la tienda entera"\n')).toBe(true);
  });

  it("complete en un turno del dueño, sin cierre", async () => {
    const g = activo();
    const out = await toolUpdateGoal(session, encargo({ goal: g }).deps, update(g, { action: "complete" }));
    expect(out.response).toMatchObject({ ok: true, goal: { phase: "complete" } });
    expect(out.notice).toBeUndefined();
  });

  it("complete en otra ronda que no es la del encargo: no hay autoridad", async () => {
    const g = activo();
    const e = encargo({ goal: g, authority: ronda(g, 1) });
    const out = await toolUpdateGoal(session, e.deps, update(g, { action: "complete" }));
    expect(out.response).toEqual({
      ok: false,
      error: "complete and blocked require a direct human turn or the current goal round",
    });
  });

  it("blocked en una ronda antes de la 3, no", async () => {
    const g = activo({ roundsStarted: 2 });
    const e = encargo({ goal: g, authority: ronda(g) });
    const out = await toolUpdateGoal(session, e.deps, update(g, { action: "blocked", blocked_reason: "sin fotos" }));
    expect(out.response).toEqual({
      ok: false,
      error: "blocked requires at least 3 consecutive goal rounds; current round is 2",
    });
  });

  it("blocked en la ronda 3: atascado con su motivo y el cierre de DeepSeek", async () => {
    const g = activo({ roundsStarted: 3 });
    const e = encargo({ goal: g, activation: "armed", authority: ronda(g) });
    const out = await toolUpdateGoal(session, e.deps, update(g, { action: "blocked", blocked_reason: "sin fotos" }));
    expect(out.response).toMatchObject({
      ok: true,
      goal: { phase: "blocked", blockedReason: { code: "model-reported", message: "sin fotos" } },
      activation: "disarmed",
    });
    expect(out.notice?.startsWith("<goal_blocked>")).toBe(true);
    expect(out.notice).toContain('Blocked: "sin fotos"');
  });

  it("blocked sin motivo, y complete con motivo", async () => {
    const g = activo();
    const d = encargo({ goal: g }).deps;
    expect((await toolUpdateGoal(session, d, update(g, { action: "blocked", blocked_reason: "  " }))).response).toEqual({
      ok: false,
      error: "blocked_reason is required with action blocked",
    });
    expect((await toolUpdateGoal(session, d, update(g, { action: "complete", blocked_reason: "x" }))).response).toEqual({
      ok: false,
      error: "blocked_reason is valid only with action blocked",
    });
    expect((await toolUpdateGoal(session, d, update(g, { action: "complete", objective: "y" }))).response).toEqual({
      ok: false,
      error: "objective and max_goal_rounds are valid only with action edit",
    });
  });

  it("resume de uno en pausa: el modelo no puede", async () => {
    const g = activo({ phase: "paused" });
    const out = await toolUpdateGoal(session, encargo({ goal: g }).deps, update(g, { action: "resume" }));
    expect(out.response).toEqual({ ok: false, error: "the model cannot resume a paused goal; the user must resume it" });
  });

  it("resume de uno activo desarmado en un turno del dueño: lo arma", async () => {
    const g = activo();
    const e = encargo({ goal: g });
    const out = await toolUpdateGoal(session, e.deps, update(g, { action: "resume" }));
    expect(out.response).toMatchObject({ ok: true, goal: { phase: "active", revision: 3 }, activation: "armed" });
  });

  it("edit, pause y resume piden al dueño; y sus combinaciones de campos", async () => {
    const g = activo();
    const enRonda = encargo({ goal: g, authority: ronda(g) }).deps;
    expect((await toolUpdateGoal(session, enRonda, update(g, { action: "pause" }))).response).toEqual({
      ok: false,
      error: "this goal operation requires a direct human turn on a top-level agent",
    });
    const d = encargo({ goal: g }).deps;
    expect((await toolUpdateGoal(session, d, update(g, { action: "edit", objective: "y", blocked_reason: "z" }))).response).toEqual({
      ok: false,
      error: "blocked_reason is valid only with action blocked",
    });
    expect((await toolUpdateGoal(session, d, update(g, { action: "pause", objective: "y" }))).response).toEqual({
      ok: false,
      error:
        "objective and max_goal_rounds are valid only with action edit; blocked_reason is valid only with action blocked",
    });
  });

  it("edit cambia el objetivo y deja la activación; `\"\"` y `0` son ausentes", async () => {
    const g = activo();
    const e = encargo({ goal: g, activation: "armed" });
    const out = await toolUpdateGoal(session, e.deps, update(g, { action: "edit", objective: "la tienda y el blog", max_goal_rounds: 0 }));
    expect(out.response).toMatchObject({
      ok: true,
      goal: { objective: "la tienda y el blog", maxGoalRounds: 256, revision: 3 },
      activation: "armed",
    });
    const vacio = await toolUpdateGoal(session, e.deps, { goal_id: "goal-1", revision: 3, action: "edit", objective: "" });
    expect(vacio.response).toEqual({ ok: false, error: "goal edit requires objective and/or maxGoalRounds" });
  });

  it("pause desarma", async () => {
    const g = activo();
    const e = encargo({ goal: g, activation: "armed" });
    const out = await toolUpdateGoal(session, e.deps, update(g, { action: "pause" }));
    expect(out.response).toMatchObject({ ok: true, goal: { phase: "paused" }, activation: "disarmed" });
  });
});

describe("lo que lee el modelo", () => {
  it("las tres declaraciones de DeepSeek y su política", () => {
    expect(GOAL_DECLARATIONS.map((d) => d.name)).toEqual(["get_goal", "create_goal", "update_goal"]);
    const crear = GOAL_DECLARATIONS[1]! as { description: string };
    expect(crear.description).toBe(
      "Create a persisted goal that keeps this session working across automatic continuation rounds. " +
        'Use it when the direct human request is a long-running objective, even if the user did not say "goal"; ' +
        "not for single-turn work.",
    );
    const actualizar = GOAL_DECLARATIONS[2]! as { parameters: { properties: { action: { enum: string[] } }; required: string[] } };
    expect(actualizar.parameters.properties.action.enum).toEqual(["edit", "pause", "resume", "complete", "blocked"]);
    expect(actualizar.parameters.required).toEqual(["goal_id", "revision", "action"]);
    expect(GOAL_PROMPT).toBe(GOAL_GUIDANCE);
  });
});
