// LAS DOS HERRAMIENTAS DEL MODO PLAN (pieza 7): `enter_plan_mode` (la puerta de
// Claude Code: el dueño acepta) y `exit_plan_mode` (la de DeepSeek: el plan se
// revisa y, aprobado, el modo se apaga). Con un dueño falso que contesta lo que
// se le diga y el estado en memoria.
import { describe, expect, it } from "vitest";
import type { QuestionAnswer, UserQuestion } from "./ask-user-question";
import {
  APPROVE_LABEL,
  ENTER_PLAN_MODE,
  EXIT_PLAN_MODE,
  KEEP_PLANNING_LABEL,
  PLAN_FIRST_LABEL,
  SKIP_PLANNING_LABEL,
} from "./plan-mode";
import { PLAN_MODE_DECLARATIONS, toolEnterPlanMode, toolExitPlanMode } from "./plan-mode-tools";
import type { AgentDeps, AgentSession } from "./tools";

const session = { projectId: "p1", userId: "u1" } as AgentSession;
const PLAN = "# Reseñas con estrellas\n\nUna sección con las reseñas.\n\n## Cómo lo comprobaré\nAbro la página y dejo una.";

function dueno(contesta: ((qs: UserQuestion[]) => QuestionAnswer[] | null) | null, activo = false) {
  const estado = { active: activo, cambios: [] as boolean[] };
  const preguntadas: UserQuestion[][] = [];
  const deps = {
    planMode: {
      active: () => estado.active,
      set: (v: boolean) => {
        estado.active = v;
        estado.cambios.push(v);
      },
    },
    ...(contesta
      ? {
          askUser: async (qs: UserQuestion[]) => {
            preguntadas.push(qs);
            return contesta(qs);
          },
        }
      : {}),
  } as unknown as AgentDeps;
  return { deps, estado, preguntadas };
}

describe("enter_plan_mode", () => {
  it("pregunta al dueño y, si acepta, enciende el modo", async () => {
    const d = dueno((qs) => [{ id: qs[0]!.id, selected: [PLAN_FIRST_LABEL] }]);
    const out = await toolEnterPlanMode(session, d.deps, {});
    expect(d.preguntadas[0]![0]!.intent).toEqual({ kind: "plan-consent" });
    expect(out.response).toMatchObject({ ok: true, planMode: true });
    expect(d.estado.cambios).toEqual([true]);
    expect(out.preguntas?.[0]?.id).toBe("plan-mode");
  });

  it("si no acepta, sigue sin el modo y el modelo lo sabe", async () => {
    const d = dueno((qs) => [{ id: qs[0]!.id, selected: [SKIP_PLANNING_LABEL] }]);
    const out = await toolEnterPlanMode(session, d.deps, {});
    expect(out.response).toEqual({ ok: false, error: "The user declined plan mode; carry on with the request without it." });
    expect(d.estado.cambios).toEqual([]);
  });

  it("si no contesta a tiempo, la pregunta cierra el turno y el modo no cambia", async () => {
    const d = dueno(() => null);
    const out = await toolEnterPlanMode(session, d.deps, {});
    expect(out.response).toEqual({ ok: true, preguntado: true });
    expect(out.pregunta).toBeTruthy();
    expect(d.estado.cambios).toEqual([]);
  });

  it("sin quien conteste (voz, Len-Bench), no entra", async () => {
    const d = dueno(null);
    const out = await toolEnterPlanMode(session, d.deps, {});
    expect(out.response).toEqual({
      ok: false,
      error: "Plan mode needs the user's consent and this conversation can't ask for it; carry on without plan mode.",
    });
  });

  it("ya dentro, no vuelve a preguntar", async () => {
    const d = dueno(() => [], true);
    const out = await toolEnterPlanMode(session, d.deps, {});
    expect(out.response.ok).toBe(false);
    expect(d.preguntadas).toEqual([]);
  });
});

