// EL MODO PLAN EN EL CHAT (pieza 7). La ficha enseña lo que sabe del servidor
// y, encima, lo que el dueño eligió; al servidor sólo viaja la ELECCIÓN (como
// el `/plan` de DeepSeek, un evento), nunca una copia del estado: una copia
// vieja apagaría el modo que Len encendió mientras el chat no miraba.
import { describe, expect, it } from "vitest";
import { APPROVE_LABEL, KEEP_PLANNING_LABEL, PLAN_FIRST_LABEL, SKIP_PLANNING_LABEL, planConsentQuestion, planReviewQuestion } from "@/lib/agent/plan-mode";
import type { StoredChatTurn } from "@/lib/projects/types";
import { lastPlanMode, planAnswersForMessage, planModeAfterAnswer, togglePlanSelection } from "./plan-mode-state";

const fila = (extra: Partial<StoredChatTurn>): StoredChatTurn => ({
  id: "t", userText: "x", assistantReasoning: "", status: "applied", ...extra,
});

describe("lo que el chat sabe al cargar", () => {
  it("el último turno cerrado manda", () => {
    expect(lastPlanMode([])).toBe(false);
    expect(lastPlanMode([fila({ planMode: true })])).toBe(true);
    expect(lastPlanMode([fila({ planMode: true }), fila({})])).toBe(false);
  });

  it("un turno que sigue en el servidor no cuenta todavía", () => {
    expect(lastPlanMode([fila({ planMode: true }), fila({ enCurso: true })])).toBe(true);
  });
});

describe("la elección del dueño", () => {
  it("tocar la ficha elige lo contrario de lo que se ve", () => {
    expect(togglePlanSelection({ wanted: null, known: false })).toBe(true);
    expect(togglePlanSelection({ wanted: null, known: true })).toBe(false);
  });

  it("volver a lo que ya era deshace la elección (no viaja nada)", () => {
    expect(togglePlanSelection({ wanted: true, known: false })).toBeNull();
    expect(togglePlanSelection({ wanted: false, known: true })).toBeNull();
  });
});

describe("contestar la tarjeta cuando el turno ya cerró", () => {
  const revision = [planReviewQuestion("# Plan")];
  const permiso = [planConsentQuestion()];

  it("aceptar entrar enciende; aprobar el plan apaga", () => {
    expect(planModeAfterAnswer(permiso, [{ id: "plan-mode", selected: [PLAN_FIRST_LABEL] }])).toBe(true);
    expect(planModeAfterAnswer(revision, [{ id: "plan-review", selected: [APPROVE_LABEL] }])).toBe(false);
  });

  it("lo demás no cambia nada", () => {
    expect(planModeAfterAnswer(permiso, [{ id: "plan-mode", selected: [SKIP_PLANNING_LABEL] }])).toBeNull();
    expect(planModeAfterAnswer(revision, [{ id: "plan-review", selected: [KEEP_PLANNING_LABEL], custom: "más corto" }])).toBeNull();
    expect(planModeAfterAnswer([{ id: "q", question: "¿Color?" }], [{ id: "q", selected: ["Azul"] }])).toBeNull();
  });
});

describe("la respuesta como mensaje, en el idioma del dueño", () => {
  const t = (clave: string) => `«${clave}»`;
  it("las etiquetas del modo plan se traducen; lo escrito se queda", () => {
    expect(
      planAnswersForMessage([planReviewQuestion("# P")], [{ id: "plan-review", selected: [KEEP_PLANNING_LABEL], custom: "más corto" }], t),
    ).toEqual([{ id: "plan-review", selected: ["«newChat.plan.keep»"], custom: "más corto" }]);
    expect(planAnswersForMessage([planConsentQuestion()], [{ id: "plan-mode", selected: [PLAN_FIRST_LABEL] }], t)[0]!.selected).toEqual([
      "«newChat.plan.planFirst»",
    ]);
  });

  it("BRAZO DE CONTROL: una pregunta del modelo no se toca aunque diga «Approve»", () => {
    const respuestas = [{ id: "q", selected: [APPROVE_LABEL] }];
    expect(planAnswersForMessage([{ id: "q", question: "¿Publico?" }], respuestas, t)).toBe(respuestas);
  });
});