describe("exit_plan_mode", () => {
  it("aprobado: apaga el modo y le dice al modelo que ejecute", async () => {
    const d = dueno((qs) => [{ id: qs[0]!.id, selected: [APPROVE_LABEL] }], true);
    const out = await toolExitPlanMode(session, d.deps, { plan: PLAN });
    expect(d.preguntadas[0]![0]!.intent).toEqual({ kind: "plan-review", plan: PLAN });
    expect(out.response).toMatchObject({
      ok: true,
      approved: true,
      result: "Plan approved — plan mode exited; carry out the plan starting with your next step.",
    });
    expect(d.estado.cambios).toEqual([false]);
  });

  it("seguir planeando: el modo sigue y los comentarios vuelven literales", async () => {
    const d = dueno((qs) => [{ id: qs[0]!.id, selected: [KEEP_PLANNING_LABEL], custom: "sin fotos de stock" }], true);
    const out = await toolExitPlanMode(session, d.deps, { plan: PLAN });
    expect(out.response).toEqual({ ok: false, error: "The user chose to keep planning; their feedback: sin fotos de stock" });
    expect(d.estado.cambios).toEqual([]);
  });

  it("🔴 ■ o sin respuesta a tiempo: nada se aprueba, el turno cierra con la tarjeta", async () => {
    const d = dueno(() => null, true);
    const out = await toolExitPlanMode(session, d.deps, { plan: PLAN });
    expect(out.response).toEqual({ ok: true, preguntado: true });
    expect(out.preguntas?.[0]?.intent).toEqual({ kind: "plan-review", plan: PLAN });
    expect(d.estado.active).toBe(true);
  });

  it("fuera del modo plan, el error de DeepSeek", async () => {
    const d = dueno(() => [], false);
    expect((await toolExitPlanMode(session, d.deps, { plan: PLAN })).response).toEqual({
      ok: false,
      error: "exit_plan_mode is only available in plan mode",
    });
  });

  it("un plan sin # título, el error de DeepSeek y sin preguntar", async () => {
    const d = dueno(() => [], true);
    expect((await toolExitPlanMode(session, d.deps, { plan: "hacer cosas" })).response).toEqual({
      ok: false,
      error: "exit_plan_mode requires a non-empty markdown plan starting with a # heading",
    });
    expect(d.preguntadas).toEqual([]);
  });

  it("sin canal de preguntas, el error de DeepSeek", async () => {
    const d = dueno(null, true);
    expect((await toolExitPlanMode(session, d.deps, { plan: PLAN })).response).toEqual({
      ok: false,
      error: "no user-questions channel is available to review the plan; ask the user to switch the session mode instead",
    });
  });
});

describe("las declaraciones", () => {
  it("exit_plan_mode lleva la descripción y el parámetro de DeepSeek", () => {
    const exit = PLAN_MODE_DECLARATIONS.find((d) => d.name === EXIT_PLAN_MODE) as {
      description: string;
      parameters: { properties: { plan: { description: string } }; required: string[] };
    };
    expect(exit.description).toBe(
      "Use only in plan mode. Present your plan for the user's review and, on approval, leave plan mode. "
        + "The user may approve (carry out the plan from your next step) or keep "
        + "planning — their feedback comes back in the tool result; revise and present again.",
    );
    expect(exit.parameters.properties.plan.description).toBe("The complete plan, as markdown, starting with a # heading that names it.");
    expect(exit.parameters.required).toEqual(["plan"]);
  });

  it("enter_plan_mode no tiene parámetros y dice que el dueño tiene que aceptar", () => {
    const enter = PLAN_MODE_DECLARATIONS.find((d) => d.name === ENTER_PLAN_MODE) as {
      description: string;
      parameters: { properties: Record<string, unknown> };
    };
    expect(enter.parameters.properties).toEqual({});
    expect(enter.description).toMatch(/user must accept/);
  });
});
